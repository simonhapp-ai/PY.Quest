import { isLektionUnlocked } from "../registry.js";
import { bindActivate } from "../util.js";

export function renderPath(view, ctx, teilId) {
  const { registry, store, navigate } = ctx;
  const teil = registry.find((t) => t.id === teilId);
  if (!teil) return navigate("#/home");

  const werkstattDone = store.countWerkstattDone(teil.id, teil.werkstatt);
  const allLektionenDone = teil.lektionen.every((l) => store.isLektionCompleted(teil.id, l.id));

  const rows = teil.lektionen
    .map((lek, i) => {
      const unlocked = isLektionUnlocked(teil, lek, store);
      const done = store.isLektionCompleted(teil.id, lek.id);
      const isActive = unlocked && !done;
      const state = done ? "done" : isActive ? "active" : "locked";
      return `
        <div class="node-row ${state}" data-lektion="${lek.id}" style="--node-color:${lek.farbe}"
          tabindex="0" role="button" aria-disabled="${unlocked ? "false" : "true"}">
          <div class="node-dot">${done ? "✔" : unlocked ? lek.icon : "🔒"}</div>
          <div class="node-info">
            <h3>${i + 1}. ${lek.titel}</h3>
            <p>${lek.kurz}</p>
          </div>
        </div>`;
    })
    .join("");

  const doneCount = teil.lektionen.filter((l) => store.isLektionCompleted(teil.id, l.id)).length;
  const fillPct = teil.lektionen.length ? Math.round((doneCount / teil.lektionen.length) * 100) : 0;

  view.innerHTML = `
    <div class="view-narrow">
      <div class="crumbs"><a data-nav="#/home">Home</a> / ${teil.titel}</div>
      <h1 class="headline" style="color:${teil.farbe}; margin-bottom:4px;">Teil ${teil.nummer} — ${teil.titel}</h1>
      <p style="color:var(--dim); margin-top:0;">${teil.untertitel}</p>

      <div style="display:flex; gap:12px; margin:18px 0 28px;">
        <button class="btn" id="btn-revision">📖 Revision</button>
        <button class="btn ${allLektionenDone ? "" : ""}" id="btn-werkstatt" ${
    allLektionenDone ? "" : "disabled"
  } title="${allLektionenDone ? "" : "Erst freigeschaltet, wenn alle Lektionen fertig sind"}">
          🏗 Werkstatt ${allLektionenDone ? `(${werkstattDone}/${teil.werkstatt.length} Projekte gebaut)` : "— gesperrt"}
        </button>
      </div>

      <div class="node-map">
        <div class="fill-line" style="height:${fillPct}%"></div>
        ${rows}
      </div>
    </div>`;

  view.querySelector("[data-nav]").addEventListener("click", () => navigate("#/home"));
  view.querySelector("#btn-revision").addEventListener("click", () => navigate("#/revision"));
  view.querySelector("#btn-werkstatt").addEventListener("click", () => {
    if (allLektionenDone) navigate(`#/werkstatt/${teil.id}`);
  });

  view.querySelectorAll(".node-row").forEach((row) => {
    bindActivate(row, () => {
      const lek = teil.lektionen.find((l) => l.id === row.dataset.lektion);
      if (!isLektionUnlocked(teil, lek, store)) return;
      navigate(`#/lesson/${teil.id}/${lek.id}`);
    });
  });
}
