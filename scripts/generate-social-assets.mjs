// One-off generator for static social-share assets.
// Run with: node scripts/generate-social-assets.mjs
//
// Re-run any time you change client/public/og-image.svg or favicon.svg.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "client", "public");

async function svgToPng(srcSvg, dstPng, width, height) {
  const svg = await readFile(join(publicDir, srcSvg));
  const png = await sharp(svg).resize(width, height).png().toBuffer();
  await writeFile(join(publicDir, dstPng), png);
  console.log(`  → ${dstPng}  (${width}×${height})`);
}

console.log("Generating social assets…");
await svgToPng("og-image.svg",  "og-image.png",          1200, 630);
await svgToPng("favicon.svg",   "apple-touch-icon.png",   180, 180);
await svgToPng("favicon.svg",   "icon-192.png",           192, 192);
await svgToPng("favicon.svg",   "icon-512.png",           512, 512);
console.log("Done.");
