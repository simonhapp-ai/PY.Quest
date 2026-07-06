import { mountBuilder } from "./builder.js";
import { XP_WERKSTATT } from "../state.js";
import { bindActivate } from "../util.js";

function briefToHtml(brief) {
  // brief is a short ticket description; sentences after the first become bullet points.
  const parts = brief.split(/\n|(?<=[.:])\s+(?=[A-ZÄÖÜ0-9])/).map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return `<p>${brief}</p>`;
  return `<p>${parts[0]}</p><ul class="brief-list">${parts
    .slice(1)
    .map((p) => `<li>${p}</li>`)
    .join("")}</ul>`;
}

export function renderWerkstatt(view, ctx, teilId, projektId) {
  const { registry, store, navigate } = ctx;
  const teil = registry.find((t) => t.id === teilId);
  if (!teil) {
    navigate("#/home");
    return {};
  }
  let activeBuilder = null;

  if (projektId) {
    return renderProjekt(projektId);
  }
  return renderGrid();

  function renderGrid() {
    const doneCount = store.countWerkstattDone(teil.id, teil.werkstatt);
    const cards = teil.werkstatt
      .map((p) => {
        const done = store.isWerkstattDone(teil.id, p.id);
        return `
          <div class="werkstatt-card ${done ? "done" : ""}" data-projekt="${p.id}" style="--accent:${p.farbe}"
            tabindex="0" role="button">
            <div style="font-size:11px; color:var(--dim);">SCHWIERIGKEIT ${"★".repeat(p.schwierigkeit)}${"☆".repeat(
          3 - p.schwierigkeit
        )}</div>
            <h3>${done ? "🏆 " : ""}${p.titel}</h3>
            ${briefToHtml(p.brief)}
            <div class="transfer-tags">${p.transfer.map((t) => `<span class="tag">🔗 ${t}</span>`).join("")}</div>
          </div>`;
      })
      .join("");

    view.innerHTML = `
      <div class="view-narrow">
        <div class="crumbs"><a data-nav="#/home">Home</a> / <a data-nav="#/teil/${teil.id}">${teil.titel}</a> / Werkstatt</div>
        <h1 class="headline" style="color:${teil.farbe}">🏗 Projekt-Werkstatt</h1>
        <p style="color:var(--dim)">🏗 ${doneCount}/${teil.werkstatt.length} Projekte gebaut — keine Zeitlimits, kein Quiz: reine Transferleistung.</p>
        <div class="werkstatt-grid">${cards}</div>
      </div>`;

    view.querySelectorAll("[data-nav]").forEach((a) => a.addEventListener("click", () => navigate(a.dataset.nav)));
    view.querySelectorAll(".werkstatt-card").forEach((card) => {
      bindActivate(card, () => navigate(`#/werkstatt/${teil.id}/${card.dataset.projekt}`));
    });

    return {};
  }

  function renderProjekt(pid) {
    const projekt = teil.werkstatt.find((p) => p.id === pid);
    if (!projekt) {
      navigate(`#/werkstatt/${teil.id}`);
      return {};
    }

    view.innerHTML = `
      <div class="view-narrow wide">
        <div class="crumbs">
          <a data-nav="#/home">Home</a> / <a data-nav="#/teil/${teil.id}">${teil.titel}</a> /
          <a data-nav="#/werkstatt/${teil.id}">Werkstatt</a> / ${projekt.titel}
        </div>
        <div class="task-card" id="projekt-card" style="--accent:${projekt.farbe}"></div>
      </div>`;
    view.querySelectorAll("[data-nav]").forEach((a) => a.addEventListener("click", () => navigate(a.dataset.nav)));

    const cardEl = view.querySelector("#projekt-card");
    activeBuilder = mountBuilder(cardEl, ctx, {
      prompt: `<strong>${projekt.titel}</strong>${briefToHtml(projekt.brief)}`,
      starter: projekt.starter || "",
      check: projekt.check,
      hints: projekt.hints,
      loesung: projekt.loesung,
      ex: "Projekt gelöst — starke Transferleistung!",
      xp: XP_WERKSTATT,
      onDone: (result) => {
        if (result === "correct") {
          store.completeWerkstattProjekt(teil.id, projekt.id);
          setTimeout(() => renderTrophy(projekt), 900);
        }
      },
    });

    return { dispose: () => activeBuilder?.dispose?.() };
  }

  function renderTrophy(projekt) {
    activeBuilder?.dispose?.();
    activeBuilder = null;
    view.innerHTML = `
      <div class="view-narrow">
        <div class="slide-card" style="text-align:center;">
          <h2>🏆 Projekt gebaut!</h2>
          <p>${projekt.titel} ist fertig. +150 XP</p>
          <div style="display:flex; gap:10px; justify-content:center; margin-top:16px;">
            <button class="btn" id="btn-werkstatt">Zurück zur Werkstatt</button>
            <button class="btn btn-primary" id="btn-home">Home</button>
          </div>
        </div>
      </div>`;
    view.querySelector("#btn-werkstatt").addEventListener("click", () => navigate(`#/werkstatt/${teil.id}`));
    view.querySelector("#btn-home").addEventListener("click", () => navigate("#/home"));
  }
}
