const { app, BrowserWindow } = require('electron');
const { writeFileSync, copyFileSync } = require('node:fs');
const { join } = require('node:path');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

// Keep the existing animated installer spinner; the brand comes from its master.
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
  const { CircleNotch } = await import('@phosphor-icons/react');
  const folder = process.argv[2];
  copyFileSync(join(__dirname, '../build/generated/brand/company-brain.ico'), join(folder, 'company-brain.ico'));
  const win = new BrowserWindow({ show: false, width: 320, height: 360, webPreferences: { offscreen: true, sandbox: true, backgroundThrottling: false } });
  for (let frame = 0; frame < 16; frame++) {
    const size = 28;
    const svg = renderToStaticMarkup(createElement(CircleNotch, { size: size - 6, color: '#b76c4e', weight: 'regular' }));
    const background = '#fbfaf8';
    const html = `<html><body style="margin:0;width:${size}px;height:${size}px;background:${background};display:grid;place-items:center"><div style="height:${size - 6}px;transform:rotate(${Math.max(0, frame) * 22.5}deg)">${svg}</div></body></html>`;
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
    writeFileSync(join(folder, `spinner-${frame}.bmp`), bmp(image));
  }
  win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
