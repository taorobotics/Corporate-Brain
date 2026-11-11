import assert from "node:assert/strict";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import "./prepare-brand.mjs";
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const packages = lock.packages;
// This legacy package uses `licenses: [{ type: 'BSD' }]`, omitted by npm's
// lock format. Its shipped LICENSE is the complete BSD 3-Clause text.
const legacyLicense = await readFile(
  "node_modules/parse-cache-control/LICENSE",
  "utf8",
);
const reviewedLegacy =
  packages["node_modules/parse-cache-control"]?.version === "1.0.1" &&
  createHash("sha256").update(legacyLicense).digest("hex") ===
    "111f42b37daecc6c387d037ef25955bd269e7f9a46a736d5257a23560534763f";
const inventory = Object.entries(packages)
  .filter(([path]) => path)
  .map(([path, value]) => ({
    name: path.split("node_modules/").at(-1),
    version: value.version,
    license:
      value.license ||
      (path === "node_modules/parse-cache-control" && reviewedLegacy
        ? "BSD-3-Clause (reviewed shipped LICENSE)"
        : "UNKNOWN"),
    scope: value.dev ? "development" : "runtime",
    path,
  }))
  .sort((a, b) => a.path.localeCompare(b.path, "en"));
assert.ok(
  inventory.every(
    (item) => item.license !== "UNKNOWN" && !/UNLICENSED/i.test(item.license),
  ),
  "Review missing or non-open-source dependency licenses",
);
await writeFile(
  "docs/dependency-licenses.json",
  JSON.stringify(
    {
      source: "package-lock.json",
      notice:
        "Declared licenses; each upstream license remains applicable. Optional platform packages may not be installed. Build tools are not bundled into the employee client.",
      packages: inventory,
    },
    null,
    2,
  ) + "\n",
);
const visited = new Set();
function locate(from, name) {
  for (let base = from; ;) {
    const path = `${base ? `${base}/` : ""}node_modules/${name}`;
    if (packages[path]) return path;
    if (!base) return null;
    const index = base.lastIndexOf("/node_modules/");
    base = index < 0 ? "" : base.slice(0, index);
  }
}
function visit(path) {
  assert.ok(path);
  if (visited.has(path)) return;
  visited.add(path);
  const item = packages[path];
  for (const name of Object.keys({
    ...item.dependencies,
    ...item.peerDependencies,
  })) {
    const dependency = locate(path, name);
    if (dependency) visit(dependency);
  }
}
for (const name of [
  "react",
  "react-dom",
  "@base-ui/react",
  "@phosphor-icons/react",
  "pdfjs-dist",
  "three",
])
  visit(locate("", name));
let notices =
  "Corporate Brain third-party notices\n\nThe project MIT license applies to original project material only. The following upstream notices are preserved for web UI dependencies, the Electron wrapper and the bundled font. The Electron runtime also ships its own LICENSE.electron.txt / LICENSE and LICENSES.chromium.html. Server and build dependencies retain their package licenses; the locked inventory is docs/dependency-licenses.json. No company Skills, credentials or proprietary application source is distributed by this notice.\n";
for (const path of [...visited].sort()) {
  const item = packages[path],
    name = path.split("node_modules/").at(-1);
  const files = (await readdir(path))
    .filter((file) => /^(?:licen[cs]e|copying|notice)(?:\..*)?$/i.test(file))
    .sort();
  assert.ok(files.length, `Missing license text for ${name}`);
  notices += `\n\n========== ${name}@${item.version} (${item.license}) ==========\n`;
  for (const file of files)
    notices += `\n--- ${file} ---\n${await readFile(join(path, file), "utf8")}\n`;
}
notices += `\n\n========== Electron ==========\n${await readFile("node_modules/electron/LICENSE", "utf8")}\n`;
notices += `\n\n========== Noto Sans SC (SIL Open Font License 1.1) ==========\n${await readFile("desktop/fonts/OFL.txt", "utf8")}\n`;
notices += `\n\n========== Inter (SIL Open Font License 1.1) ==========\n${await readFile("desktop/fonts/Inter-OFL.txt", "utf8")}\n`;
notices += `\n\n========== Grok Ball (tycoding/grok-ball, MIT; pinned commit de368ce3acdc5a70e871ee46ebbe8f60b11d3d6a) ==========\n${await readFile("src/vendor/grok-ball.LICENSE", "utf8")}\n`;
notices += `\n\n========== DSH skin catalog, selected artwork and Claude fonts ==========\n${await readFile("src/vendor/dsh-skins.LICENSE", "utf8")}\n`;
notices += `\n\n========== DSH startup screen (6shenhonghong9/dsh-startup-screen, MIT; pinned commit 7f3d2837c1aaef8293abc69093b0a35c80d0f0e8; adapted dossier layout and palette, no third-party audio/video) ==========\n${await readFile("src/vendor/dsh-startup.LICENSE", "utf8")}\n`;
notices += `\n\n========== DeepSeek Harness chat indicator (@deepseek-ai/dsh-client-ui-primitives@0.2.0-rc.2, MIT; adapted FishLogo, StateDot and TextShimmer; https://github.com/deepseek-ai/deepseek-harness) ==========\n${await readFile("src/vendor/dsh-chat.LICENSE", "utf8")}\n`;
// Normalize formatting only; retain all upstream copyright and license wording.
notices += `\n\n========== IPAS profile avatars ==========\n${await readFile("src/vendor/ipas-avatars.NOTICE", "utf8")}\n`;
notices += `\n\n========== Server-only video rendering ==========\n${await readFile("src/vendor/canvas-rendering.NOTICE", "utf8")}\n`;
notices += `\n\n========== Company community plugin adapters (server-only) ==========\nomdsh-dev/dsh-tool-calculator; source commit b2007a13f06bcf75bf07b9d277ee8d434a316490; evaluator preserved, runtime adapter by Corporate Brain.\n${await readFile("server/vendor/calculator.LICENSE", "utf8")}\nuckkk/dsh-pace-calc@0.1.1; company adapter validates distance/time and formats pace.\n${await readFile("server/vendor/pace-calc.LICENSE", "utf8")}\n`;
notices += `\n\n========== parse-cache-control 1.0.1 (server downloader, BSD-3-Clause) ==========\n${legacyLicense}\n`;
await writeFile(
  "THIRD_PARTY_NOTICES.txt",
  notices.replace(/[ \t]+$/gm, "").trimEnd() + "\n",
);
await mkdir("desktop/legal", { recursive: true });
for (const [from, to] of [
  ["LICENSE", "LICENSE"],
  ["THIRD_PARTY_NOTICES.txt", "THIRD_PARTY_NOTICES.txt"],
  ["docs/PRIVACY.md", "PRIVACY.md"],
  ["docs/CODE_SIGNING_POLICY.md", "CODE_SIGNING_POLICY.md"],
])
  await cp(from, join("desktop/legal", to));
const escape = (value) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const sections = [];
for (const [title, file] of [
  ["隐私说明", "PRIVACY.md"],
  ["MIT 开源许可", "LICENSE"],
  ["签名政策", "CODE_SIGNING_POLICY.md"],
  ["第三方组件声明", "THIRD_PARTY_NOTICES.txt"],
])
  sections.push(
    `<details ${file === "PRIVACY.md" ? "open" : ""}><summary>${title}</summary><pre>${escape(await readFile(join("desktop/legal", file), "utf8"))}</pre></details>`,
  );
await writeFile(
  "desktop/legal.html",
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>隐私与许可 · 公司大脑</title><link rel="stylesheet" href="fonts.css"><style>body{font:14px/1.8 var(--font-ui);margin:32px;background:#fbfaf8;color:#272925}main{max-width:850px;margin:auto}h1{font-size:24px}details{border:1px solid #e7e5e1;border-radius:10px;margin:16px 0;background:white}summary{cursor:pointer;padding:16px;font-weight:600}pre{font:13px/1.9 var(--font-ui);white-space:pre-wrap;overflow-wrap:anywhere;margin:0;padding:0 20px 20px}</style><main><h1>隐私与许可</h1>${sections.join("")}</main></html>`,
);
console.log(
  `Prepared license, ${visited.size} frontend dependency notices, font notice and ${inventory.length} locked license entries.`,
);
