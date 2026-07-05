// Progress, XP and weak-topic tracking. Persists via the main-process IPC bridge
// (userData/progress.json), with localStorage as a fallback if the bridge is unavailable.

const XP_QUIZ = 10;
const XP_BUILD = 20;
const XP_LESSON_BONUS = 50;
const XP_WERKSTATT = 150;

function emptyState() {
  return {
    version: 1,
    xp: 0,
    teile: {}, // teilId -> { lektionen: { [lektionId]: {...} }, werkstatt: { [projektId]: {...} } }
    // weights/streaks key: `${teilId}:${lektionId}:${idx}`
    revision: { correct: 0, wrong: 0, weights: {}, streaks: {} },
  };
}

class Store {
  constructor() {
    this.state = emptyState();
    this._saveTimer = null;
    this._listeners = new Set();
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    for (const fn of this._listeners) fn(this.state);
  }

  async load() {
    let loaded = null;
    try {
      if (window.pyquest?.loadProgress) {
        loaded = await window.pyquest.loadProgress();
      }
    } catch {
      /* fall through to localStorage */
    }
    if (!loaded) {
      try {
        const raw = localStorage.getItem("pyquest-progress");
        if (raw) loaded = JSON.parse(raw);
      } catch {
        /* ignore corrupt data */
      }
    }
    if (loaded && loaded.version === 1) {
      this.state = { ...emptyState(), ...loaded };
    }
    this._emit();
    return this.state;
  }

  _scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._save(), 250);
  }

  async _save() {
    try {
      if (window.pyquest?.saveProgress) {
        await window.pyquest.saveProgress(this.state);
        return;
      }
    } catch {
      /* fall through */
    }
    try {
      localStorage.setItem("pyquest-progress", JSON.stringify(this.state));
    } catch {
      /* storage full or unavailable, nothing more we can do */
    }
  }

  async reset() {
    this.state = emptyState();
    this._emit();
    await this._save();
  }

  _teil(teilId) {
    if (!this.state.teile[teilId]) {
      this.state.teile[teilId] = { lektionen: {}, werkstatt: {} };
    }
    return this.state.teile[teilId];
  }

  _lektion(teilId, lektionId) {
    const teil = this._teil(teilId);
    if (!teil.lektionen[lektionId]) {
      teil.lektionen[lektionId] = { aufgaben: {}, completed: false };
    }
    return teil.lektionen[lektionId];
  }

  getLevel() {
    return Math.floor(this.state.xp / 300) + 1;
  }

  getXpIntoLevel() {
    return this.state.xp % 300;
  }

  addXP(amount) {
    this.state.xp += amount;
    this._emit();
    this._scheduleSave();
  }

  getAufgabeStatus(teilId, lektionId, idx) {
    return this._lektion(teilId, lektionId).aufgaben[idx] || null;
  }

  /** result: 'correct' | 'wrong' | 'solved-no-xp' */
  recordAufgabe(teilId, lektionId, idx, result, { isBuild = false } = {}) {
    const lek = this._lektion(teilId, lektionId);
    const prev = lek.aufgaben[idx];
    const attempts = (prev?.attempts || 0) + (result === "wrong" ? 1 : 0);
    lek.aufgaben[idx] = { status: result, attempts };

    const key = `${teilId}:${lektionId}:${idx}`;
    const w = this.state.revision.weights;
    const streaks = this.state.revision.streaks;
    if (result === "correct") {
      this.state.revision.correct += 1;
      streaks[key] = (streaks[key] || 0) + 1;
      // stays at up-to-4x weight until answered correctly twice in a row
      w[key] = streaks[key] >= 2 ? 0 : Math.max((w[key] || 0) - 1, 1);
      if (streaks[key] >= 2) streaks[key] = 0;
      this.addXP(isBuild ? XP_BUILD : XP_QUIZ);
    } else if (result === "wrong") {
      this.state.revision.wrong += 1;
      streaks[key] = 0;
      w[key] = 4;
      this._emit();
      this._scheduleSave();
    } else {
      // solved via Musterlösung: counts as solved, no XP, stays weighted for revision
      streaks[key] = 0;
      w[key] = Math.max(w[key] || 0, 2);
      this._emit();
      this._scheduleSave();
    }
  }

  completeLektion(teilId, lektionId) {
    const lek = this._lektion(teilId, lektionId);
    if (!lek.completed) {
      lek.completed = true;
      this.addXP(XP_LESSON_BONUS);
    } else {
      this._emit();
      this._scheduleSave();
    }
  }

  isLektionCompleted(teilId, lektionId) {
    return !!this._teil(teilId).lektionen[lektionId]?.completed;
  }

  isTeilCompleted(teil) {
    return teil.lektionen.every((l) => this.isLektionCompleted(teil.id, l.id));
  }

  completeWerkstattProjekt(teilId, projektId) {
    const teil = this._teil(teilId);
    if (!teil.werkstatt[projektId]?.completed) {
      teil.werkstatt[projektId] = { completed: true };
      this.addXP(XP_WERKSTATT);
    }
  }

  isWerkstattDone(teilId, projektId) {
    return !!this._teil(teilId).werkstatt[projektId]?.completed;
  }

  countWerkstattDone(teilId, projekte) {
    return projekte.filter((p) => this.isWerkstattDone(teilId, p.id)).length;
  }

  /** Fraction 0..1 of lessons completed in a teil, for the progress ring. */
  teilProgressFraction(teil) {
    if (!teil.lektionen.length) return 0;
    const done = teil.lektionen.filter((l) => this.isLektionCompleted(teil.id, l.id)).length;
    return done / teil.lektionen.length;
  }

  weakLektionen(registry, limit = 5) {
    const w = this.state.revision.weights;
    const groups = {};
    for (const [key, weight] of Object.entries(w)) {
      if (!weight) continue;
      const [teilId, lektionId] = key.split(":");
      const gKey = `${teilId}:${lektionId}`;
      groups[gKey] = (groups[gKey] || 0) + weight;
    }
    const rows = Object.entries(groups)
      .map(([gKey, weight]) => {
        const [teilId, lektionId] = gKey.split(":");
        const teil = registry.find((t) => t.id === teilId);
        const lektion = teil?.lektionen.find((l) => l.id === lektionId);
        return { teilId, lektionId, weight, titel: lektion?.titel || lektionId };
      })
      .sort((a, b) => b.weight - a.weight);
    return rows.slice(0, limit);
  }
}

export const store = new Store();
export { XP_QUIZ, XP_BUILD, XP_LESSON_BONUS, XP_WERKSTATT };
