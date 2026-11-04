const fs = require("node:fs/promises");
const { join } = require("node:path");
const { randomBytes } = require("node:crypto");
const { spawn: launch } = require("node:child_process");

// Only the main process supplies the already verified package. No executable,
// command-line argument or installation directory is accepted over IPC.
async function installWindowsUpdate({
  directory, save, verify, quit, spawn = launch, timeout = 30_000, interval = 100,
}) {
  await save();
  const file = await verify();
  const token = randomBytes(16).toString("hex");
  const ready = join(directory, token + ".ready");
  const proceed = join(directory, token + ".proceed");
  let handedOff = false;
  try {
    const child = spawn(file, ["/S", `--brain-update=${token}`], {
      detached: true, stdio: "ignore", windowsHide: true, shell: false,
    });
    await new Promise((resolve, reject) => {
      let timer, finished = false;
      const deadline = Date.now() + timeout;
      const finish = (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        child.removeListener("error", onError);
        child.removeListener("exit", onExit);
        error ? reject(error) : resolve();
      };
      const onError = () => finish(new Error("安装程序未能启动，客户端已保留，请重试"));
      const onExit = () => finish(new Error("安装程序未能准备更新，客户端已保留，请重试或联系管理员"));
      child.once("error", onError);
      child.once("exit", onExit);
      const poll = async () => {
        try {
          const info = await fs.lstat(ready);
          if (info.isFile() && !info.isSymbolicLink() && await fs.readFile(ready, "utf8") === "ready") {
            finish();
            return;
          }
        } catch (error) {
          if (error.code !== "ENOENT") { onError(); return; }
        }
        if (finished) return;
        if (Date.now() >= deadline) {
          finish(new Error("安装程序准备超时，客户端已保留，请稍后重试"));
          return;
        }
        timer = setTimeout(poll, interval);
      };
      void poll();
    });
    // The second signal prevents an installer which starts after our timeout
    // from ever changing the existing installation.
    await fs.writeFile(proceed, "proceed", { flag: "wx", mode: 0o600 });
    child.unref();
    handedOff = true;
    quit();
  } finally {
    await fs.rm(ready, { force: true });
    if (!handedOff) await fs.rm(proceed, { force: true });
  }
}
module.exports = { installWindowsUpdate };
