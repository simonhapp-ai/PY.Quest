import { renderQuizTask } from "./tasks.js";
import { mountBuilder } from "./builder.js";
import { XP_BUILD } from "../state.js";
import { TermView } from "../python/terminal.js";
import { escapeHtml } from "../util.js";

export function renderLesson(view, ctx, teilId, lektionId) {
  const { registry, store, navigate, runtime } = ctx;
  const teil = registry.find((t) => t.id === teilId);
  const lektion = teil?.lektionen.find((l) => l.id === lektionId);
  if (!teil || !lektion) {
    navigate("#/home");
    return {};
  }

  let phase = "slides";
  let slideIndex = 0;
  let aufgabenIndex = 0;
  const results = []; // 'correct' | 'wrong' | 'solved-no-xp' per aufgabe index
  let xpEarned = 0; // actual XP paid out this run, per store.recordAufgabe()/completeLektion()
  let activeBuilder = null;
  let activeSlideTerm = null;
  let slideStatusUnsub = null;

  function disposeBuilder() {
    activeBuilder?.dispose?.();
    activeBuilder = null;
  }

  function disposeSlideTerm() {
    slideStatusUnsub?.();
    slideStatusUnsub = null;
    activeSlideTerm?.dispose?.();
    activeSlideTerm = null;
  }

  function renderShell(innerHtml) {
    disposeBuilder();
    disposeSlideTerm();
    view.innerHTML = `
      <div class="view-narrow${phase === "build-task" ? " wide" : ""}">
        <div class="crumbs">
          <a data-nav="#/home">Home</a> / <a data-nav="#/teil/${teil.id}">${teil.titel}</a> / ${lektion.titel}
        </div>
        ${innerHtml}
      </div>`;
    view.querySelectorAll("[data-nav]").forEach((a) => {
      a.addEventListener("click", () => navigate(a.dataset.nav));
    });
  }

  function renderSlide() {
    phase = "slide";
    const slide = lektion.slides[slideIndex];
    const dots = lektion.slides
      .map((_, i) => `<div class="slide-dot ${i === slideIndex ? "active" : ""}"></div>`)
      .join("");
    renderShell(`
      <div class="slide-card" style="--accent:${lektion.farbe}">
        <div style="font-size:11px; color:var(--dim); margin-bottom:10px;">SLIDE ${slideIndex + 1}/${
      lektion.slides.length
    }</div>
        <h2>${slide.h}</h2>
        <p>${slide.p}</p>
        ${
          slide.code
            ? `<div class="code-box">${escapeHtml(slide.code)}</div>
        <div class="slide-run-box">
          <div class="slide-run-toolbar">
            <span class="label">Ausgabe</span>
            <div style="display:flex; gap:8px;">
              <button class="btn" id="btn-slide-reset">↺ Terminal leeren</button>
              <button class="btn btn-primary" id="btn-slide-run" style="--accent:${lektion.farbe}">▶ Code ausführen</button>
            </div>
          </div>
          <div class="slide-term-wrap" id="slide-term-wrap"></div>
        </div>`
            : ""
        }
      </div>
      <div class="slide-nav">
        <div class="slide-dots">${dots}</div>
        <div style="display:flex; gap:10px;">
          ${slideIndex > 0 ? `<button class="btn" id="btn-prev">← Zurück</button>` : ""}
          <button class="btn btn-primary" id="btn-next" style="--accent:${lektion.farbe}">
            ${slideIndex < lektion.slides.length - 1 ? "Weiter →" : "Zu den Aufgaben →"}
          </button>
        </div>
      </div>`);

    view.querySelector("#btn-prev")?.addEventListener("click", () => {
      slideIndex--;
      renderSlide();
    });
    view.querySelector("#btn-next").addEventListener("click", () => {
      if (slideIndex < lektion.slides.length - 1) {
        slideIndex++;
        renderSlide();
      } else {
        aufgabenIndex = 0;
        renderTask();
      }
    });

    if (slide.code) {
      const termWrap = view.querySelector("#slide-term-wrap");
      const runBtn = view.querySelector("#btn-slide-run");
      const resetBtn = view.querySelector("#btn-slide-reset");
      activeSlideTerm = new TermView(termWrap);
      activeSlideTerm.writeInfo('Klicke „▶ Code ausführen“ — der Code oben läuft dann echt.');

      let slideRunning = false;
      const updateRunAvailability = (status) => {
        if (slideRunning) return;
        if (status === "ready") {
          runBtn.disabled = false;
          runBtn.textContent = "▶ Code ausführen";
        } else if (status === "error") {
          runBtn.disabled = true;
          runBtn.textContent = "✘ Python-Fehler";
        } else {
          runBtn.disabled = true;
          runBtn.textContent = "⏳ Python lädt …";
        }
      };
      updateRunAvailability(runtime.ready ? "ready" : "loading");
      slideStatusUnsub = runtime.onStatus(updateRunAvailability);

      runBtn.addEventListener("click", async () => {
        if (slideRunning || !runtime.ready) return;
        slideRunning = true;
        runBtn.disabled = true;
        activeSlideTerm.clear();
        const res = await runtime.runInteractive(slide.code, {
          onStdout: (t) => activeSlideTerm.write(t + "\n"),
          onStderr: (t) => activeSlideTerm.writeErr(t + "\n"),
          onStdinRequest: async (id) => {
            const line = await activeSlideTerm.waitForLine();
            runtime.provideStdinLine(id, line);
          },
        });
        if (!res.ok && res.error) activeSlideTerm.writeErr("\n" + res.error + "\n");
        slideRunning = false;
        updateRunAvailability(runtime.ready ? "ready" : "loading");
      });

      resetBtn.addEventListener("click", () => activeSlideTerm.clear());
    }
  }

  function progressSegHtml() {
    return lektion.aufgaben
      .map((_, i) => {
        let cls = "seg";
        if (i === aufgabenIndex) cls += " current";
        else if (results[i] === "correct") cls += " done";
        else if (results[i] === "wrong" || results[i] === "solved-no-xp") cls += " wrong";
        return `<div class="${cls}"></div>`;
      })
      .join("");
  }

  function renderTask() {
    const aufgabe = lektion.aufgaben[aufgabenIndex];
    const isBuild = aufgabe.t === "build";
    phase = isBuild ? "build-task" : "quiz-task";

    renderShell(`
      <div class="task-progress">${progressSegHtml()}</div>
      <div class="task-card" id="task-card" style="--accent:${lektion.farbe}"></div>`);

    const cardEl = view.querySelector("#task-card");

    if (!isBuild) {
      renderQuizTask(cardEl, aufgabe, {
        onDone: (result) => {
          results[aufgabenIndex] = result;
          xpEarned += store.recordAufgabe(teil.id, lektion.id, aufgabenIndex, result, { isBuild: false });
          advance();
        },
      });
    } else {
      activeBuilder = mountBuilder(cardEl, ctx, {
        prompt: aufgabe.q,
        starter: aufgabe.starter,
        check: aufgabe.check,
        hints: aufgabe.hints,
        loesung: aufgabe.loesung,
        ex: aufgabe.ex,
        xp: XP_BUILD,
        onWrongAttempt: () => {
          store.recordAufgabe(teil.id, lektion.id, aufgabenIndex, "wrong", { isBuild: true });
        },
        onDone: (result) => {
          results[aufgabenIndex] = result;
          xpEarned += store.recordAufgabe(teil.id, lektion.id, aufgabenIndex, result, { isBuild: true });
          setTimeout(advance, 900);
        },
      });
    }
  }

  function advance() {
    if (aufgabenIndex < lektion.aufgaben.length - 1) {
      aufgabenIndex++;
      renderTask();
    } else {
      renderLernlog();
    }
  }

  function renderLernlog() {
    phase = "lernlog";
    xpEarned += store.completeLektion(teil.id, lektion.id);
    const correct = results.filter((r) => r === "correct").length;
    const wrong = results.filter((r) => r === "wrong" || r === "solved-no-xp").length;
    const xpGained = xpEarned;

    renderShell(`
      <div class="slide-card" style="--accent:${lektion.farbe}">
        <h2>🎉 Das hast du neu gelernt</h2>
        <ul class="lernlog-list">${lektion.lernlog.map((p) => `<li>${p}</li>`).join("")}</ul>
        <div class="stat-row">
          <div class="stat-box"><div class="num" style="color:var(--ok)">${correct}</div><div class="label">richtig</div></div>
          <div class="stat-box"><div class="num" style="color:var(--err)">${wrong}</div><div class="label">falsch/gelöst</div></div>
          <div class="stat-box"><div class="num" style="color:var(--gold)">+${xpGained}</div><div class="label">XP</div></div>
        </div>
        <div style="display:flex; gap:10px; justify-content:flex-end;">
          <button class="btn" id="btn-path">Lernpfad</button>
          <button class="btn" id="btn-repeat">Wiederholen</button>
          <button class="btn btn-primary" id="btn-next-lesson" style="--accent:${lektion.farbe}">Nächste Lektion →</button>
        </div>
      </div>`);

    view.querySelector("#btn-path").addEventListener("click", () => navigate(`#/teil/${teil.id}`));
    view.querySelector("#btn-repeat").addEventListener("click", () => {
      slideIndex = 0;
      aufgabenIndex = 0;
      results.length = 0;
      renderSlide();
    });
    view.querySelector("#btn-next-lesson").addEventListener("click", () => {
      const idx = teil.lektionen.findIndex((l) => l.id === lektion.id);
      const next = teil.lektionen[idx + 1];
      if (next) navigate(`#/lesson/${teil.id}/${next.id}`);
      else navigate(`#/teil/${teil.id}`);
    });
  }

  renderSlide();

  return {
    dispose() {
      disposeBuilder();
      disposeSlideTerm();
    },
  };
}
