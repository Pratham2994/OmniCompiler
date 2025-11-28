// Node inspector bridge that debugs the user program in a child process.
// Communicates over stdin/stdout JSON with the host (same schema as the Python/C++ shims).
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const readline = require("readline");
const net = require("net");
const crypto = require("crypto");
const { EventEmitter } = require("events");
let WebSocketImpl;
try {
  WebSocketImpl = require("ws");
} catch (err) {
  if (typeof globalThis.WebSocket === "function") {
    WebSocketImpl = globalThis.WebSocket;
  } else {
    try {
      const undici = require("undici");
      if (typeof undici.WebSocket === "function") {
        WebSocketImpl = undici.WebSocket;
      }
    } catch (e) {
      /* ignore */
    }
  }
}

if (!WebSocketImpl) {
  WebSocketImpl = createShimWebSocket();
}

const nativeStyleWS =
  WebSocketImpl &&
  WebSocketImpl.prototype &&
  (typeof WebSocketImpl.prototype.on === "function" || typeof WebSocketImpl.prototype.addEventListener === "function");

function createWebSocket(url) {
  if (nativeStyleWS) {
    return new WebSocketImpl(url);
  }
  return new WebSocketImpl(url);
}

function attachWebSocketHandler(ws, event, handler) {
  if (typeof ws.on === "function") {
    ws.on(event, handler);
    return;
  }
  const wrapped = (ev) => {
    if (event === "message") {
      handler(ev && typeof ev.data !== "undefined" ? ev.data : ev);
      return;
    }
    if (event === "error") {
      handler(ev?.error || ev);
      return;
    }
    handler(ev);
  };
  if (typeof ws.addEventListener === "function") {
    ws.addEventListener(event, wrapped);
    return;
  }
  throw new Error("WebSocket implementation does not support 'on' or 'addEventListener'.");
}

function isWebSocketOpen(ws) {
  if (!ws || typeof ws.readyState === "undefined") return false;
  const openState = typeof ws.OPEN === "number" ? ws.OPEN : 1;
  return ws.readyState === openState;
}

function createShimWebSocket() {
  class ShimWebSocket extends EventEmitter {
    constructor(urlStr) {
      super();
      this.url = new URL(urlStr);
      if (this.url.protocol !== "ws:") {
        throw new Error("Only ws:// URLs are supported without the 'ws' package");
      }
      this.readyState = ShimWebSocket.CONNECTING;
      this._handshakeDone = false;
      this._buffer = Buffer.alloc(0);
      const port = Number(this.url.port || 80);
      this._socket = net.connect(port, this.url.hostname, () => this._sendHandshake());
      this._socket.on("data", (chunk) => this._onData(chunk));
      this._socket.on("error", (err) => this.emit("error", err));
      this._socket.on("close", () => {
        if (this.readyState !== ShimWebSocket.CLOSED) {
          this.readyState = ShimWebSocket.CLOSED;
          this.emit("close");
        }
      });
    }

    _sendHandshake() {
      this._key = crypto.randomBytes(16).toString("base64");
      const path = `${this.url.pathname || "/"}${this.url.search || ""}`;
      const headers = [
        `GET ${path} HTTP/1.1`,
        `Host: ${this.url.host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${this._key}`,
        "Sec-WebSocket-Version: 13",
        "\r\n",
      ].join("\r\n");
      this._socket.write(headers);
    }

    _onData(chunk) {
      this._buffer = Buffer.concat([this._buffer, chunk]);
      if (!this._handshakeDone) {
        const sep = this._buffer.indexOf("\r\n\r\n");
        if (sep === -1) return;
        const headerText = this._buffer.slice(0, sep + 4).toString();
        if (!headerText.startsWith("HTTP/1.1 101")) {
          this.emit("error", new Error("WebSocket handshake failed"));
          this._socket.destroy();
          return;
        }
        this._buffer = this._buffer.slice(sep + 4);
        this._handshakeDone = true;
        this.readyState = ShimWebSocket.OPEN;
        this.emit("open");
      }
      this._drainFrames();
    }

    _drainFrames() {
      while (this._buffer.length >= 2) {
        const b0 = this._buffer[0];
        const opcode = b0 & 0x0f;
        const b1 = this._buffer[1];
        const masked = (b1 & 0x80) !== 0;
        let payloadLen = b1 & 0x7f;
        let offset = 2;
        if (payloadLen === 126) {
          if (this._buffer.length < 4) return;
          payloadLen = this._buffer.readUInt16BE(2);
          offset = 4;
        } else if (payloadLen === 127) {
          if (this._buffer.length < 10) return;
          const len64 = this._buffer.readBigUInt64BE(2);
          if (len64 > BigInt(Number.MAX_SAFE_INTEGER)) {
            this.emit("error", new Error("WebSocket frame too large"));
            this._socket.destroy();
            return;
          }
          payloadLen = Number(len64);
          offset = 10;
        }
        if (masked) {
          this.emit("error", new Error("Received masked frame from server"));
          this._socket.destroy();
          return;
        }
        if (this._buffer.length < offset + payloadLen) return;
        const payload = this._buffer.slice(offset, offset + payloadLen);
        this._buffer = this._buffer.slice(offset + payloadLen);
        if (opcode === 0x1) {
          this.emit("message", payload.toString());
        } else if (opcode === 0x8) {
          this.readyState = ShimWebSocket.CLOSING;
          this._socket.end();
          this.readyState = ShimWebSocket.CLOSED;
          this.emit("close");
          return;
        } else if (opcode === 0x9) {
          this._sendFrame(0x0a, payload);
        }
      }
    }

    _sendFrame(opcode, payloadBuf = Buffer.alloc(0)) {
      const payload = Buffer.isBuffer(payloadBuf) ? payloadBuf : Buffer.from(payloadBuf);
      const len = payload.length;
      let header;
      if (len < 126) {
        header = Buffer.alloc(2);
        header[1] = 0x80 | len;
      } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[1] = 0x80 | 126;
        header.writeUInt16BE(len, 2);
      } else {
        header = Buffer.alloc(10);
        header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(len), 2);
      }
      header[0] = 0x80 | opcode;
      const mask = crypto.randomBytes(4);
      const maskedPayload = Buffer.alloc(len);
      for (let i = 0; i < len; i += 1) {
        maskedPayload[i] = payload[i] ^ mask[i % 4];
      }
      this._socket.write(Buffer.concat([header, mask, maskedPayload]));
    }

    send(data) {
      if (this.readyState !== ShimWebSocket.OPEN) {
        throw new Error("WebSocket not open");
      }
      this._sendFrame(0x1, data);
    }

    close() {
      if (this.readyState === ShimWebSocket.CLOSED) return;
      this.readyState = ShimWebSocket.CLOSING;
      this._sendFrame(0x8, Buffer.alloc(0));
      this._socket.end();
    }
  }

  ShimWebSocket.CONNECTING = 0;
  ShimWebSocket.OPEN = 1;
  ShimWebSocket.CLOSING = 2;
  ShimWebSocket.CLOSED = 3;
  return ShimWebSocket;
}

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
let skipInitialPause = true;
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
    if (skipInitialPause) {
      skipInitialPause = false;
      inspectorPost("Debugger.resume").catch(() => {});
      return;
    }
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
  if (!isWebSocketOpen(inspectorWS)) {
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

const INSPECTOR_STDERR_PATTERNS = [
  /Debugger listening on/i,
  /Debugger attached/i,
  /For help, see/i,
  /Waiting for the debugger to disconnect/i,
];

function emitOutput(text, stream = "stdout") {
  if (!text) return;
  if (stream === "stderr") {
    const looksLikeNoise = INSPECTOR_STDERR_PATTERNS.some((pattern) => pattern.test(text));
    if (looksLikeNoise) {
      stream = "stdout";
    }
  }
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
    const ws = createWebSocket(wsUrl);
    inspectorWS = ws;
    attachWebSocketHandler(ws, "open", async () => {
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
    attachWebSocketHandler(ws, "message", (data) => onInspectorMessage(data.toString()));
    attachWebSocketHandler(ws, "error", (err) => {
      if (!ws._readyRejected) {
        ws._readyRejected = true;
        reject(err);
      } else {
        send({ event: "exception", body: { message: String(err) } });
      }
    });
    attachWebSocketHandler(ws, "close", () => {
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
