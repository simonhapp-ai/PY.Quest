import { isTeilUnlocked } from "../registry.js";

function ringSvg(fraction, color) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - fraction);
  return `
    <svg width="46" height="46" viewBox="0 0 46 46">
      <circle cx="23" cy="23" r="${r}" fill="none" stroke="var(--line)" stroke-width="4"></circle>
      <circle cx="23" cy="23" r="${r}" fill="none" stroke="${color}" stroke-width="4"
        stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round"></circle>
    </svg>`;
}

export function renderHome(view, ctx) {
  const { registry, store, navigate } = ctx;

  const cards = registry
    .map((teil) => {
      const unlocked = isTeilUnlocked(teil, store);
      const done = store.isTeilCompleted(teil);
      const fraction = store.teilProgressFraction(teil);
      const statusHtml = done
        ? `<span class="status-badge done">✔ abgeschlossen</span>`
        : unlocked
        ? `<span class="status-badge">offen</span>`
        : `<span class="status-badge locked-badge">🔒 ${teil.voraussetzung}</span>`;

      return `
        <div class="teil-card ${unlocked ? "" : "locked"}" data-teil="${teil.id}" style="--accent:${teil.farbe}">
          <div class="num">TEIL ${teil.nummer}</div>
          <h2>${teil.titel}</h2>
          <p class="untertitel">${teil.untertitel}</p>
          <div class="ring-row">
            ${statusHtml}
            <div class="progress-ring-wrap">
              ${ringSvg(fraction, teil.farbe)}
              <div class="ring-label">${Math.round(fraction * 100)}%</div>
            </div>
          </div>
        </div>`;
    })
    .join("");

  const comingSoon = `
    <div class="teil-card soon">
      <div class="num">TEIL ${registry.length + 1}</div>
      <h2>coming soon</h2>
      <p class="untertitel">Neue Inhalte kommen als Content-Plugin dazu.</p>
    </div>`;

  view.innerHTML = `
    <div class="view-narrow">
      <h1 class="headline" style="margin-bottom:6px;">Lernpfade</h1>
      <p style="color:var(--dim); margin-top:0; margin-bottom:24px;">Wähle einen Teil, um weiterzulernen.</p>
      <div class="teil-grid">${cards}${comingSoon}</div>
    </div>`;

  view.querySelectorAll(".teil-card[data-teil]").forEach((card) => {
    card.addEventListener("click", () => {
      const teilId = card.dataset.teil;
      const teil = registry.find((t) => t.id === teilId);
      if (!isTeilUnlocked(teil, store)) return;
      navigate(`#/teil/${teilId}`);
    });
  });
}
