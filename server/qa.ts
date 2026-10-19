// A disposable server for Electron interaction tests; never opens the company's database.
import { createPlatform } from "./platform";
import express from "express";
import { resolve } from "node:path";
const origins: string[] = [];
const { app } = createPlatform({ database: ":memory:", origins });
app.use(express.static(resolve("dist")));
app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
const server = app.listen(0, "127.0.0.1", () => {
  const port = (server.address() as any).port;
  origins.push(`http://127.0.0.1:${port}`);
  process.send?.({ port });
});
process.on("disconnect", () => server.close(() => process.exit(0)));
