// Turns the original patent scan into the image the site shows.
//   node scripts/artefact.mjs
//
// Source: artefact/US221360-drawings-page-2.png, sheet 2 of U.S. Patent 221,360 (J. & J. Ritty,
// "Cash Register and Indicator", 4 November 1879), as served by Google Patents. Public domain.
// The scan is 2320 x 3408, pure black on white, with a black strip along the bottom edge left by
// the scanner and a stray mark at the left edge. This trims the strip, the mark and the empty
// margins, and writes a WebP sized for the page.
import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const source = process.argv[2] ?? join(here, '..', 'artefact', 'US221360-drawings-page-2.png')
const target = join(here, '..', 'src', 'assets', 'patent-221360-sheet-2.webp')
const WIDTH = 880 // shown at up to about 440 CSS pixels, so 2x on a dense screen

const { data, info } = await sharp(source).greyscale().raw().toBuffer({ resolveWithObject: true })
const { width, height } = info

// Scanner marks hug the edges of the sheet, so the outer 4% on each side is ignored when looking
// for where the drawing begins and ends.
const edge = Math.round(width * 0.04)

/** Share of dark pixels in a row or column, 0 to 1. */
const darkInRow = (y, from = 0, to = width) => {
  let dark = 0
  for (let x = from; x < to; x++) if (data[y * width + x] < 128) dark++
  return dark / (to - from)
}
const darkInColumn = (x, top, bottom) => {
  let dark = 0
  for (let y = top; y < bottom; y++) if (data[y * width + x] < 128) dark++
  return dark / (bottom - top)
}

// The scanner strip is the only place a row is mostly black. Cut just above the highest such row
// in the bottom fifth of the page.
let bottom = height
for (let y = height - 1; y > height * 0.8; y--) {
  if (darkInRow(y) > 0.5) bottom = y
}
bottom -= 12

// Then trim blank paper from every side, leaving an even margin.
const INK = 0.002
let top = 0
while (top < bottom && darkInRow(top, edge, width - edge) < INK) top++
let last = bottom - 1
while (last > top && darkInRow(last, edge, width - edge) < INK) last--
let left = edge
while (left < width && darkInColumn(left, top, last) < INK) left++
let right = width - 1 - edge
while (right > left && darkInColumn(right, top, last) < INK) right--

const margin = 70
const box = {
  left: Math.max(0, left - margin),
  top: Math.max(0, top - margin),
  width: Math.min(width, right + margin) - Math.max(0, left - margin),
  height: Math.min(bottom, last + margin) - Math.max(0, top - margin),
}

const out = await sharp(source).greyscale().extract(box).resize({ width: WIDTH }).webp({ quality: 66, effort: 6 }).toFile(target)

console.log(`source  ${width} x ${height}, scanner strip from row ${bottom + 12}`)
console.log(`crop    ${box.width} x ${box.height} at (${box.left}, ${box.top})`)
console.log(`written ${out.width} x ${out.height}, ${statSync(target).size} bytes -> src/assets/patent-221360-sheet-2.webp`)
