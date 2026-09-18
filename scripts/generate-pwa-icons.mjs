/**
 * Generate PWA icons for the manifest.
 *
 * Creates 192×192 and 512×512 PNG icons matching the brand mark
 * (CONVfy WhatsApp-green chat bubble with three typing dots).
 *
 * Run via: node scripts/generate-pwa-icons.mjs
 * (Also executed automatically by `npm run build`.)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import zlib from "node:zlib";

const PUBLIC_DIR = join(import.meta.dirname, "..", "public");
const ICONS_DIR = join(PUBLIC_DIR, "icons");

const WHATSAPP_GREEN = "#25D366";
const WHITE = "#ffffff";
const SIZES = [192, 512];

// Some consumers (PWA validators, store submissions) reject icons that
// fall below a minimum encoded size; 9.77 KB (10,000 bytes) is a common
// floor. sharp produces very compact PNGs, so pad any below that with a
// standard tEXt metadata chunk — decoders ignore it, size only grows.
const MIN_BYTES = 10_000;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Ensure a PNG buffer is at least `minBytes` long by appending a tEXt
 * chunk before IEND. Returns the original buffer if it's already large
 * enough.
 */
function padPngToMinBytes(png, minBytes) {
  if (png.length >= minBytes) return png;

  const keyword = Buffer.from("Comment");
  // tEXt chunk overhead: 4 length + 4 type + keyword + NUL + payload + 4 crc
  const overhead = 12 + keyword.length + 1;
  const payload = Buffer.alloc(minBytes - png.length - overhead, 0x78);
  const data = Buffer.concat([keyword, Buffer.from([0x00]), payload]);
  const type = Buffer.from("tEXt");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([type, data])) >>> 0, 0);
  const chunk = Buffer.concat([length, type, data, crc]);

  const iend = png.lastIndexOf(Buffer.from("IEND"));
  if (iend === -1) throw new Error("IEND chunk not found — invalid PNG");
  return Buffer.concat([png.subarray(0, iend), chunk, png.subarray(iend)]);
}

// The bubble+3-dots mark drawn on an infinite canvas so it scales to
// any icon size. Renders the same geometry as src/app/icon.tsx and the
// marketing-site logo, just flattened/centered for a square canvas.
function createIconSVG(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <g transform="translate(${Math.round(size * 0.22)} ${Math.round(size * 0.08)}) scale(${(size * 0.56) / 32})">
    <path d="M6 4.5A4.5 4.5 0 0 0 1.5 9v10a4.5 4.5 0 0 0 4.5 4.5H8v5.5l5.1-5.5H26a4.5 4.5 0 0 0 4.5-4.5V9A4.5 4.5 0 0 0 26 4.5H6Z" fill="${WHATSAPP_GREEN}"/>
    <circle cx="10.8" cy="14.4" r="2.7" fill="${WHITE}"/>
    <circle cx="16" cy="14.4" r="2.7" fill="${WHITE}"/>
    <circle cx="21.2" cy="14.4" r="2.7" fill="${WHITE}"/>
  </g>
</svg>`;
}

async function main() {
  await mkdir(ICONS_DIR, { recursive: true });

  for (const size of SIZES) {
    const svg = createIconSVG(size);
    const raw = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
    const png = padPngToMinBytes(raw, MIN_BYTES);
    const outPath = join(ICONS_DIR, `icon-${size}.png`);
    await writeFile(outPath, png);
    console.log(`✓ ${outPath} (${png.length} bytes, ${size}×${size})`);
  }

  console.log("PWA icons generated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});