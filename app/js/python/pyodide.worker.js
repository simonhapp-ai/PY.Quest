// Runs inside a dedicated (classic, non-module) Worker so a stuck Python program never
// freezes the UI thread. Talks to runtime.js via postMessage.
//
// Blocking input(): CPython's stdin hook must return a string synchronously, and this
// environment cannot use SharedArrayBuffer/Atomics.wait (enabling the required
// Cross-Origin-Embedder-Policy header breaks Worker construction entirely in this
// Electron build — see electron/main.js). Instead we block via a *synchronous XHR*
// to pyquest://app/__stdin__?id=…, a request the main process holds open until the
// renderer's terminal has a line of input for that id. Sync XHR in a dedicated Worker
// is legitimate and does not affect the UI thread.
//
// Infinite-loop protection: no interrupt buffer either, so "Stop" is a hard
// worker.terminate() + respawn from runtime.js, not a cooperative KeyboardInterrupt.
// Loaded lazily via fetch+eval instead of importScripts(): importScripts() against our
// custom pyquest:// protocol was observed to execute pyodide.js's top-level code twice
// within the same worker global, throwing "Identifier 'loadPyodide' has already been
// declared". Fetching the text ourselves and eval'ing it exactly once sidesteps whatever
// duplicate-dispatch quirk that was.
let loadPyodide;
async function ensurePyodideScriptLoaded() {
  if (typeof loadPyodide === "function") return;
  const url = new URL("../../vendor/pyodide/pyodide.js", location.href).href;
  const code = await (await fetch(url)).text();
  (0, eval)(code);
  loadPyodide = self.loadPyodide;
}

let pyodide = null;

function readStdinLine() {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  postMessage({ type: "stdin-request", id });
  const xhr = new XMLHttpRequest();
  xhr.open("GET", `pyquest://app/__stdin__?id=${id}`, false); // synchronous, blocks this worker only
  xhr.send(null);
  return xhr.responseText;
}

function makeQueueStdin(queue) {
  let i = 0;
  return () => {
    if (i >= queue.length) return null; // EOF -> Python raises EOFError, same as a real terminal
    return queue[i++];
  };
}

async function ensurePyodide() {
  if (pyodide) return pyodide;
  await ensurePyodideScriptLoaded();
  const indexURL = new URL("../../vendor/pyodide/", location.href).href;
  pyodide = await loadPyodide({
    indexURL,
    stdout: (text) => postMessage({ type: "stdout", text }),
    stderr: (text) => postMessage({ type: "stderr", text }),
  });
  self.replGlobals = pyodide.globals.get("dict")();
  return pyodide;
}

/**
 * Drops Pyodide's own execution-harness frames (e.g. `_pyodide/_base.py`,
 * `eval_code_async`) from a traceback. A real `python3 script.py` run never shows
 * these — they're an artifact of how Pyodide evaluates the cell, not the user's code —
 * so leaving them in makes a plain NameError look like an internal crash.
 */
function cleanTraceback(message) {
  const lines = message.split("\n");
  if (lines[0] !== "Traceback (most recent call last):") return message;

  const kept = [lines[0]];
  let skipping = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const frame = /^  File "([^"]*)"/.exec(line);
    if (frame) {
      skipping = frame[1].includes("/_pyodide/");
      if (!skipping) kept.push(line);
      continue;
    }
    if (!skipping) kept.push(line);
  }
  // Nothing but the header survived (error happened purely inside Pyodide's own
  // harness, no user frame at all) — fall back to just the final exception line.
  if (kept.length === 1) return lines[lines.length - 1];
  return kept.join("\n");
}

function formatError(err) {
  if (err && err.message) {
    // PythonError.message already contains a full, real CPython traceback.
    return cleanTraceback(String(err.message).trim());
  }
  return String(err);
}

async function runUserCode(code, { globals, stdin }) {
  pyodide.setStdin({ stdin, error: false });
  try {
    await pyodide.runPythonAsync(code, { globals });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: formatError(err) };
  } finally {
    pyodide.setStdin({});
  }
}

self.onmessage = async (event) => {
  const msg = event.data;

  if (msg.cmd === "init") {
    try {
      await ensurePyodide();
      postMessage({ type: "ready" });
    } catch (err) {
      postMessage({ type: "init-error", error: String(err) + "\n" + (err?.stack || "") });
    }
    return;
  }

  if (msg.cmd === "run") {
    // Interactive "Ausführen": fresh namespace, stdin driven live by the terminal.
    const globals = pyodide.globals.get("dict")();
    const result = await runUserCode(msg.code, { globals, stdin: readStdinLine });
    globals.destroy();
    postMessage({ type: "run-done", ...result });
    return;
  }

  if (msg.cmd === "check") {
    // "Abgeben": fresh namespace, pre-seeded stdin queue, stdout captured, then tests.
    const globals = pyodide.globals.get("dict")();
    let stdoutBuf = "";
    const captureOut = (text) => {
      stdoutBuf += text + "\n";
      postMessage({ type: "stdout", text });
    };
    pyodide.setStdout({ batched: captureOut });
    const userResult = await runUserCode(msg.code, {
      globals,
      stdin: makeQueueStdin(msg.stdin || []),
    });

    let testError = null;
    if (userResult.ok && msg.tests) {
      try {
        await pyodide.runPythonAsync(msg.tests, { globals });
      } catch (err) {
        testError = formatError(err);
      }
    }
    pyodide.setStdout({ batched: (text) => postMessage({ type: "stdout", text }) });
    globals.destroy();
    postMessage({
      type: "check-done",
      stdout: stdoutBuf,
      userError: userResult.ok ? null : userResult.error,
      testError,
    });
    return;
  }

  if (msg.cmd === "repl") {
    // Playground: one persistent namespace across the whole session, like `python3` REPL.
    pyodide.setStdin({ stdin: readStdinLine });
    try {
      const value = await pyodide.runPythonAsync(msg.code, { globals: self.replGlobals });
      if (value !== undefined && value !== null) {
        try {
          const repr = pyodide.globals.get("repr")(value);
          postMessage({ type: "stdout", text: repr });
        } catch {
          /* not representable, ignore */
        }
      }
      postMessage({ type: "repl-done", ok: true });
    } catch (err) {
      postMessage({ type: "repl-done", ok: false, error: formatError(err) });
    } finally {
      pyodide.setStdin({});
    }
    return;
  }

  if (msg.cmd === "repl-reset") {
    if (self.replGlobals) self.replGlobals.destroy();
    self.replGlobals = pyodide.globals.get("dict")();
    postMessage({ type: "repl-reset-done" });
  }
};
