"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist");
const files = ["index.html", "game.js", "styles.css"];

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const file of files) fs.copyFileSync(path.join(root, file), path.join(output, file));
fs.cpSync(path.join(root, "assets"), path.join(output, "assets"), { recursive: true });
for (const buildOnlyAsset of ["app-icon.png", "icon.png"]) {
  fs.rmSync(path.join(output, "assets", buildOnlyAsset), { force: true });
}

console.log(`Android web assets created in ${output}`);
