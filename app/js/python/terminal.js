// Thin wrapper around xterm.js (loaded globally via <script>, see index.html)
// that turns raw keystrokes into line-buffered input for Python's input().

export class TermView {
  constructor(container) {
    this.container = container;
    this.term = new window.Terminal({
      fontFamily: '"IBM Plex Mono", monospace',
      fontSize: 13,
      theme: {
        background: "#04060b",
        foreground: "#dbe4f5",
        cursor: "#4fd8eb",
        selectionBackground: "#1c2740",
      },
      convertEol: true,
      cursorBlink: true,
      disableStdin: true,
    });
    this.fitAddon = new window.FitAddon.FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(container);
    this.fitAddon.fit();

    this._resizeObserver = new ResizeObserver(() => this.fitAddon.fit());
    this._resizeObserver.observe(container);

    this._lineBuffer = "";
    this._lineCallback = null;
    this.term.onData((data) => this._handleData(data));
  }

  write(text) {
    this.term.write(text.replace(/\n/g, "\r\n"));
  }

  writeErr(text) {
    this.term.write(`\x1b[38;2;255;107;94m${text.replace(/\n/g, "\r\n")}\x1b[0m`);
  }

  writeInfo(text) {
    this.term.write(`\x1b[38;2;120;137;168m${text.replace(/\n/g, "\r\n")}\x1b[0m\r\n`);
  }

  clear() {
    this.term.clear();
    this.term.reset();
  }

  focus() {
    this.term.focus();
  }

  fit() {
    this.fitAddon.fit();
  }

  dispose() {
    this._resizeObserver.disconnect();
    this.term.dispose();
  }

  /** Resolves with one line of text once the user presses Enter. Echoes keystrokes live. */
  waitForLine() {
    this.term.options.disableStdin = false;
    this.term.focus();
    return new Promise((resolve) => {
      this._lineBuffer = "";
      this._lineCallback = resolve;
    });
  }

  _handleData(data) {
    if (!this._lineCallback) return;
    for (const ch of data) {
      const code = ch.charCodeAt(0);
      if (ch === "\r" || ch === "\n") {
        this.term.write("\r\n");
        const line = this._lineBuffer;
        this._lineBuffer = "";
        const cb = this._lineCallback;
        this._lineCallback = null;
        this.term.options.disableStdin = true;
        cb(line);
        return;
      }
      if (code === 127 || code === 8) {
        // backspace
        if (this._lineBuffer.length > 0) {
          this._lineBuffer = this._lineBuffer.slice(0, -1);
          this.term.write("\b \b");
        }
        continue;
      }
      if (code < 32) continue; // ignore other control chars
      this._lineBuffer += ch;
      this.term.write(ch);
    }
  }
}
