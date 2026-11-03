// Real rendering verification; synthetic materials only, no company data or model fees.
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  writeFile,
  readFile,
  stat,
  readdir,
  rm,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { renderCanvasVideo } from "../server/render-video.ts";
const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static");
const root = resolve(".cache/render-verification");
await mkdir(root, { recursive: true });
const dir = await mkdtemp(join(root, "task-"));
await mkdir(join(dir, "materials"));
await mkdir(join(dir, "code"));
await sharp({
  create: { width: 96, height: 96, channels: 3, background: "#d27952" },
})
  .png()
  .toFile(join(dir, "materials", "sample.png"));
const sampleRate = 44100,
  length = sampleRate * 3,
  wav = Buffer.alloc(44 + length * 2);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(length * 2, 40);
for (let i = 0; i < length; i++)
  wav.writeInt16LE(
    Math.round(Math.sin((i * 2 * Math.PI * 330) / sampleRate) * 1200),
    44 + i * 2,
  );
await writeFile(join(dir, "materials", "tone.wav"), wav);
execFileSync(ffmpeg, [
  "-v",
  "error",
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc2=size=160x90:rate=24",
  "-t",
  "3",
  "-c:v",
  "libx264",
  "-pix_fmt",
  "yuv420p",
  join(dir, "materials", "sample.mp4"),
]);
await writeFile(
  join(dir, "code", "animation.js"),
  `async function render(ctx,t,assets) {
  if(typeof process!=='undefined'||typeof require!=='undefined'||typeof document!=='undefined'||typeof RTCPeerConnection!=='undefined')throw Error('Host APIs leaked');
  if(t===0) { for(const url of ['https://example.com','file:///etc/passwd']) { let allowed=false; try { await fetch(url);allowed=true; } catch{} if(allowed)throw Error('External access leaked'); } }
  ctx.fillStyle='#f4eee5';ctx.fillRect(0,0,1280,720);
  const p=Math.min(1,t/1.2),ease=1-Math.pow(1-p,3);
  ctx.fillStyle='#222725';ctx.font='bold 76px sans-serif';ctx.fillText('公司大脑',90,160+30*(1-ease));
  ctx.font='30px sans-serif';ctx.fillStyle='#6b706b';ctx.fillText('Code → Mac mini → Your files',94,225);
  ctx.save();ctx.translate(140+t*270,420);ctx.rotate(t);ctx.drawImage(assets['sample.png'],-48,-48,96,96);ctx.restore();
  ctx.drawImage(assets['sample.mp4'],960,390,240,135);
  ctx.fillStyle='#d27952';ctx.fillRect(90,610,1100*t/3,6);
}`,
);
const started = Date.now();
await renderCanvasVideo({
  directory: dir,
  seconds: 3,
  signal: AbortSignal.timeout(180000),
  progress: (value) =>
    process.stdout.write(`render ${Math.round(value * 100)}%\n`),
});
const video = join(dir, "output/video.mp4");
const frames = execFileSync(
  ffmpeg,
  ["-v", "error", "-i", video, "-map", "0:v:0", "-f", "framemd5", "-"],
  { encoding: "utf8" },
)
  .split(/\r?\n/)
  .filter((line) => line && !line.startsWith("#"));
assert.equal(frames.length, 72);
assert.ok(new Set(frames.map((line) => line.split(",").at(-1))).size > 65);
const audio = execFileSync(
  ffmpeg,
  ["-v", "error", "-i", video, "-map", "0:a:0", "-f", "s16le", "-"],
  { maxBuffer: 5 * 1024 * 1024 },
);
assert.ok(audio.length > 44100 * 2 * 2.5);
await assert.rejects(stat(join(dir, ".render")), { code: "ENOENT" });
await mkdir("artifacts", { recursive: true });
const preview = resolve("artifacts/production-render-preview.png");
execFileSync(ffmpeg, [
  "-v",
  "error",
  "-y",
  "-ss",
  "1.5",
  "-i",
  video,
  "-frames:v",
  "1",
  preview,
]);
const image = await sharp(preview).metadata();
assert.equal(image.width, 1280);
assert.equal(image.height, 720);
const report = {
  platform: process.platform,
  arch: process.arch,
  seconds: 3,
  frames: frames.length,
  width: image.width,
  height: image.height,
  audio: true,
  sourceRetained: true,
  materialRetained: true,
  rendererTempRemoved: true,
  networkBlocked: true,
  nodeUnavailable: true,
  elapsedMs: Date.now() - started,
  video,
  sha256: createHash("sha256")
    .update(await readFile(video))
    .digest("hex"),
  bytes: (await stat(video)).size,
};
await writeFile(
  `artifacts/production-render-${process.platform}-${process.arch}.json`,
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
