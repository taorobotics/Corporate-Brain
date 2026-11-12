import { resolve } from "node:path";
import express from "express";

export function companyStatic() {
  const animation = resolve("dist/startup/index.html");
  return express.static(resolve("dist"), {
    setHeaders(res, file) {
      // Only the bundled decorative animation may appear in our own frame.
      // Account, chat and administration documents still prohibit embedding.
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; worker-src 'self' blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors " +
          (file === animation ? "'self'" : "'none'") +
          "; object-src 'none'",
      );
    },
  });
}
