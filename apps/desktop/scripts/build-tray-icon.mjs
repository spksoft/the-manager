#!/usr/bin/env node
// Generates apps/desktop/assets/trayTemplate.png (16x16) and
// trayTemplate@2x.png (32x32). The icon is a simple "M" glyph drawn on a
// transparent background, in flat black with the alpha channel doing all the
// work. On macOS the `Template` filename suffix lets the system invert the
// black pixels to match the menu-bar appearance (dark/light mode).
//
// No external image deps — the PNG is hand-encoded using only `zlib`. Run on
// demand: `node apps/desktop/scripts/build-tray-icon.mjs`. The two PNGs are
// committed; this script only re-runs if you want to tweak the glyph.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "assets");

/** Draws an "M" mark into an N×N RGBA buffer. Black opaque pixels on transparent. */
function drawM(size) {
  const buf = Buffer.alloc(size * size * 4);
  // Heuristic stroke width and padding scaled to size.
  const pad = Math.max(1, Math.round(size * 0.18));
  const stroke = Math.max(1, Math.round(size * 0.18));
  const left = pad;
  const right = size - pad - 1;
  const top = pad;
  const bottom = size - pad - 1;
  const mid = Math.round((left + right) / 2);

  const set = (x, y) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    buf[i] = 0; // R
    buf[i + 1] = 0; // G
    buf[i + 2] = 0; // B
    buf[i + 3] = 255; // A
  };

  // Vertical legs.
  for (let y = top; y <= bottom; y++) {
    for (let dx = 0; dx < stroke; dx++) {
      set(left + dx, y);
      set(right - dx, y);
    }
  }
  // Diagonals from top-left & top-right down to middle/center.
  const half = bottom - top;
  for (let i = 0; i < half; i++) {
    const x1 = left + Math.round((i * (mid - left)) / half);
    const x2 = right - Math.round((i * (right - mid)) / half);
    const y = top + i;
    for (let dy = 0; dy < stroke; dy++) {
      set(x1, y + dy);
      set(x1 + 1, y + dy);
      set(x2, y + dy);
      set(x2 - 1, y + dy);
    }
  }
  return buf;
}

function makePng(size) {
  const rgba = drawM(size);
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

writeFileSync(join(outDir, "trayTemplate.png"), makePng(16));
writeFileSync(join(outDir, "trayTemplate@2x.png"), makePng(32));
console.log("Wrote trayTemplate.png + trayTemplate@2x.png to", outDir);
