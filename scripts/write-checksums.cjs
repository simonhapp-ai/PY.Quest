// Writes a <file>.sha256 sidecar (plain hex digest) next to each release
// artifact in dist/, so the in-app self-updater can verify a download
// before installing it — the one integrity check we have without an
// Apple Developer ID to code-sign real Squirrel.Mac updates.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DIST_DIR = path.join(__dirname, "..", "dist");

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

const targets = fs.readdirSync(DIST_DIR).filter((f) => f.endsWith(".zip") || f.endsWith(".dmg"));

for (const file of targets) {
  const filePath = path.join(DIST_DIR, file);
  const digest = sha256(filePath);
  fs.writeFileSync(`${filePath}.sha256`, digest, "utf-8");
  console.log(`${file}.sha256  ${digest}`);
}
