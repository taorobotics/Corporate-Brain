import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

// Every surface is derived from the user-approved raster master. Keep the
// artwork and its transparent negative space unchanged at every icon size.
const master = await readFile('assets/brand/logo-master.png');
const metadata = await sharp(master).metadata();
assert.ok(metadata.hasAlpha, 'The approved logo must retain transparency');
for (const folder of ['public/brand', 'desktop/brand', 'build/generated/brand'])
  await mkdir(folder, { recursive: true });
const logo = await sharp(master).resize(512, 512, { fit: 'contain' }).png().toBuffer();
await Promise.all(['public/brand/logo.png', 'desktop/brand/logo.png'].map(file => writeFile(file, logo)));

async function icon(size) {
  return sharp(master).resize(size, size, { fit: 'contain', background: '#00000000' }).png().toBuffer();
}
const pngs = new Map();
for (const size of [16,20,24,32,40,48,64,128,180,256,512,1024]) pngs.set(size, await icon(size));
// Checking only the corners would miss a rounded white plate. Check clear
// pixels inside the emblem as well, including the spaces in the neural mesh.
for (const [size,png] of pngs) {
  const {data,info} = await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let clear = 0, total = 0;
  for (let y=Math.ceil(size/8);y<Math.floor(size*7/8);y++)
    for (let x=Math.ceil(size/8);x<Math.floor(size*7/8);x++) {
      total++; if (data[(y*info.width+x)*4+3] < 128) clear++;
    }
  assert.ok(clear/total > .3, `${size}px brand icon must retain transparent interior spaces; do not add a background plate`);
}
await writeFile('desktop/brand/app-icon.png', pngs.get(256));
await writeFile('build/generated/brand/app-icon.png', pngs.get(1024));
await writeFile('public/apple-touch-icon.png', pngs.get(180));
const sizes = [16,20,24,32,40,48,64,128,256], header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size,index) => {
  const start = 6 + 16 * index, png = pngs.get(size);
  header[start] = header[start + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, start + 4); header.writeUInt16LE(32, start + 6);
  header.writeUInt32LE(png.length, start + 8); header.writeUInt32LE(offset, start + 12);
  offset += png.length;
});
const ico = Buffer.concat([header, ...sizes.map(size => pngs.get(size))]);
await writeFile('build/generated/brand/company-brain.ico', ico);
await writeFile('public/favicon.ico', ico);
const chunks = [[16,'icp4'],[32,'icp5'],[64,'icp6'],[128,'ic07'],[256,'ic08'],[512,'ic09'],[1024,'ic10']].map(([size,type]) => {
  const png = pngs.get(size), entry = Buffer.alloc(8);
  entry.write(type); entry.writeUInt32BE(8 + png.length, 4);
  return Buffer.concat([entry, png]);
});
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns'); icnsHeader.writeUInt32BE(8 + chunks.reduce((total,chunk) => total + chunk.length, 0), 4);
await writeFile('build/generated/brand/company-brain.icns', Buffer.concat([icnsHeader,...chunks]));
await writeFile('build/generated/brand/source.json', JSON.stringify({master:'assets/brand/logo-master.png',sha256:createHash('sha256').update(master).digest('hex'),background:'transparent',whitePlate:false,transparentInteriorVerified:true,windowsSizes:sizes,macSizes:[16,32,64,128,256,512,1024]},null,2)+'\n');
console.log('Prepared approved company logo, browser icons, Windows ICO and macOS ICNS.');
