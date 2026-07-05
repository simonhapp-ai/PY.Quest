// A new Teil = one file in app/content/ + one import line here. Nothing else changes.
import teil1 from "../content/teil1.js";
import teil2 from "../content/teil2.js";

export const registry = [teil1, teil2].sort((a, b) => a.nummer - b.nummer);

export function getTeil(teilId) {
  return registry.find((t) => t.id === teilId) || null;
}

export function getLektion(teilId, lektionId) {
  const teil = getTeil(teilId);
  return teil?.lektionen.find((l) => l.id === lektionId) || null;
}

export function getWerkstattProjekt(teilId, projektId) {
  const teil = getTeil(teilId);
  return teil?.werkstatt.find((p) => p.id === projektId) || null;
}

export function isTeilUnlocked(teil, store) {
  if (!teil.voraussetzung) return true;
  const req = getTeil(teil.voraussetzung);
  return req ? store.isTeilCompleted(req) : true;
}

export function nextLektion(teil, store) {
  return teil.lektionen.find((l) => !store.isLektionCompleted(teil.id, l.id)) || null;
}

export function isLektionUnlocked(teil, lektion, store) {
  const idx = teil.lektionen.findIndex((l) => l.id === lektion.id);
  if (idx <= 0) return true;
  const prev = teil.lektionen[idx - 1];
  return store.isLektionCompleted(teil.id, prev.id);
}
