const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Rasterize the existing MIT Phosphor icons, not a screenshot of the proposed UI.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
function bmp(image) {
  const { width, height } = image.getSize();
  const input = image.toBitmap(), stride = width * 4;
  const output = Buffer.alloc(54 + input.length);
  output.write('BM'); output.writeUInt32LE(output.length, 2); output.writeUInt32LE(54, 10);
  output.writeUInt32LE(40, 14); output.writeInt32LE(width, 18); output.writeInt32LE(height, 22);
  output.writeUInt16LE(1, 26); output.writeUInt16LE(32, 28); output.writeUInt32LE(input.length, 34);
  for (let y = 0; y < height; y++) input.copy(output, 54 + (height - 1 - y) * stride, y * stride, (y + 1) * stride);
  return output;
}
app.whenReady().then(async () => {
  const { Cube, CircleNotch } = await import('@phosphor-icons/react');
  const folder = process.argv[2];
  const win = new BrowserWindow({ show: false, width: 320, height: 360, webPreferences: { offscreen: true, sandbox: true, backgroundThrottling: false } });
  for (let frame = -1; frame < 16; frame++) {
    const size = frame < 0 ? 256 : 28;
    const svg = renderToStaticMarkup(createElement(frame < 0 ? Cube : CircleNotch, { size: size - 6, color: frame < 0 ? '#52554f' : '#b76c4e', weight: 'regular' }));
    const background = frame < 0 ? '#f1f0ec' : '#fbfaf8';
    const html = `<html><body style="margin:0;width:${size}px;height:${size}px;background:${background};display:grid;place-items:center"><div style="height:${size - 6}px;transform:rotate(${Math.max(0, frame) * 22.5}deg)">${svg}</div></body></html>`;
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    writeFileSync(join(folder, frame < 0 ? 'cube.bmp' : `spinner-${frame}.bmp`), bmp(frame < 0 ? image.resize({width:64,height:64}) : image));
    if (frame < 0) {
      const png = image.toPNG(), header = Buffer.alloc(22);
      header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
      header[6] = size === 256 ? 0 : size; header[7] = size === 256 ? 0 : size;
      header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);
      header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
      writeFileSync(join(folder, 'company-brain.ico'), Buffer.concat([header, png]));
    }
  }
  win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
