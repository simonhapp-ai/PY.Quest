// Owns the Pyodide Worker lifecycle and exposes a small promise-based API.
// The engine (builder.js, lesson.js, ...) never talks to the Worker directly.

class PyodideRuntime {
  constructor() {
    this.worker = null;
    this.ready = false;
    this.readyPromise = null;

    this._statusListeners = new Set();
    this._active = null; // { onStdout, onStderr, onStdinRequest, resolve }
  }

  onStatus(fn) {
    this._statusListeners.add(fn);
    return () => this._statusListeners.delete(fn);
  }

  _emitStatus(status) {
    for (const fn of this._statusListeners) fn(status);
  }

  init() {
    if (this.readyPromise) return this.readyPromise;
    this._emitStatus("loading");
    this.readyPromise = this._spawnWorker();
    return this.readyPromise;
  }

  _spawnWorker() {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL("./pyodide.worker.js", import.meta.url));
      this.worker = worker;

      worker.onmessage = (event) => this._handleMessage(event.data, resolve, reject);
      worker.onerror = (err) => {
        this._emitStatus("error");
        reject(err);
      };

      worker.postMessage({ cmd: "init" });
    });
  }

  _handleMessage(msg, readyResolve, readyReject) {
    switch (msg.type) {
      case "ready":
        this.ready = true;
        this._emitStatus("ready");
        readyResolve();
        break;
      case "init-error":
        console.error("[pyodide init-error]", msg.error);
        this._emitStatus("error");
        readyReject(new Error(msg.error));
        break;
      case "debug":
        console.log("[worker debug]", msg.text);
        break;
      case "stdout":
        this._active?.onStdout?.(msg.text);
        break;
      case "stderr":
        this._active?.onStderr?.(msg.text);
        break;
      case "stdin-request":
        this._active?.onStdinRequest?.(msg.id);
        break;
      case "run-done":
        this._active?.resolve?.({ ok: msg.ok, error: msg.error || null });
        this._active = null;
        break;
      case "check-done":
        this._active?.resolve?.({
          stdout: msg.stdout,
          userError: msg.userError,
          testError: msg.testError,
        });
        this._active = null;
        break;
      case "repl-done":
        this._active?.resolve?.({ ok: msg.ok, error: msg.error || null });
        this._active = null;
        break;
      case "repl-reset-done":
        this._active?.resolve?.();
        this._active = null;
        break;
      default:
        break;
    }
  }

  /** Feed one line of user-typed input to a blocked input() call (matched by request id). */
  provideStdinLine(id, text) {
    window.pyquest?.provideStdinLine?.(id, text);
  }

  /**
   * Hard stop: terminates and respawns the worker unconditionally. There is no
   * cooperative interrupt in this build (see pyodide.worker.js for why), so this is
   * also what the "Stop" button uses for infinite-loop protection — it is instant and
   * always available regardless of what the Python code is doing.
   */
  async forceRestart() {
    this.worker?.terminate();
    this.ready = false;
    this.readyPromise = null;
    // A run that was in flight never gets its run-done/check-done message now that
    // the worker is gone — resolve it here so the caller's await doesn't hang forever.
    if (this._active) {
      const stopped = this._active;
      this._active = null;
      if (stopped.kind === "check") {
        stopped.resolve?.({ stdout: "", userError: "Ausführung wurde gestoppt.", testError: null });
      } else {
        stopped.resolve?.({ ok: false, error: "Ausführung wurde gestoppt." });
      }
    }
    await this.init();
  }

  /** True while a run/check/repl call is in flight and holding the single `_active` slot. */
  isBusy() {
    return this._active !== null;
  }

  runInteractive(code, { onStdout, onStderr, onStdinRequest } = {}) {
    if (this._active) {
      return Promise.resolve({
        ok: false,
        error: "Python führt gerade etwas anderes aus. Bitte kurz warten.",
      });
    }
    return new Promise((resolve) => {
      this._active = { kind: "run", onStdout, onStderr, onStdinRequest, resolve };
      this.worker.postMessage({ cmd: "run", code });
    });
  }

  runCheck(code, { tests = "", stdin = [], onStdout } = {}) {
    if (this._active) {
      return Promise.resolve({
        stdout: "",
        userError: "Python führt gerade etwas anderes aus. Bitte kurz warten.",
        testError: null,
      });
    }
    return new Promise((resolve) => {
      this._active = { kind: "check", onStdout, resolve };
      this.worker.postMessage({ cmd: "check", code, tests, stdin });
    });
  }

  runRepl(code, { onStdout, onStderr, onStdinRequest } = {}) {
    if (this._active) {
      return Promise.resolve({
        ok: false,
        error: "Python führt gerade etwas anderes aus. Bitte kurz warten.",
      });
    }
    return new Promise((resolve) => {
      this._active = { kind: "repl", onStdout, onStderr, onStdinRequest, resolve };
      this.worker.postMessage({ cmd: "repl", code });
    });
  }

  resetRepl() {
    if (this._active) return Promise.resolve();
    return new Promise((resolve) => {
      this._active = { kind: "repl-reset", resolve };
      this.worker.postMessage({ cmd: "repl-reset" });
    });
  }
}

export const runtime = new PyodideRuntime();
