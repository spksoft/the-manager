#!/usr/bin/env node
// Generates three icons under apps/desktop/assets/:
//
//   trayTemplate.png       (16x16) — macOS menu-bar template, black on alpha.
//   trayTemplate@2x.png    (32x32) — retina variant of the above.
//   icon.png               (512x512) — app icon (Dock / window / packaged
//                                       Finder bundle). Rounded zinc-900
//                                       square with a white "M" glyph.
//
// On macOS the `Template` filename suffix lets the system invert the black
// pixels in the tray icon to match dark/light mode. The app icon does NOT use
// that suffix — Dock/Finder render it as-is.
//
// No external image deps — the PNG is hand-encoded using only `zlib`. Run on
// demand: `node apps/desktop/scripts/build-tray-icon.mjs`. The three PNGs are
// committed; this script only re-runs if you want to tweak the glyph.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "assets");

function setPx(buf, size, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
  buf[i + 3] = a;
}

/**
 * Draws an "M" mark into an N×N RGBA buffer using the supplied colour. Caller
 * controls padding + stroke as fractions of `size` so the same routine can
 * render the chunky tray glyph (~18% pad) and a thinner app-icon glyph.
 */
function drawM(buf, size, opts) {
  const { padPct = 0.18, strokePct = 0.18, r = 0, g = 0, b = 0, a = 255 } = opts ?? {};
  const pad = Math.max(1, Math.round(size * padPct));
  const stroke = Math.max(1, Math.round(size * strokePct));
  const left = pad;
  const right = size - pad - 1;
  const top = pad;
  const bottom = size - pad - 1;
  const mid = Math.round((left + right) / 2);

  for (let y = top; y <= bottom; y++) {
    for (let dx = 0; dx < stroke; dx++) {
      setPx(buf, size, left + dx, y, r, g, b, a);
      setPx(buf, size, right - dx, y, r, g, b, a);
    }
  }
  const half = bottom - top;
  for (let i = 0; i < half; i++) {
    const x1 = left + Math.round((i * (mid - left)) / half);
    const x2 = right - Math.round((i * (right - mid)) / half);
    const y = top + i;
    for (let dy = 0; dy < stroke; dy++) {
      setPx(buf, size, x1, y + dy, r, g, b, a);
      setPx(buf, size, x1 + 1, y + dy, r, g, b, a);
      setPx(buf, size, x2, y + dy, r, g, b, a);
      setPx(buf, size, x2 - 1, y + dy, r, g, b, a);
    }
  }
}

function makeTrayBuffer(size) {
  const buf = Buffer.alloc(size * size * 4);
  drawM(buf, size, { padPct: 0.18, strokePct: 0.18, r: 0, g: 0, b: 0, a: 255 });
  return buf;
}

/**
 * App-icon variant: a rounded-square zinc-900 fill (#0a0a0a) with a white "M".
 * Corner radius follows Apple's "squircle-ish" ~22% guidance so the Dock crop
 * looks intentional. No anti-aliasing — squareness on a 512px canvas hides it.
 */
function makeAppIconBuffer(size) {
  const buf = Buffer.alloc(size * size * 4);
  const radius = Math.round(size * 0.225);
  const r = 10; // zinc-950-ish
  const g = 10;
  const b = 10;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (insideRoundedSquare(x, y, size, radius)) {
        setPx(buf, size, x, y, r, g, b, 255);
      }
    }
  }
  drawM(buf, size, { padPct: 0.22, strokePct: 0.13, r: 244, g: 244, b: 245, a: 255 });
  return buf;
}

function insideRoundedSquare(x, y, size, radius) {
  const max = size - 1;
  if (x >= radius && x <= max - radius) return true;
  if (y >= radius && y <= max - radius) return true;
  const cx = x < radius ? radius : max - radius;
  const cy = y < radius ? radius : max - radius;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function makePng(buffer, size) {
  const rgba = buffer;
  // PNG scanlines: 1 filter byte per row + RGBA bytes.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });

  const chunks = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG signature
    makeChunk("IHDR", makeIHDR(size, size)),
    makeChunk("IDAT", idat),
    makeChunk("IEND", Buffer.alloc(0)),
  ];
  return Buffer.concat(chunks);
}

function makeIHDR(width, height) {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(width, 0);
  b.writeUInt32BE(height, 4);
  b[8] = 8; // bit depth
  b[9] = 6; // color type: RGBA
  b[10] = 0; // compression
  b[11] = 0; // filter
  b[12] = 0; // interlace
  return b;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

writeFileSync(join(outDir, "trayTemplate.png"), makePng(makeTrayBuffer(16), 16));
writeFileSync(join(outDir, "trayTemplate@2x.png"), makePng(makeTrayBuffer(32), 32));
writeFileSync(join(outDir, "icon.png"), makePng(makeAppIconBuffer(512), 512));
console.log("Wrote trayTemplate.png + trayTemplate@2x.png + icon.png to", outDir);
