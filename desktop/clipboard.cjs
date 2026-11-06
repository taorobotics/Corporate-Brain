const normalized = (text) => text.replace(/\r\n/g, "\n");
let pending = Promise.resolve();

async function writeNow(clipboard, text) {
  if (typeof text !== "string" || text.length > 2_000_000)
    throw new Error("复制内容无效或过大，请保存为文件");
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await clipboard.writeText(text);
      if (normalized(await clipboard.readText()) === normalized(text)) return;
    } catch {
      // Windows clipboard owners can briefly prevent both reading and writing.
    }
    if (attempt < 4)
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
  }
  throw new Error("系统剪贴板暂时不可用，请重试或手动选择文字复制。");
}
function writeClipboard(clipboard, text) {
  const result = pending.catch(() => {}).then(() => writeNow(clipboard, text));
  pending = result;
  return result;
}
module.exports = { writeClipboard };
