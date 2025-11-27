// Minimal Node.js debugger shim (inspector-based) that mirrors the Python bdb bridge.
// Communicates via JSON over stdin/stdout:
// - Emits events: stopped, exception, evaluate_result, terminated, breakpoints_set
// - Accepts commands: continue, step_over, step_in, step_out, set_breakpoints,
//   evaluate, stop, add_breakpoint, remove_breakpoint
const fs = require("fs");
const path = require("path");
const inspector = require("inspector");
const readline = require("readline");

const entry = process.argv[2];
const userArgs = process.argv.slice(3);
if (!entry) {
  process.stderr.write("Usage: node oc_js_debugger.js <entry.js> [args...]\n");
  process.exit(1);
}

// Make argv look like "node entry.js ..."
process.argv = [process.argv[0], entry, ...userArgs];

const session = new inspector.Session();
session.connect();

let pausedFrame = null;
const bpMap = new Map(); // key: `${file}:${line}` -> breakpointId
let bpList = [];
let entryBreakpointId = null;
const absEntry = path.resolve(entry);

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

function safeVal(prop) {
  const v = prop?.value;
  if (!v) return prop?.name ? `${prop.name}=<unavailable>` : "<unavailable>";
  if (v.type === "string") return v.value;
  if (v.type === "number" || v.type === "boolean") return String(v.value);
  if (v.type === "undefined") return "undefined";
  if (v.type === "object" && v.subtype === "null") return "null";
  return v.description ?? v.className ?? v.type ?? "<unknown>";
}

function post(method, params) {
  return new Promise((resolve, reject) => {
    session.post(method, params, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
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
      const res = await post("Runtime.getProperties", {
        objectId: scope.object.objectId,
        ownProperties: true,
      });
      for (const prop of res.result || []) {
        if (prop.name && !(prop.name in locals)) {
          locals[prop.name] = safeVal(prop);
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
  const url = frame?.url || (frame?.scriptId ? frame.url : "");
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

  // Drop the auto entry breakpoint after first pause to avoid re-break on resume.
  if (entryBreakpointId) {
    try {
      await post("Debugger.removeBreakpoint", { breakpointId: entryBreakpointId });
    } catch (e) {
      // ignore
    }
    entryBreakpointId = null;
  }
}

session.on("Debugger.paused", (ev) => {
  handlePaused(ev.params || {}).catch(() => {});
});

session.on("Runtime.exceptionThrown", (ev) => {
  const detail = ev.params || {};
  const exc = detail.exceptionDetails || {};
  const text =
    exc.text ||
    (exc.exception && (exc.exception.description || exc.exception.value)) ||
    "Exception";
  send({
    event: "exception",
    body: { message: text, file: normalizeFile(exc.url || ""), line: exc.lineNumber ? exc.lineNumber + 1 : null },
  });
});

process.on("exit", () => {
  send({ event: "terminated", body: {} });
});

process.on("uncaughtException", (err) => {
  send({ event: "exception", body: { message: err?.stack || String(err) } });
  process.exit(1);
});

async function clearBreakpoints() {
  for (const [, id] of bpMap.entries()) {
    try {
      await post("Debugger.removeBreakpoint", { breakpointId: id });
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
  const res = await post("Debugger.setBreakpointByUrl", {
    url,
    lineNumber: Math.max(0, Number(bp.line || 1) - 1),
  });
  if (res.breakpointId) {
    bpMap.set(key, res.breakpointId);
    bpList.push({ file: bp.file, line: bp.line });
    if (bp.__entry) entryBreakpointId = res.breakpointId;
  }
}

async function setBreakpoints(bps) {
  bpList = [];
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
    const res = await post("Debugger.evaluateOnCallFrame", {
      callFrameId: pausedFrame.callFrameId,
      expression: expr,
      generatePreview: true,
      returnByValue: false,
    });
    const val = res.result;
    return { value: safeVal({ value: val }) };
  } catch (e) {
    return { error: String(e.message || e) };
  }
}

async function handleCommand(cmd) {
  const t = cmd.type;
  if (t === "continue") {
    await post("Debugger.resume");
    return;
  }
  if (t === "step_over") return post("Debugger.stepOver");
  if (t === "step_in") return post("Debugger.stepInto");
  if (t === "step_out") return post("Debugger.stepOut");
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
        await post("Debugger.removeBreakpoint", { breakpointId: id });
      } catch (e) {
        // ignore
      }
      bpMap.delete(key);
      bpList = bpList.filter((b) => !(b.file === cmd.file && Number(b.line) === Number(cmd.line)));
    }
    return send({ event: "breakpoints_set", body: { ok: true } });
  }
  if (t === "evaluate") {
    const expr = cmd.expr || "";
    const res = await evalOnTop(expr);
    return send({ event: "evaluate_result", body: { expr, ...res } });
  }
  if (t === "stop") {
    process.exit(0);
  }
}

async function main() {
  await post("Debugger.enable");
  await post("Runtime.enable");
  await post("Debugger.setPauseOnExceptions", { state: "none" });

  // initial breakpoints from env
  const initBps = process.env.OC_INIT_BPS;
  if (initBps) {
    try {
      const bps = JSON.parse(initBps);
      await setBreakpoints(bps);
    } catch (e) {
      // ignore invalid env
    }
  }

  // Start reading commands from stdin
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    try {
      const cmd = JSON.parse(line);
      handleCommand(cmd).catch(() => {});
    } catch (e) {
      // ignore malformed
    }
  });

  // Set an entry breakpoint on line 1 to pause immediately before running user code.
  try {
    const res = await post("Debugger.setBreakpointByUrl", {
      url: `file://${absEntry}`,
      lineNumber: 0,
    });
    entryBreakpointId = res.breakpointId || null;
  } catch (e) {
    entryBreakpointId = null;
  }

  // Execute user script
  process.chdir(path.dirname(absEntry));
  try {
    require(absEntry);
  } catch (err) {
    send({ event: "exception", body: { message: err?.stack || String(err) } });
    process.exit(1);
  }
}

main().catch((e) => {
  send({ event: "exception", body: { message: e?.stack || String(e) } });
  process.exit(1);
});
