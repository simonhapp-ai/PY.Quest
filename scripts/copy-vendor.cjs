// Copies runtime assets from node_modules into app/vendor and assets/fonts
// so the app never loads anything from a CDN or node_modules at runtime.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const nodeModules = path.join(root, "node_modules");

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(from, to, filterFn) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dst, filterFn);
    } else if (!filterFn || filterFn(entry.name)) {
      copyFile(src, dst);
    }
  }
}

// --- Pyodide runtime (wasm + stdlib) ---
const pyodideSrc = path.join(nodeModules, "pyodide");
const pyodideDst = path.join(root, "app", "vendor", "pyodide");
copyDir(pyodideSrc, pyodideDst, (name) =>
  /\.(mjs|js|wasm|json|zip)$/.test(name) && !name.endsWith(".map")
);
console.log("[copy-vendor] pyodide ->", path.relative(root, pyodideDst));

// --- xterm.js + fit addon ---
const xtermDst = path.join(root, "app", "vendor", "xterm");
copyFile(
  path.join(nodeModules, "@xterm", "xterm", "lib", "xterm.js"),
  path.join(xtermDst, "xterm.js")
);
copyFile(
  path.join(nodeModules, "@xterm", "xterm", "css", "xterm.css"),
  path.join(xtermDst, "xterm.css")
);
copyFile(
  path.join(nodeModules, "@xterm", "addon-fit", "lib", "addon-fit.js"),
  path.join(xtermDst, "addon-fit.js")
);
console.log("[copy-vendor] xterm ->", path.relative(root, xtermDst));

// --- Fonts: only the weights we actually use, latin subset, woff2 ---
// Copied under app/ (not top-level assets/) so the pyquest:// protocol, which only
// serves the app/ directory at runtime, can actually reach them.
const fontsDst = path.join(root, "app", "assets", "fonts");
fs.mkdirSync(fontsDst, { recursive: true });

const fontFiles = [
  ["@fontsource/syne", ["syne-latin-500-normal.woff2", "syne-latin-700-normal.woff2", "syne-latin-800-normal.woff2"]],
  ["@fontsource/ibm-plex-mono", [
    "ibm-plex-mono-latin-400-normal.woff2",
    "ibm-plex-mono-latin-500-normal.woff2",
    "ibm-plex-mono-latin-600-normal.woff2",
    "ibm-plex-mono-latin-700-normal.woff2",
  ]],
];

for (const [pkg, files] of fontFiles) {
  const filesDir = path.join(nodeModules, pkg, "files");
  for (const f of files) {
    copyFile(path.join(filesDir, f), path.join(fontsDst, f));
  }
}
console.log("[copy-vendor] fonts ->", path.relative(root, fontsDst));

console.log("[copy-vendor] done.");
