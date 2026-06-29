// Copies docs/changelog.md → public/changelog.md for CRA static fetch.
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "docs", "changelog.md");
const dest = path.join(root, "public", "changelog.md");

if (!fs.existsSync(src)) {
  console.error("[sync-changelog] Source not found:", src);
  process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log("[sync-changelog] Copied docs/changelog.md → public/changelog.md");
