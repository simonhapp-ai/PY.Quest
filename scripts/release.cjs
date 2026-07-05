// Full release automation, triggered by Claude Code when the user says "GO UPDATE":
// commit + push pending changes, bump the version, build, and publish a GitHub
// Release with the dmg/zip/sha256 assets the in-app self-updater expects.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const PKG_PATH = path.join(ROOT, "package.json");

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
}

function runCapture(cmd) {
  return execSync(cmd, { cwd: ROOT }).toString().trim();
}

function bump(version, kind) {
  const [maj, min, pat] = version.split(".").map(Number);
  if (kind === "major") return `${maj + 1}.0.0`;
  if (kind === "minor") return `${maj}.${min + 1}.0`;
  if (kind === "patch") return `${maj}.${min}.${pat + 1}`;
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  throw new Error(`Unbekannter Versions-Bump: "${kind}" (erwartet: patch, minor, major oder x.y.z)`);
}

const bumpArg = process.argv[2] || "patch";
const pkg = JSON.parse(fs.readFileSync(PKG_PATH, "utf-8"));
const currentVersion = pkg.version;

run("git fetch --tags origin");
const existingTags = runCapture("git tag -l 'v*'").split("\n").filter(Boolean);
const isFirstRelease = existingTags.length === 0;
const newVersion = isFirstRelease ? currentVersion : bump(currentVersion, bumpArg);

if (!isFirstRelease) {
  pkg.version = newVersion;
  fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
}

console.log(
  isFirstRelease
    ? `Erste Veröffentlichung: v${newVersion} (keine Versionserhöhung, es existiert noch kein Release)`
    : `Version: v${currentVersion} -> v${newVersion}`
);

run("git add -A");
let hasStagedChanges = true;
try {
  execSync("git diff --cached --quiet", { cwd: ROOT });
  hasStagedChanges = false;
} catch {
  hasStagedChanges = true;
}

if (hasStagedChanges) {
  run(`git commit -m "Release v${newVersion}"`);
} else {
  console.log("Keine Änderungen zu committen.");
}
run("git push -u origin main");

run("rm -rf dist");
run("npm run dist:mac");

const distFiles = fs
  .readdirSync(path.join(ROOT, "dist"))
  .filter((f) => f.endsWith(".dmg") || f.endsWith(".zip") || f.endsWith(".sha256"))
  .map((f) => `dist/${f}`);

if (distFiles.length === 0) {
  throw new Error("Keine Build-Artefakte in dist/ gefunden.");
}

const fileArgs = distFiles.map((f) => `"${f}"`).join(" ");
run(`gh release create v${newVersion} ${fileArgs} --title "v${newVersion}" --generate-notes`);

console.log(`\nFertig: v${newVersion} veröffentlicht auf GitHub.`);
