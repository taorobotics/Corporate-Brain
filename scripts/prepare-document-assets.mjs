import { cp, mkdir } from "node:fs/promises";
await mkdir("public/pdf-assets", { recursive: true });
for (const name of ["cmaps", "standard_fonts"])
  await cp("node_modules/pdfjs-dist/" + name, "public/pdf-assets/" + name, {
    recursive: true,
  });
await cp("node_modules/pdfjs-dist/LICENSE", "public/pdf-assets/LICENSE");
