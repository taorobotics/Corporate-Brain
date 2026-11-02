const { app } = require("electron");
const { createHash } = require("node:crypto");
const { join } = require("node:path");
const fs = require("node:fs");
const normalize = (value) =>
  ["default", "light", "dark"].includes(value) ? value : "default";
const fileFor = (origin) =>
  join(
    app.getPath("userData"),
    `appearance-${createHash("sha256").update(new URL(origin).origin).digest("hex")}.json`,
  );
function readAppearance(origin) {
  try {
    return normalize(
      JSON.parse(fs.readFileSync(fileFor(origin), "utf8")).theme,
    );
  } catch {
    return "default";
  }
}
function writeAppearance(origin, theme) {
  if (normalize(theme) !== theme) throw new Error("外观设置无效");
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  const file = fileFor(origin);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ theme }), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}
module.exports = { readAppearance, writeAppearance };
