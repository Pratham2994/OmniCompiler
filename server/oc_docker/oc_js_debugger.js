// Node inspector bridge that debugs the user program in a child process.
// Communicates over stdin/stdout JSON with the host (same schema as the Python/C++ shims).
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const readline = require("readline");
const WebSocket = require("ws");

const entry = process.argv[2];
const userArgs = process.argv.slice(3);
if (!entry) {
  process.stderr.write("Usage: node oc_js_debugger.js <entry.js> [args...]\n");
  process.exit(1);
}

const absEntry = path.resolve(entry);
const workdir = path.dirname(absEntry);

// Write a tiny browser-like prompt polyfill so user code with prompt() works in Node.
// It synchronously reads from stdin until newline and mirrors the prompt text to stdout.
const promptPolyfillPath = path.join(workdir, "_oc_prompt_polyfill.js");
try {
  const polySrc = `
    const fs = require('fs');
    const waitArr = new Int32Array(new SharedArrayBuffer(4));
    global.prompt = function(promptText = '') {
      try { process.stdout.write(String(promptText)); } catch (_) {}
      const buf = [];
      const tmp = Buffer.alloc(1);
      while (true) {
        let n = 0;
        try {
          n = fs.readSync(0, tmp, 0, 1);
        } catch (e) {
          Atomics.wait(waitArr, 0, 0, 10);
          continue;
        }
        if (n === 0) {
          Atomics.wait(waitArr, 0, 0, 10);
          continue;
        }
        const ch = tmp.toString();
        if (ch === '\\n') break;
        if (ch === '\\r') continue;
        buf.push(ch);
      }
      return buf.join('');
    };
  `;
  fs.writeFileSync(promptPolyfillPath, polySrc, { encoding: "utf8" });
} catch (e) {
  // If writing fails, continue without polyfill; prompt() will simply be undefined.
}

function send(obj) {
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
    process.stdout.flush?.();
  } catch (e) {
    // ignore
  }
}

function normalizeFile(url = "") {
  return url.startsWith("file://") ? url.slice("file://".length) : url;
}

function safeVal(v) {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && v.description) return v.description;
  if (typeof v === "object" && v.value !== undefined) return String(v.value);
  return typeof v;
}

// Inspector session state
let inspectorWS = null;
let inspectorId = 0;
const pending = new Map();
let pausedFrame = null;
let isPaused = false;
const bpMap = new Map(); // key `${file}:${line}` -> breakpointId

function inspectorPost(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++inspectorId;
    pending.set(id, { resolve, reject });
    inspectorWS.send(JSON.stringify({ id, method, params }));
  });
}

function onInspectorMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (e) {
    return;
  }
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message || String(msg.error)));
    else resolve(msg.result);
    return;
  }

  const params = msg.params || {};
  if (msg.method === "Debugger.paused") {
    isPaused = true;
    handlePaused(params).catch(() => {});
  } else if (msg.method === "Runtime.exceptionThrown") {
    const exc = params.exceptionDetails || {};
    const text =
      exc.text ||
      (exc.exception && (exc.exception.description || exc.exception.value)) ||
      "Exception";
    send({
      event: "exception",
      body: { message: text, file: normalizeFile(exc.url || ""), line: exc.lineNumber ? exc.lineNumber + 1 : null },
    });
  } else if (msg.method === "Debugger.resumed") {
    isPaused = false;
  } else if (msg.method === "Runtime.executionContextCreated") {
    // If the process is sitting at the initial break waiting for the debugger,
    // signal paused so a 'continue' will be accepted right after attach.
    isPaused = true;
  }
}

async function collectLocals(frame) {
  const locals = {};
  if (!frame) return locals;
  for (const scope of frame.scopeChain || []) {
    if (!scope.object?.objectId) continue;
    if (!["local", "closure", "catch", "block", "module"].includes(scope.type)) {
      continue;
    }
    try {
      const res = await inspectorPost("Runtime.getProperties", {
        objectId: scope.object.objectId,
        ownProperties: true,
      });
      for (const prop of res.result || []) {
        if (prop.name && !(prop.name in locals)) {
          locals[prop.name] = safeVal(prop.value);
        }
      }
    } catch (e) {
      // ignore failures per scope
    }
  }
  return locals;
}

async function handlePaused(params) {
  pausedFrame = params.callFrames?.[0] ?? null;
  const frame = pausedFrame;
  const loc = frame?.location;
  const url = frame?.url || "";
  const file = normalizeFile(url);
  const line = loc ? Number(loc.lineNumber) + 1 : null;
  const functionName = frame?.functionName || null;

  let locals = {};
  try {
    locals = await collectLocals(frame);
  } catch (e) {
    locals = {};
  }

  const stack =
    (params.callFrames || []).map((cf) => ({
      file: normalizeFile(cf.url),
      line: cf.location ? Number(cf.location.lineNumber) + 1 : null,
      function: cf.functionName || null,
    })) || [];

  send({
    event: "stopped",
    body: { file, line, stack, locals, function: functionName },
  });
}

async function clearBreakpoints() {
  for (const [, id] of bpMap.entries()) {
    try {
      await inspectorPost("Debugger.removeBreakpoint", { breakpointId: id });
    } catch (e) {
      // ignore
    }
  }
  bpMap.clear();
}

async function addBreakpoint(bp) {
  if (!bp) return;
  const key = `${bp.file}:${bp.line}`;
  if (bpMap.has(key)) return;
  const file = bp.file || "";
  const url = file.startsWith("file://") ? file : `file://${path.resolve(file)}`;
  const res = await inspectorPost("Debugger.setBreakpointByUrl", {
    url,
    lineNumber: Math.max(0, Number(bp.line || 1) - 1),
  });
  if (res.breakpointId) {
    bpMap.set(key, res.breakpointId);
  }
}

async function setBreakpoints(bps) {
  await clearBreakpoints();
  for (const bp of bps || []) {
    try {
      await addBreakpoint(bp);
    } catch (e) {
      // ignore failed bp
    }
  }
  send({ event: "breakpoints_set", body: { ok: true } });
}

async function evalOnTop(expr) {
  if (!pausedFrame) {
    return { error: "not paused" };
  }
  try {
    const res = await inspectorPost("Debugger.evaluateOnCallFrame", {
      callFrameId: pausedFrame.callFrameId,
      expression: expr,
      generatePreview: true,
      returnByValue: false,
    });
    return { value: safeVal(res.result) };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

async function handleCommand(cmd) {
  if (!inspectorWS || inspectorWS.readyState !== WebSocket.OPEN) {
    throw new Error("inspector not ready");
  }
  const t = cmd.type;
  if (t === "continue") {
    try { return await inspectorPost("Debugger.resume"); } catch (e) { return; }
  }
  if (t === "step_over") {
    try { return await inspectorPost("Debugger.stepOver"); } catch (e) { return; }
  }
  if (t === "step_in") {
    try { return await inspectorPost("Debugger.stepInto"); } catch (e) { return; }
  }
  if (t === "step_out") {
    try { return await inspectorPost("Debugger.stepOut"); } catch (e) { return; }
  }
  if (t === "set_breakpoints") return setBreakpoints(cmd.breakpoints || []);
  if (t === "add_breakpoint") {
    const bp = cmd.breakpoints && cmd.breakpoints.length ? cmd.breakpoints[0] : cmd;
    await addBreakpoint(bp);
    send({ event: "breakpoints_set", body: { ok: true } });
    return;
  }
  if (t === "remove_breakpoint") {
    const key = `${cmd.file}:${cmd.line}`;
    const id = bpMap.get(key);
    if (id) {
      try {
        await inspectorPost("Debugger.removeBreakpoint", { breakpointId: id });
      } catch (e) {
        // ignore
      }
      bpMap.delete(key);
    }
    send({ event: "breakpoints_set", body: { ok: true } });
    return;
  }
  if (t === "evaluate") {
    const expr = cmd.expr || "";
    const res = await evalOnTop(expr);
    send({ event: "evaluate_result", body: { expr, ...res } });
    return;
  }
  if (t === "stdin") {
    const data = cmd.data || "";
    try {
      if (child.stdin.writable) {
        child.stdin.write(data);
      }
    } catch (e) {
      // ignore broken pipe
    }
    return;
  }
  if (t === "stop") {
    try {
      child?.kill();
    } catch (e) {
      // ignore
    }
    process.exit(0);
  }
}

// Spawn the user program under inspector and bridge inspector events/commands.
const child = spawn(
  process.execPath,
  ["--inspect-brk=0", "--require", promptPolyfillPath, absEntry, ...userArgs],
  {
    cwd: workdir,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  }
);

function emitOutput(text, stream = "stdout") {
  if (!text) return;
  send({ event: "output", body: { text, stream } });
  // Heuristic: if stdout does not end with a newline, surface await_input so UI can enable the input box.
  if (stream === "stdout" && !text.endsWith("\n")) {
    send({ event: "await_input", body: { prompt: "" } });
  }
}

child.stdout.on("data", (buf) => {
  emitOutput(buf.toString(), "stdout");
});
child.stderr.on("data", (buf) => {
  const text = buf.toString();
  emitOutput(text, "stderr");
  const m = text.match(/ws:\/\/[^\s]+/); // inspector announces: ws://127.0.0.1:PORT/...
  if (m && !inspectorWS) {
    connectInspector(m[0]).catch((e) => {
      send({ event: "exception", body: { message: String(e) } });
      try {
        child.kill();
      } catch (_) {}
      process.exit(1);
    });
  }
});
child.on("exit", (code) => {
  send({ event: "terminated", body: { code } });
  process.exit(0);
});

async function connectInspector(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    inspectorWS = ws;
    ws.on("open", async () => {
      try {
        await inspectorPost("Runtime.enable");
        await inspectorPost("Debugger.enable");
        await inspectorPost("Debugger.setPauseOnExceptions", { state: "none" });

        // initial breakpoints from env
        const initBps = process.env.OC_INIT_BPS;
        if (initBps) {
          try {
            const bps = JSON.parse(initBps);
            await setBreakpoints(bps);
          } catch (e) {
            // ignore invalid
          }
        }

        // Force an initial pause so the client can continue/step reliably.
        try {
          await inspectorPost("Debugger.pause");
        } catch (e) {
          // ignore
        }

        // If Node is waiting for the debugger (inspect-brk), let it run now.
        try {
          await inspectorPost("Runtime.runIfWaitingForDebugger");
        } catch (e) {
          // ignore
        }
        resolve();
      } catch (e) {
        reject(e);
      }
    });
    ws.on("message", (data) => onInspectorMessage(data.toString()));
    ws.on("error", (err) => {
      if (!ws._readyRejected) {
        ws._readyRejected = true;
        reject(err);
      } else {
        send({ event: "exception", body: { message: String(err) } });
      }
    });
    ws.on("close", () => {
      pending.forEach(({ reject }) => reject(new Error("inspector closed")));
      pending.clear();
    });
  });
}

// Command reader
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line.trim()) return;
  try {
    const cmd = JSON.parse(line);
    handleCommand(cmd).catch((e) => {
      send({ event: "exception", body: { message: String(e) } });
    });
  } catch (e) {
    // ignore malformed
  }
});
