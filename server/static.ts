import { relative, resolve } from "node:path";
import express from "express";

export function companyStatic() {
  const animation = resolve("dist/startup/index.html");
  const fonts = resolve("dist/fonts/noto-sans-sc/v41");
  return express.static(resolve("dist"), {
    setHeaders(res, file) {
      if (/^(?:subset|noto-sans-sc)\.[a-f0-9]{16}\.(?:woff2|css)$/.test(relative(fonts, file))) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.setHeader("X-Content-Type-Options", "nosniff");
      }
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
