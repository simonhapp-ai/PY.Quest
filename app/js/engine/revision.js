import { renderQuizTask } from "./tasks.js";
import { mountBuilder } from "./builder.js";
import { XP_BUILD, XP_QUIZ } from "../state.js";

const ROUND_SIZE = 10;
const MAX_BUILD_PER_ROUND = 3;

function collectPool(registry, store) {
  const quizPool = [];
  const buildPool = [];
  for (const teil of registry) {
    for (const lek of teil.lektionen) {
      if (!store.isLektionCompleted(teil.id, lek.id)) continue;
      lek.aufgaben.forEach((aufgabe, idx) => {
        const key = `${teil.id}:${lek.id}:${idx}`;
        const weight = store.state.revision.weights[key] || 0;
        const tickets = 1 + weight; // baseline 1, up to 5 when heavily missed
        const entry = { teil, lek, aufgabe, idx, tickets };
        if (aufgabe.t === "build") buildPool.push(entry);
        else quizPool.push(entry);
      });
    }
  }
  return { quizPool, buildPool };
}

function weightedSample(pool, n) {
  const bag = [];
  for (const entry of pool) for (let i = 0; i < entry.tickets; i++) bag.push(entry);
  const picked = [];
  const usedKeys = new Set();
  let guard = 0;
  while (picked.length < n && bag.length && guard < 2000) {
    guard++;
    const i = Math.floor(Math.random() * bag.length);
    const candidate = bag[i];
    const k = `${candidate.teil.id}:${candidate.lek.id}:${candidate.idx}`;
    if (usedKeys.has(k)) continue;
    usedKeys.add(k);
    picked.push(candidate);
  }
  return picked;
}

export function renderRevision(view, ctx) {
  const { registry, store, navigate } = ctx;
  let activeBuilder = null;
  function disposeBuilder() {
    activeBuilder?.dispose?.();
    activeBuilder = null;
  }

  function renderDashboard() {
    disposeBuilder();
    const total = store.state.revision.correct + store.state.revision.wrong;
    const quote = total ? Math.round((store.state.revision.correct / total) * 100) : 0;
    const weak = store.weakLektionen(registry, 5);
    const { quizPool, buildPool } = collectPool(registry, store);
    const canStart = quizPool.length + buildPool.length >= 3;

    view.innerHTML = `
      <div class="view-narrow">
        <div class="crumbs"><a data-nav="#/home">Home</a> / Revision</div>
        <h1 class="headline">📖 Revision</h1>
        <p style="color:var(--dim)">10 zufällige Aufgaben aus allen abgeschlossenen Lektionen — teilübergreifend. Falsch beantwortete Aufgaben kommen häufiger dran, bis du sie zweimal in Folge richtig löst.</p>
        <div class="stat-row">
          <div class="stat-box"><div class="num">${quote}%</div><div class="label">Trefferquote</div></div>
          <div class="stat-box"><div class="num" style="color:var(--ok)">${store.state.revision.correct}</div><div class="label">richtig gesamt</div></div>
          <div class="stat-box"><div class="num" style="color:var(--err)">${store.state.revision.wrong}</div><div class="label">falsch gesamt</div></div>
          <div class="stat-box"><div class="num" style="color:var(--gold)">${store.state.xp}</div><div class="label">XP</div></div>
        </div>
        <h3 style="margin-top:28px;">Schwache Themen</h3>
        ${
          weak.length
            ? `<ul class="weak-list">${weak
                .map((w) => `<li><span>${w.titel}</span><span style="color:var(--orange)">Gewicht ${w.weight}</span></li>`)
                .join("")}</ul>`
            : `<p style="color:var(--dim)">Noch keine schwachen Themen erkannt — weiter so.</p>`
        }
        <div style="margin-top:26px;">
          <button class="btn btn-primary" id="btn-start" ${canStart ? "" : "disabled"}>
            ${canStart ? "10 Fragen starten" : "Schließe zuerst eine Lektion ab"}
          </button>
        </div>
      </div>`;

    view.querySelector("[data-nav]").addEventListener("click", () => navigate("#/home"));
    view.querySelector("#btn-start")?.addEventListener("click", () => startRound());
  }

  function startRound() {
    const { quizPool, buildPool } = collectPool(registry, store);
    const builds = weightedSample(buildPool, Math.min(MAX_BUILD_PER_ROUND, ROUND_SIZE));
    const remaining = ROUND_SIZE - builds.length;
    const quizzes = weightedSample(quizPool, remaining);
    const round = [...quizzes, ...builds].sort(() => Math.random() - 0.5);
    const roundResults = [];
    let i = 0;

    function renderQuestion() {
      disposeBuilder();
      const entry = round[i];
      const isBuild = entry.aufgabe.t === "build";

      view.innerHTML = `
        <div class="view-narrow${isBuild ? " wide" : ""}">
          <div class="crumbs">Revision — Frage ${i + 1}/${round.length} <span style="color:var(--dim)">(${entry.lek.titel})</span></div>
          <div class="task-progress">${round
            .map((_, ri) => `<div class="seg ${ri < i ? "done" : ri === i ? "current" : ""}"></div>`)
            .join("")}</div>
          <div class="task-card" id="rev-card" style="--accent:${entry.lek.farbe}"></div>
        </div>`;

      const cardEl = view.querySelector("#rev-card");
      const key = `${entry.teil.id}:${entry.lek.id}:${entry.idx}`;

      if (!isBuild) {
        renderQuizTask(cardEl, entry.aufgabe, {
          onDone: (result) => {
            roundResults.push(result);
            store.recordAufgabe(entry.teil.id, entry.lek.id, entry.idx, result, { isBuild: false });
            nextQuestion();
          },
        });
      } else {
        activeBuilder = mountBuilder(cardEl, ctx, {
          prompt: entry.aufgabe.q,
          starter: entry.aufgabe.starter,
          check: entry.aufgabe.check,
          hints: entry.aufgabe.hints,
          loesung: entry.aufgabe.loesung,
          ex: entry.aufgabe.ex,
          xp: XP_BUILD,
          onDone: (result) => {
            roundResults.push(result);
            store.recordAufgabe(entry.teil.id, entry.lek.id, entry.idx, result, { isBuild: true });
            setTimeout(nextQuestion, 900);
          },
        });
      }
      void key;
    }

    function nextQuestion() {
      i++;
      if (i >= round.length) renderRoundResult(roundResults);
      else renderQuestion();
    }

    renderQuestion();
  }

  function renderRoundResult(roundResults) {
    disposeBuilder();
    const correct = roundResults.filter((r) => r === "correct").length;
    const wrong = roundResults.length - correct;
    view.innerHTML = `
      <div class="view-narrow">
        <div class="slide-card">
          <h2>Revisionsrunde beendet</h2>
          <div class="stat-row">
            <div class="stat-box"><div class="num" style="color:var(--ok)">${correct}</div><div class="label">richtig</div></div>
            <div class="stat-box"><div class="num" style="color:var(--err)">${wrong}</div><div class="label">falsch</div></div>
          </div>
          <div style="display:flex; gap:10px; justify-content:flex-end;">
            <button class="btn" id="btn-home">Home</button>
            <button class="btn btn-primary" id="btn-again">Neue Runde</button>
          </div>
        </div>
      </div>`;
    view.querySelector("#btn-home").addEventListener("click", () => navigate("#/home"));
    view.querySelector("#btn-again").addEventListener("click", () => renderDashboard());
  }

  renderDashboard();

  return { dispose: disposeBuilder };
}
