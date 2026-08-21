/**
 * Generates the site's icon set and social card from the product mark.
 *
 * Zero dependencies: the artwork is vector shapes, rasterised with 6x6
 * supersampled anti-aliasing and encoded as PNG by hand (node:zlib only).
 *
 * THE GEOMETRY BELOW IS SHARED. The same numbers, in the same 24-unit space,
 * appear in three other places and all four must change together:
 *   - the extension's tools/make-icons.mjs (the Chrome Web Store icon)
 *   - the extension's src/popup/popup.html (the header mark)
 *   - icon.svg and the inline <svg class="mark"> in every page here
 *
 * Run: node tools/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SUPERSAMPLE = 6;
const COBALT = [27, 63, 224];
const WHITE = [255, 255, 255];
const PAPER = [245, 246, 248];

/* ------------------------------------------------------------------- shapes */

function inRoundRect(x, y, rx, ry, w, h, r) {
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inPolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ------------------------------------------------------------------ artwork */

/** The mark in its own 24-unit space. `u` scales it to wherever it is drawn. */
function markAt(u, bold) {
  const rect = (r) => ({ x: r.x * u, y: r.y * u, w: r.w * u, h: r.h * u, r: r.r * u });
  const circle = (c) => ({ cx: c.cx * u, cy: c.cy * u, r: c.r * u });
  const poly = (pts) => pts.map(([x, y]) => [x * u, y * u]);

  if (bold) {
    return {
      tile: rect({ x: 1.2, y: 1.2, w: 17.6, h: 17.6, r: 4.6 }),
      sun: null,
      ridge: poly([
        [2.4, 17.4], [2.4, 13.8], [7.6, 8.4], [12.0, 13.0],
        [14.2, 11.0], [17.6, 15.0], [17.6, 17.4],
      ]),
      badge: circle({ cx: 17.9, cy: 17.9, r: 6.0 }),
      moat: 0.7 * u,
      shaft: rect({ x: 16.45, y: 13.3, w: 2.9, h: 4.0, r: 0.7 }),
      head: poly([[14.2, 16.9], [21.6, 16.9], [17.9, 20.9]]),
    };
  }

  return {
    tile: rect({ x: 1.6, y: 1.6, w: 16.8, h: 16.8, r: 4.4 }),
    sun: circle({ cx: 6.3, cy: 6.4, r: 1.7 }),
    ridge: poly([
      [2.9, 17.0], [2.9, 13.4], [7.2, 8.9], [10.8, 12.7],
      [13.0, 10.7], [17.1, 15.0], [17.1, 17.0],
    ]),
    badge: circle({ cx: 17.7, cy: 17.7, r: 5.5 }),
    moat: 0.55 * u,
    shaft: rect({ x: 16.65, y: 13.9, w: 2.1, h: 3.5, r: 0.6 }),
    head: poly([[14.9, 17.0], [20.5, 17.0], [17.7, 20.4]]),
  };
}

/**
 * Samples the mark at a point, with the origin at the mark's top-left.
 *
 * `moatColour` is what the gap between the tile and the badge is filled with.
 * On a favicon that has to be transparent, so the silhouette survives on a light
 * or a dark tab strip. On the social card it is the card's own background.
 */
function sampleMark(x, y, art, moatColour) {
  if (inCircle(x, y, art.badge.cx, art.badge.cy, art.badge.r)) {
    const inArrow =
      inRoundRect(x, y, art.shaft.x, art.shaft.y, art.shaft.w, art.shaft.h, art.shaft.r) ||
      inPolygon(x, y, art.head);
    return inArrow ? [...WHITE, 1] : [...COBALT, 1];
  }
  if (inCircle(x, y, art.badge.cx, art.badge.cy, art.badge.r + art.moat)) {
    return moatColour === null ? [0, 0, 0, 0] : [...moatColour, 1];
  }

  if (inRoundRect(x, y, art.tile.x, art.tile.y, art.tile.w, art.tile.h, art.tile.r)) {
    const inPicture =
      (art.sun !== null && inCircle(x, y, art.sun.cx, art.sun.cy, art.sun.r)) ||
      inPolygon(x, y, art.ridge);
    return inPicture ? [...WHITE, 1] : [...COBALT, 1];
  }

  return null;
}

/* ------------------------------------------------------------------ render */

/** A square favicon: the mark on transparency, with a hair of outer padding. */
function renderIcon(size) {
  const pad = size * 0.04;
  const box = size - pad * 2;
  const art = markAt(box / 24, size <= 32);
  const rgba = Buffer.alloc(size * size * 4);
  const total = SUPERSAMPLE * SUPERSAMPLE;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      for (let j = 0; j < SUPERSAMPLE; j++) {
        for (let i = 0; i < SUPERSAMPLE; i++) {
          const hit = sampleMark(
            px + (i + 0.5) / SUPERSAMPLE - pad,
            py + (j + 0.5) / SUPERSAMPLE - pad,
            art,
            null,
          );
          if (hit !== null && hit[3]) {
            sr += hit[0];
            sg += hit[1];
            sb += hit[2];
            sa += 1;
          }
        }
      }
      const o = (py * size + px) * 4;
      if (sa > 0) {
        rgba[o] = Math.round(sr / sa);
        rgba[o + 1] = Math.round(sg / sa);
        rgba[o + 2] = Math.round(sb / sa);
        rgba[o + 3] = Math.round((sa / total) * 255);
      }
    }
  }
  return { size, rgba };
}

/**
 * The social card, 1200x630, as most unfurls expect.
 *
 * Deliberately wordless: the mark on the site's own paper with a cobalt rule
 * along the bottom. The headline and description come from the og:title and
 * og:description tags, which is what every unfurl renders as text anyway, and
 * hand-drawing letterforms in a PNG encoder with no font is not worth doing.
 */
function renderCard() {
  const w = 1200;
  const h = 630;
  const rule = 14;
  const mark = 300;
  const originX = (w - mark) / 2;
  const originY = (h - rule - mark) / 2;
  const art = markAt(mark / 24, false);

  const rgba = Buffer.alloc(w * h * 4);
  const total = SUPERSAMPLE * SUPERSAMPLE;

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let j = 0; j < SUPERSAMPLE; j++) {
        for (let i = 0; i < SUPERSAMPLE; i++) {
          const x = px + (i + 0.5) / SUPERSAMPLE;
          const y = py + (j + 0.5) / SUPERSAMPLE;

          let colour = y >= h - rule ? COBALT : PAPER;
          const hit = sampleMark(x - originX, y - originY, art, PAPER);
          if (hit !== null && hit[3]) colour = [hit[0], hit[1], hit[2]];

          sr += colour[0];
          sg += colour[1];
          sb += colour[2];
        }
      }
      const o = (py * w + px) * 4;
      rgba[o] = Math.round(sr / total);
      rgba[o + 1] = Math.round(sg / total);
      rgba[o + 2] = Math.round(sb / total);
      rgba[o + 3] = 255;
    }
  }
  return { width: w, height: h, rgba };
}

/* -------------------------------------------------------------- PNG encoder */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------------------------------------------------------------- run */

mkdirSync(root, { recursive: true });

// 32 for legacy browsers, 180 for the iOS home screen. Everything modern takes
// icon.svg, so there is no larger raster to keep in step.
for (const size of [32, 180]) {
  const { rgba } = renderIcon(size);
  const png = encodePng(size, size, rgba);
  writeFileSync(resolve(root, `icon-${size}.png`), png);
  console.log(`icon-${size}.png   ${size}x${size}   ${png.length} bytes`);
}

const card = renderCard();
const cardPng = encodePng(card.width, card.height, card.rgba);
writeFileSync(resolve(root, 'og.png'), cardPng);
console.log(`og.png            ${card.width}x${card.height}   ${cardPng.length} bytes`);
