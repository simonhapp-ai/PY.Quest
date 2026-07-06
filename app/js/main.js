import { runtime } from "./python/runtime.js";
import { TermView } from "./python/terminal.js";
import { store } from "./state.js";
import { registry } from "./registry.js";
import { renderHome } from "./engine/home.js";
import { renderPath } from "./engine/path.js";
import { renderLesson } from "./engine/lesson.js";
import { renderRevision } from "./engine/revision.js";
import { renderWerkstatt } from "./engine/werkstatt.js";

const viewEl = document.getElementById("view");
const pyStatusEl = document.getElementById("py-status");
const xpLevelEl = document.getElementById("xp-level");
const xpBarFillEl = document.getElementById("xp-bar-fill");
const xpNumEl = document.getElementById("xp-num");

let currentScreen = null;

function navigate(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

const ctx = { registry, store, runtime, navigate };

function route() {
  currentScreen?.dispose?.();
  currentScreen = null;

  const hash = location.hash || "#/home";
  const parts = hash.replace(/^#\//, "").split("/").filter(Boolean);
  const [seg1, seg2, seg3] = parts;

  if (!seg1 || seg1 === "home") {
    currentScreen = renderHome(viewEl, ctx) || {};
  } else if (seg1 === "teil" && seg2) {
    currentScreen = renderPath(viewEl, ctx, seg2) || {};
  } else if (seg1 === "lesson" && seg2 && seg3) {
    currentScreen = renderLesson(viewEl, ctx, seg2, seg3) || {};
  } else if (seg1 === "revision") {
    currentScreen = renderRevision(viewEl, ctx) || {};
  } else if (seg1 === "werkstatt" && seg2) {
    currentScreen = renderWerkstatt(viewEl, ctx, seg2, seg3) || {};
  } else {
    navigate("#/home");
  }
}

function updateXpUi() {
  const level = store.getLevel();
  const intoLevel = store.getXpIntoLevel();
  xpLevelEl.textContent = `Lvl ${level}`;
  xpBarFillEl.style.width = `${Math.round((intoLevel / 300) * 100)}%`;
  xpNumEl.textContent = `${store.state.xp} XP`;
}

store.onChange(updateXpUi);

runtime.onStatus((status) => {
  pyStatusEl.classList.remove("ready", "error");
  if (status === "loading") pyStatusEl.textContent = "Python startet …";
  else if (status === "ready") {
    pyStatusEl.textContent = "Python bereit ✔";
    pyStatusEl.classList.add("ready");
  } else if (status === "error") {
    pyStatusEl.textContent = "Python-Fehler ✘";
    pyStatusEl.classList.add("error");
  }
});

document.getElementById("logo-home").addEventListener("click", () => navigate("#/home"));

// --- Playground ---
const playgroundModal = document.getElementById("playground-modal");
let playgroundTerm = null;

async function openPlayground() {
  playgroundModal.classList.add("show");
  if (!playgroundTerm) {
    playgroundTerm = new TermView(document.getElementById("playground-term"));
    playgroundTerm.writeInfo("Python-Playground — freier REPL. Tippe Code und drücke Enter.");
  }
  playgroundTerm.fit();
  await runtime.init();
  promptLoop();
}

let playgroundBusy = false;
async function promptLoop() {
  if (playgroundBusy) return;
  playgroundBusy = true;
  playgroundTerm.write("\r\n>>> ");
  const line = await playgroundTerm.waitForLine();
  const res = await runtime.runRepl(line, {
    onStdout: (t) => playgroundTerm.write(t + "\n"),
    onStderr: (t) => playgroundTerm.writeErr(t + "\n"),
    onStdinRequest: async (id) => {
      const inLine = await playgroundTerm.waitForLine();
      runtime.provideStdinLine(id, inLine);
    },
  });
  if (!res.ok && res.error) playgroundTerm.writeErr("\n" + res.error);
  playgroundBusy = false;
  if (playgroundModal.classList.contains("show")) promptLoop();
}

document.getElementById("btn-playground").addEventListener("click", openPlayground);
document.getElementById("playground-close").addEventListener("click", () => {
  playgroundModal.classList.remove("show");
});
document.getElementById("playground-reset").addEventListener("click", async () => {
  if (runtime.isBusy()) {
    playgroundTerm?.writeInfo("Bitte zuerst die aktuelle Eingabe abschließen.");
    return;
  }
  await runtime.resetRepl();
  playgroundTerm?.clear();
  playgroundTerm?.writeInfo("REPL zurückgesetzt — alle Variablen sind weg.");
});

// --- Settings ---
const settingsModal = document.getElementById("settings-modal");
document.getElementById("btn-settings").addEventListener("click", async () => {
  settingsModal.classList.add("show");
  document.getElementById("app-version").textContent = (await window.pyquest?.getAppVersion?.()) || "dev";
});
document.getElementById("settings-close").addEventListener("click", () => {
  settingsModal.classList.remove("show");
});
document.getElementById("btn-reset-progress").addEventListener("click", async () => {
  if (confirm("Fortschritt wirklich vollständig zurücksetzen?")) {
    await store.reset();
    settingsModal.classList.remove("show");
    navigate("#/home");
  }
});

// --- Update-Check (manuell, nur auf Klick — keine Hintergrund-Netzwerkzugriffe) ---
const btnCheckUpdates = document.getElementById("btn-check-updates");
const btnInstallUpdate = document.getElementById("btn-install-update");
const btnDownloadUpdate = document.getElementById("btn-download-update");
const updateStatusEl = document.getElementById("update-status");

btnCheckUpdates.addEventListener("click", async () => {
  btnInstallUpdate.style.display = "none";
  btnDownloadUpdate.style.display = "none";
  btnCheckUpdates.disabled = true;
  updateStatusEl.textContent = "Suche nach Updates …";
  const result = await window.pyquest?.checkForUpdates?.();
  btnCheckUpdates.disabled = false;

  if (!result) {
    updateStatusEl.textContent = "Update-Check nicht verfügbar.";
  } else if (result.status === "available") {
    updateStatusEl.textContent = `Update verfügbar: v${result.latest} (du hast v${result.current}).`;
    if (result.canAutoInstall) btnInstallUpdate.style.display = "inline-block";
    btnDownloadUpdate.style.display = "inline-block";
  } else if (result.status === "up-to-date") {
    updateStatusEl.textContent = `Du hast bereits die neueste Version (v${result.current}).`;
  } else if (result.status === "no-releases") {
    updateStatusEl.textContent = "Noch keine Releases veröffentlicht.";
  } else {
    updateStatusEl.textContent = result.message || "Update-Check fehlgeschlagen.";
  }
});

btnDownloadUpdate.addEventListener("click", () => {
  window.pyquest?.openReleasePage?.();
});

window.pyquest?.onUpdateProgress?.(({ status, progress, message }) => {
  if (status === "downloading") {
    const pct = progress ? Math.round(progress * 100) : 0;
    updateStatusEl.textContent = `Lade Update herunter … ${pct}%`;
  } else if (status === "verifying") {
    updateStatusEl.textContent = "Prüfe Integrität …";
  } else if (status === "installing") {
    updateStatusEl.textContent = "Installiere Update …";
  } else if (status === "restarting") {
    updateStatusEl.textContent = "Fertig — PY.QUEST startet neu …";
  } else if (status === "error") {
    btnInstallUpdate.disabled = false;
    updateStatusEl.textContent = message || "Update fehlgeschlagen.";
  }
});

btnInstallUpdate.addEventListener("click", async () => {
  btnInstallUpdate.disabled = true;
  btnDownloadUpdate.disabled = true;
  updateStatusEl.textContent = "Lade Update herunter … 0%";
  const result = await window.pyquest?.installUpdate?.();
  if (result?.status === "error") {
    btnInstallUpdate.disabled = false;
    btnDownloadUpdate.disabled = false;
    updateStatusEl.textContent = result.message || "Update fehlgeschlagen.";
  }
});

// --- Boot ---
async function boot() {
  await store.load();
  updateXpUi();
  window.addEventListener("hashchange", route);
  route();
  runtime.init().catch((err) => console.error("Pyodide init failed", err));
}

boot();
