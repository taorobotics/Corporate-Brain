import { spawn } from "node:child_process";
const children = [];
const flags = process.argv.slice(2);
const server = spawn(
  process.execPath,
  ["--watch", "--import", "tsx", "server/index.ts"],
  { stdio: "inherit", env: process.env },
);
children.push(server);
const web = spawn(
  process.execPath,
  ["node_modules/vite/bin/vite.js", ...flags],
  { stdio: "inherit", env: process.env },
);
children.push(web);
function stop() {
  for (const child of children) child.kill();
}
process.on("SIGINT", () => {
  stop();
  process.exit();
});
process.on("SIGTERM", () => {
  stop();
  process.exit();
});
for (const child of children)
  child.on("exit", (code) => {
    stop();
    process.exit(code ?? 0);
  });
