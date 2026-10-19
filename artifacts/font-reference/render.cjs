const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

app.disableHardwareAcceleration();
(async () => {
  app.setPath('userData', await fs.mkdtemp(path.join(os.tmpdir(), 'corporate-brain-font-')));
  await app.whenReady();
  const window = new BrowserWindow({
    width: 1280, height: 1100, useContentSize: true, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await window.loadFile(path.join(__dirname, 'preview.html'));
  const result = await window.webContents.executeJavaScript(`(async () => {
    await document.fonts.ready;
    const loaded = await document.fonts.load('400 16px "Noto Preview"', '公司知识与技能中心');
    if (!loaded.length || loaded.some(font => font.status !== 'loaded')) throw new Error('Preview font not loaded');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return { height: document.querySelector('main').getBoundingClientRect().height,
      fontFaces: Array.from(document.fonts).map(font => ({ family: font.family, weight: font.weight, status: font.status })) };
  })()`);
  window.setContentSize(1280, Math.ceil(result.height));
  const client = window.webContents.debugger;
  client.attach('1.3');
  await client.sendCommand('DOM.enable');
  await client.sendCommand('CSS.enable');
  const dom = await client.sendCommand('DOM.getDocument');
  const node = await client.sendCommand('DOM.querySelector', { nodeId: dom.root.nodeId, selector: '.sample' });
  const fonts = await client.sendCommand('CSS.getPlatformFontsForNode', { nodeId: node.nodeId });
  if (!fonts.fonts.some(font => font.isCustomFont && font.glyphCount > 0)) throw new Error('Sample rendered with fallback');
  client.detach();
  const screenshot = await window.webContents.capturePage();
  await fs.writeFile(path.join(__dirname, 'noto-sans-sc.png'), screenshot.toPNG());
  await fs.writeFile(path.join(__dirname, 'render-verification.json'), JSON.stringify({ ...result, actualFonts: fonts.fonts }, null, 2));
  console.log(JSON.stringify({ image: path.join(__dirname, 'noto-sans-sc.png'), ...result, actualFonts: fonts.fonts }));
  window.destroy();
  app.quit();
})().catch(error => { console.error(error); app.exit(1); });
