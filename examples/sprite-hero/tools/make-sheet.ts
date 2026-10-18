/**
 * Draws public/sprites/hero.png: a 4x4 grid of 16x16 pixel-art frames.
 *   0-3 idle · 4-7 run · 8-11 attack · 12 rise · 13 fall · 14-15 dust puff
 * Run with `bun tools/make-sheet.ts`. Plain code so the art can change in review like anything else.
 */
import { deflateSync } from 'node:zlib'

const F = 16
const COLS = 4
const ROWS = 4
const W = F * COLS
const H = F * ROWS
const px = new Uint8Array(W * H * 4)

type RGB = [number, number, number]
const HAIR: RGB = [92, 58, 33]
const SKIN: RGB = [241, 194, 125]
const EYE: RGB = [30, 30, 40]
const SHIRT: RGB = [59, 111, 216]
const BELT: RGB = [40, 52, 90]
const LEGS: RGB = [42, 42, 58]
const STEEL: RGB = [210, 220, 232]
const HILT: RGB = [150, 110, 40]
const DUST: RGB = [200, 196, 184]

function put(frame: number, x: number, y: number, c: RGB, a = 255): void {
  if (x < 0 || y < 0 || x >= F || y >= F) return
  const gx = (frame % COLS) * F + x
  const gy = Math.floor(frame / COLS) * F + y
  const i = (gy * W + gx) * 4
  px.set([c[0], c[1], c[2], a], i)
}
function rect(frame: number, x0: number, y0: number, w: number, h: number, c: RGB): void {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(frame, x, y, c)
}

interface Pose {
  bob?: number
  /** Leg x offsets (front, back) and lift. */
  front?: number
  back?: number
  lift?: number
  tuck?: boolean
  sword?: 'rest' | 'up' | 'diag' | 'out'
}

function hero(frame: number, p: Pose): void {
  const b = p.bob ?? 0
  // legs
  if (p.tuck) {
    rect(frame, 5, 11 + b, 2, 2, LEGS)
    rect(frame, 8, 11 + b, 2, 2, LEGS)
  } else {
    rect(frame, 5 + (p.back ?? 0), 11, 2, 4 - (p.lift ?? 0), LEGS)
    rect(frame, 8 + (p.front ?? 0), 11, 2, 4, LEGS)
  }
  // body, belt, head, hair, eye
  rect(frame, 5, 6 + b, 5, 5, SHIRT)
  rect(frame, 5, 10 + b, 5, 1, BELT)
  rect(frame, 6, 2 + b, 4, 4, SKIN)
  rect(frame, 5, 1 + b, 5, 2, HAIR)
  put(frame, 5, 3 + b, HAIR)
  put(frame, 8, 3 + b, EYE)
  // arm and sword
  const s = p.sword ?? 'rest'
  if (s === 'rest') {
    rect(frame, 10, 7 + b, 1, 3, SKIN)
    put(frame, 11, 9 + b, HILT)
    rect(frame, 12, 9 + b, 1, 1, STEEL)
  } else if (s === 'up') {
    rect(frame, 10, 5 + b, 1, 3, SKIN)
    put(frame, 10, 4 + b, HILT)
    rect(frame, 10, 0, 1, 4 + b, STEEL)
  } else if (s === 'diag') {
    rect(frame, 10, 6 + b, 2, 1, SKIN)
    put(frame, 12, 6 + b, HILT)
    for (let i = 1; i <= 3; i++) put(frame, 12 + i, 6 + b - i, STEEL)
  } else {
    rect(frame, 10, 8 + b, 2, 1, SKIN)
    put(frame, 12, 8 + b, HILT)
    rect(frame, 13, 8 + b, 3, 1, STEEL)
    put(frame, 15, 7 + b, STEEL, 120)
    put(frame, 15, 9 + b, STEEL, 120)
  }
}

// idle: a slow breath
;[0, 0, 1, 1].forEach((bob, i) => hero(i, { bob }))
// run: legs scissor, body bobs on the passing frames
hero(4, { front: 2, back: -1 })
hero(5, { bob: 1, lift: 1 })
hero(6, { front: -1, back: 2 })
hero(7, { bob: 1, lift: 1 })
// attack: wind up, swing, hit, recover
hero(8, { sword: 'up' })
hero(9, { sword: 'diag' })
hero(10, { sword: 'out', front: 1 })
hero(11, { sword: 'rest', bob: 1 })
// rise and fall
hero(12, { tuck: true, bob: -1 })
hero(13, { front: 1, back: -1, lift: 1 })
// dust puff: a small cloud, then a wider fading one
for (const [x, y, r] of [[8, 13, 2], [5, 14, 1], [11, 14, 1]] as const) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) put(14, x + dx, y + dy, DUST)
for (const [x, y, r] of [[4, 13, 2], [12, 13, 2], [8, 12, 1]] as const) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) put(15, x + dx, y + dy, DUST, 140)

// ---- PNG encoding (RGBA, no filtering)
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC[(c ^ b) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}
const ihdr = new Uint8Array(13)
const hv = new DataView(ihdr.buffer)
hv.setUint32(0, W)
hv.setUint32(4, H)
ihdr.set([8, 6, 0, 0, 0], 8)
const raw = new Uint8Array(H * (W * 4 + 1))
for (let y = 0; y < H; y++) raw.set(px.subarray(y * W * 4, (y + 1) * W * 4), y * (W * 4 + 1) + 1)
const png = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]
const file = new URL('../public/sprites/hero.png', import.meta.url).pathname
await Bun.write(file, new Blob(png))
console.log(`wrote ${file} (${W}x${H})`)
