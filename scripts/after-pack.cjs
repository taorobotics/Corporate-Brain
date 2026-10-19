// Preserve Electron's upstream notices inside the Mac app before ad-hoc signing.
const fs = require("node:fs/promises");
const { join, resolve } = require("node:path");
module.exports = async (context) => {
  if (context.electronPlatformName !== "darwin") return;
  const app = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  const destination = join(app, "Contents/Resources/legal");
  await fs.mkdir(destination, { recursive: true });
  for (const [source, target] of [
    ["LICENSE", "Electron-LICENSE.txt"],
    ["LICENSES.chromium.html", "LICENSES.chromium.html"],
  ]) {
    const candidates = [
      join(context.appOutDir, source),
      join(app, "Contents/Resources", source),
      join(app, "Contents/Resources", source === "LICENSE" ? "LICENSE.electron.txt" : source),
      resolve("node_modules/electron/dist", source),
      join(
        app,
        "Contents/Frameworks/Electron Framework.framework/Versions/A/Resources",
        source,
      ),
    ];
    let found;
    for (const path of candidates) {
      if (
        await fs.stat(path).then(
          (info) => info.isFile(),
          () => false,
        )
      ) {
        found = path;
        break;
      }
    }
    if (!found) throw new Error(`Missing upstream Electron notice: ${source}`);
    await fs.copyFile(found, join(destination, target));
  }
};
