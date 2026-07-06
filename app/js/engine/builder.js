import { TermView } from "../python/terminal.js";
import { evaluateCheck } from "../python/checker.js";
import { escapeHtml } from "../util.js";

const SOFT_WARNING_MS = 10000;

/**
 * Mounts the editor+terminal split view used by both "build" lesson tasks and
 * Werkstatt-Projekte. `spec`: { prompt, starter, check, hints, loesung, ex, xp, onDone(result) }
 * `result` passed to onDone: 'correct' | 'wrong-attempt' | 'solved-no-xp'
 */
export function mountBuilder(container, ctx, spec) {
  const { runtime } = ctx;
  let hintsRevealed = 0;
  let solutionUnlocked = false;
  let wrongAttempts = 0;
  let running = false;
  let softWarnTimer = null;
  let stopEscalateTimer = null;

  container.innerHTML = `
    <div class="task-q">${spec.prompt}</div>
    <div class="builder-layout">
      <div class="builder-pane">
        <div class="pane-title">Editor</div>
        <textarea class="code-editor" id="code-editor" spellcheck="false">${escapeHtml(
          spec.starter || ""
        )}</textarea>
        <div class="editor-toolbar">
          <button class="btn" id="btn-run" title="⌘↵">▶ Ausführen</button>
          <button class="btn" id="btn-reset">↺ Reset</button>
          <button class="btn" id="btn-hint">💡 Hinweis</button>
          <button class="btn btn-primary" id="btn-submit" title="⌘⇧↵">✓ Abgeben</button>
        </div>
      </div>
      <div class="builder-pane">
        <div class="pane-title">Terminal</div>
        <div class="term-wrap" id="term-wrap"></div>
        <div class="running-banner" id="running-banner">
          <span>Läuft noch …</span>
          <button id="btn-stop">■ Stoppen</button>
        </div>
      </div>
    </div>
    <div class="hints-box" id="hints-box"></div>
    <div class="task-feedback" id="builder-feedback"></div>
  `;

  const editor = container.querySelector("#code-editor");
  const term = new TermView(container.querySelector("#term-wrap"));
  const runBtn = container.querySelector("#btn-run");
  const resetBtn = container.querySelector("#btn-reset");
  const hintBtn = container.querySelector("#btn-hint");
  const submitBtn = container.querySelector("#btn-submit");
  const stopBtn = container.querySelector("#btn-stop");
  const banner = container.querySelector("#running-banner");
  const hintsBox = container.querySelector("#hints-box");
  const feedbackEl = container.querySelector("#builder-feedback");

  editor.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.value = editor.value.slice(0, start) + "    " + editor.value.slice(end);
      editor.selectionStart = editor.selectionEnd = start + 4;
      return;
    }
    if (e.metaKey && e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) submitBtn.click();
      else runBtn.click();
      return;
    }
    if (e.key === "Enter") {
      // Auto-indent: continue the current line's indentation, plus one more level
      // after a line ending in ':' — indentation is the classic Python beginner hurdle.
      e.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const before = editor.value.slice(0, start);
      const after = editor.value.slice(end);
      const lineStart = before.lastIndexOf("\n") + 1;
      const currentLine = before.slice(lineStart);
      let indent = (currentLine.match(/^[ \t]*/) || [""])[0];
      if (/:\s*$/.test(currentLine.trim())) indent += "    ";
      const insertion = "\n" + indent;
      editor.value = before + insertion + after;
      editor.selectionStart = editor.selectionEnd = start + insertion.length;
    }
  });

  function setRunning(v) {
    running = v;
    runBtn.disabled = v;
    submitBtn.disabled = v;
    if (v) {
      softWarnTimer = setTimeout(() => banner.classList.add("show"), SOFT_WARNING_MS);
    } else {
      clearTimeout(softWarnTimer);
      clearTimeout(stopEscalateTimer);
      banner.classList.remove("show");
    }
  }

  runBtn.addEventListener("click", async () => {
    term.clear();
    setRunning(true);
    const res = await runtime.runInteractive(editor.value, {
      onStdout: (t) => term.write(t + "\n"),
      onStderr: (t) => term.writeErr(t + "\n"),
      onStdinRequest: async (id) => {
        const line = await term.waitForLine();
        runtime.provideStdinLine(id, line);
      },
    });
    if (!res.ok && res.error) term.writeErr("\n" + res.error + "\n");
    setRunning(false);
  });

  resetBtn.addEventListener("click", () => {
    const starter = spec.starter || "";
    if (editor.value !== starter && !confirm("Editor wirklich zurücksetzen? Deine Eingabe geht verloren.")) {
      return;
    }
    editor.value = starter;
    term.clear();
  });

  stopBtn.addEventListener("click", async () => {
    await runtime.forceRestart();
    setRunning(false);
    term.writeInfo("Ausführung wurde gestoppt.");
  });

  function renderHints() {
    hintsBox.innerHTML = spec.hints
      .slice(0, hintsRevealed)
      .map((h, i) => `<div class="hint-item">💡 ${i + 1}. ${h}</div>`)
      .join("");
    if (solutionUnlocked) {
      hintsBox.innerHTML += `<button class="btn" id="btn-solution">Musterlösung ansehen</button>`;
      const solBtn = hintsBox.querySelector("#btn-solution");
      solBtn?.addEventListener("click", () => {
        editor.value = spec.loesung;
        feedbackEl.classList.add("show", "err");
        feedbackEl.textContent =
          "Musterlösung eingesetzt — diese Aufgabe zählt als gelöst, aber ohne XP.";
        runBtn.disabled = true;
        submitBtn.disabled = true;
        hintBtn.disabled = true;
        resetBtn.disabled = true;
        spec.onDone("solved-no-xp");
      });
    }
  }

  hintBtn.addEventListener("click", () => {
    if (hintsRevealed < spec.hints.length) {
      hintsRevealed++;
      renderHints();
    }
  });

  submitBtn.addEventListener("click", async () => {
    setRunning(true);
    feedbackEl.classList.remove("show", "ok", "err");
    const result = await runtime.runCheck(editor.value, {
      tests: spec.check.tests || "",
      stdin: spec.check.stdin || [],
      onStdout: (t) => term.write(t + "\n"),
    });
    setRunning(false);
    const verdict = evaluateCheck(result, spec.check);
    if (verdict.passed) {
      feedbackEl.classList.add("show", "ok");
      feedbackEl.textContent = `✔ ${spec.ex || "Gelöst!"} (+${spec.xp} XP)`;
      // Lock the toolbar: the caller advances to the next task ~900ms later, and a
      // second click in that window would otherwise re-fire onDone (double XP/advance).
      runBtn.disabled = true;
      submitBtn.disabled = true;
      hintBtn.disabled = true;
      resetBtn.disabled = true;
      spec.onDone("correct");
    } else {
      // Only the first failed submit feeds the revision system — otherwise a task
      // someone struggles with for 5 attempts would count 5x as "wrong".
      if (wrongAttempts === 0) spec.onWrongAttempt?.();
      wrongAttempts++;
      feedbackEl.classList.add("show", "err");
      feedbackEl.textContent = `✘ ${verdict.detail}`;
      if (wrongAttempts >= 3) {
        solutionUnlocked = true;
        renderHints();
      }
    }
  });

  renderHints();

  return {
    dispose() {
      clearTimeout(softWarnTimer);
      clearTimeout(stopEscalateTimer);
      term.dispose();
    },
  };
}
