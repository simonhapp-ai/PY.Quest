const { app, BrowserWindow, ipcMain, Menu, session, protocol, shell } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { createWriteStream, createReadStream } = require("node:fs");
const crypto = require("node:crypto");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);

const PROGRESS_FILE = "progress.json";
const APP_ROOT = path.join(__dirname, "..", "app");

// Update-Check und -Installation sind rein manuell (Buttons in den Einstellungen) und
// die einzigen Stellen, die je einen Netzwerk-Request machen — laufen über Node-fetch
// im Main-Prozess, nicht über die renderer session, daher greift der
// Offline-Request-Blocker unten hier nicht.
const UPDATE_REPO = "simonhapp-ai/PY.Quest";
let lastCheckedRelease = null; // { dmgUrl, zipUrl, shaUrl, version }
let updateInProgress = false;

function parseVersion(v) {
  return String(v).replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
}

function isNewerVersion(latest, current) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

async function checkForUpdates() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    if (res.status === 404) return { status: "no-releases" };
    if (!res.ok) return { status: "error", message: `GitHub antwortete mit ${res.status}` };

    const release = await res.json();
    const latest = release.tag_name || "";
    const current = app.getVersion();
    const assets = release.assets || [];
    const dmgAsset = assets.find((a) => a.name.endsWith(".dmg"));
    const zipAsset = assets.find((a) => a.name.endsWith(".zip"));
    const shaAsset = zipAsset && assets.find((a) => a.name === `${zipAsset.name}.sha256`);
    lastCheckedRelease = {
      dmgUrl: dmgAsset?.browser_download_url || release.html_url,
      zipUrl: zipAsset?.browser_download_url || null,
      shaUrl: shaAsset?.browser_download_url || null,
      version: latest.replace(/^v/i, ""),
    };

    if (isNewerVersion(latest, current)) {
      return {
        status: "available",
        current,
        latest: lastCheckedRelease.version,
        canAutoInstall: Boolean(lastCheckedRelease.zipUrl),
      };
    }
    return { status: "up-to-date", current };
  } catch (err) {
    const message =
      err.name === "AbortError" ? "Zeitüberschreitung — keine Internetverbindung?" : "Keine Verbindung möglich.";
    return { status: "error", message };
  } finally {
    clearTimeout(timeout);
  }
}

async function downloadToFile(url, destPath, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0;
  let received = 0;
  const fileStream = createWriteStream(destPath);
  const reader = res.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      await new Promise((resolve, reject) => fileStream.write(value, (err) => (err ? reject(err) : resolve())));
      if (total) onProgress?.(received / total);
    }
  } finally {
    await new Promise((resolve) => fileStream.end(resolve));
  }
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

// Ersetzt Squirrel.Mac (das eine gültige Code-Signatur voraussetzt, die eine
// kostenpflichtige Apple Developer ID erfordert): lädt das .zip-Release-Asset
// herunter, prüft die SHA-256-Prüfsumme, entpackt via `ditto` (macOS-Bordmittel,
// keine neue Abhängigkeit) und tauscht den .app-Bundle-Ordner aus, sobald der
// Prozess beendet ist. Fortschritt geht per "update:progress"-Event an den Renderer.
async function installUpdate(win) {
  if (updateInProgress) return { status: "error", message: "Update läuft bereits." };
  if (!lastCheckedRelease?.zipUrl) {
    return { status: "error", message: "Kein automatisch installierbares Update-Paket gefunden." };
  }
  updateInProgress = true;
  const send = (status, extra = {}) => win?.webContents.send("update:progress", { status, ...extra });
  let tmpDir;

  try {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pyquest-update-"));
    const zipPath = path.join(tmpDir, "update.zip");

    send("downloading", { progress: 0 });
    await downloadToFile(lastCheckedRelease.zipUrl, zipPath, (progress) => send("downloading", { progress }));

    if (lastCheckedRelease.shaUrl) {
      send("verifying");
      const shaRes = await fetch(lastCheckedRelease.shaUrl);
      if (!shaRes.ok) throw new Error("Prüfsumme konnte nicht geladen werden.");
      const expected = (await shaRes.text()).trim().split(/\s+/)[0].toLowerCase();
      const actual = (await sha256File(zipPath)).toLowerCase();
      if (!expected || actual !== expected) {
        throw new Error("Prüfsumme stimmt nicht überein — Update wurde abgebrochen.");
      }
    }

    send("installing");
    const extractDir = path.join(tmpDir, "extracted");
    await fs.mkdir(extractDir, { recursive: true });
    await execFileAsync("ditto", ["-x", "-k", zipPath, extractDir]);

    const entries = await fs.readdir(extractDir);
    const newAppName = entries.find((e) => e.endsWith(".app"));
    if (!newAppName) throw new Error("Kein .app-Bundle im Update gefunden.");
    const newAppPath = path.join(extractDir, newAppName);

    const currentAppPath = path.resolve(process.execPath, "..", "..", "..");
    if (!currentAppPath.endsWith(".app")) {
      throw new Error("Konnte den aktuellen App-Pfad nicht bestimmen.");
    }

    const parentPid = process.pid;
    const scriptPath = path.join(tmpDir, "swap.sh");
    const script = `#!/bin/sh
while kill -0 ${parentPid} 2>/dev/null; do sleep 0.2; done
rm -rf "${currentAppPath}"
mv "${newAppPath}" "${currentAppPath}"
open "${currentAppPath}"
rm -rf "${tmpDir}"
`;
    await fs.writeFile(scriptPath, script, { mode: 0o755 });

    send("restarting");
    spawn("/bin/sh", [scriptPath], { detached: true, stdio: "ignore" }).unref();
    app.quit();
    return { status: "ok" };
  } catch (err) {
    updateInProgress = false;
    if (tmpDir) fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    send("error", { message: err.message });
    return { status: "error", message: err.message };
  }
}

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".zip": "application/zip",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".map": "application/json",
};

// Registered before app is ready: gives the scheme fetch()/streaming-wasm support that
// plain file:// does not reliably provide in Chromium. Note: we deliberately do NOT set
// Cross-Origin-Embedder-Policy/SharedArrayBuffer here — enabling COEP breaks Worker
// construction entirely in this Electron build. Blocking input() is instead implemented
// via a held-open request on this same protocol (see pendingStdin below).
protocol.registerSchemesAsPrivileged([
  {
    scheme: "pyquest",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// Worker threads block synchronously on a same-origin XHR to pyquest://app/__stdin__?id=…
// while this request sits unresolved until the renderer's terminal has a line of input
// for that id, at which point ipcMain "stdin:provide" resolves it. This gives a Worker
// real blocking input() without SharedArrayBuffer/Atomics.
// The two sides race independently (the XHR goes worker -> net service -> here; "provide"
// goes renderer -> ipc -> here), so a provide can arrive before its request registers —
// providedStdin holds that value until the request catches up.
const pendingStdin = new Map(); // id -> resolve(text)
const providedStdin = new Map(); // id -> text, when provide() won the race

function progressPath() {
  return path.join(app.getPath("userData"), PROGRESS_FILE);
}

async function loadProgress() {
  try {
    const raw = await fs.readFile(progressPath(), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveProgress(data) {
  await fs.writeFile(progressPath(), JSON.stringify(data, null, 2), "utf-8");
  return true;
}

function registerAppProtocol() {
  protocol.handle("pyquest", async (request) => {
    const url = new URL(request.url);

    if (url.pathname === "/__stdin__") {
      const id = url.searchParams.get("id");
      let text;
      if (providedStdin.has(id)) {
        text = providedStdin.get(id);
        providedStdin.delete(id);
      } else {
        text = await new Promise((resolve) => pendingStdin.set(id, resolve));
      }
      return new Response(text, { headers: { "Content-Type": "text/plain" } });
    }

    // pyquest://app/index.html -> APP_ROOT/index.html
    const relPath = decodeURIComponent(url.pathname);
    const filePath = path.normalize(path.join(APP_ROOT, relPath));
    if (!filePath.startsWith(APP_ROOT)) {
      return new Response("forbidden", { status: 403 });
    }
    try {
      const data = await fs.readFile(filePath);
      const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
      // Explicit Content-Type matters: Worker script loading and
      // WebAssembly.instantiateStreaming both do strict MIME checks that
      // extension-based sniffing on a bare file:// fetch does not reliably satisfy.
      return new Response(data, { headers: { "Content-Type": type } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: "#07090f",
    title: "PY.QUEST",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Hard offline guarantee: only our own protocol and devtools may load anything.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url;
    if (url.startsWith("pyquest://") || url.startsWith("devtools://")) {
      callback({ cancel: false });
    } else {
      callback({ cancel: true });
    }
  });

  win.loadURL("pyquest://app/index.html");
  win.setMenuBarVisibility(false);

  return win;
}

const menuTemplate = [
  {
    label: "PY.QUEST",
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "quit" },
    ],
  },
  {
    label: "Bearbeiten",
    submenu: [
      { role: "undo" }, { role: "redo" }, { type: "separator" },
      { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" },
    ],
  },
  {
    label: "Ansicht",
    submenu: [
      { role: "reload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  },
];

app.whenReady().then(() => {
  registerAppProtocol();
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  ipcMain.handle("progress:load", () => loadProgress());
  ipcMain.handle("progress:save", (_evt, data) => saveProgress(data));
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("update:check", () => checkForUpdates());
  ipcMain.handle("update:openReleasePage", () => {
    if (lastCheckedRelease?.dmgUrl) shell.openExternal(lastCheckedRelease.dmgUrl);
  });
  ipcMain.handle("update:install", (evt) => installUpdate(BrowserWindow.fromWebContents(evt.sender)));
  ipcMain.handle("stdin:provide", (_evt, { id, text }) => {
    const resolve = pendingStdin.get(id);
    if (resolve) {
      pendingStdin.delete(id);
      resolve(text);
    } else {
      providedStdin.set(id, text);
    }
    return true;
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
