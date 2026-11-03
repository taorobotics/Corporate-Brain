import { resolve } from "node:path";
import express from "express";
import { createPlatform } from "./platform";
import { loadServerEnv } from "./env";
loadServerEnv();
const port = Number(process.env.PORT ?? 4310);
const { app, production, library, store } = createPlatform({
  database: process.env.BRAIN_DATABASE ?? ".data/platform.sqlite",
  origins: process.env.APP_ORIGIN ? [process.env.APP_ORIGIN] : undefined,
  secureCookies: process.env.NODE_ENV === "production",
});
app.use(
  express.static(resolve("dist"), {
    setHeaders: (res) => {
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; worker-src 'self' blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'",
      );
    },
  }),
);
app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
const server = app.listen(port, process.env.HOST ?? "127.0.0.1", () =>
  console.log(`公司大脑服务：http://127.0.0.1:${port}`),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.close();
  await production.close();
  await library.close();
  store.close();
  process.exit(0);
}
process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
