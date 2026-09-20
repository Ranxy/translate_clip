#!/usr/bin/env node
/**
 * Generates the icon assets used by electron-builder and the tray.
 *
 * Why a generator instead of committed binaries: the app needs a PNG set for
 * Linux, a 512px source for Windows (electron-builder converts it to ICO) and a
 * DPI-aware pair for the tray, and none of the machines this project is built on
 * is guaranteed to have ImageMagick or any other image tooling.
 *
 * Everything here is dependency-free — a minimal PNG encoder on top of node:zlib —
 * and every asset it writes is a PNG, which is the one format that can be verified
 * by decoding it with Chromium on any platform.
 *
 * Usage: npm run icons
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/* ── PNG encoding ──────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ -1) >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

/** Encodes straight RGBA bytes (top-down) as an 8-bit RGBA PNG. */
function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)

  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

/* ── Artwork ───────────────────────────────────────────────────────── */

const ACCENT_TOP = [56, 189, 248] // sky-400
const ACCENT_BOTTOM = [2, 132, 199] // sky-600
const INK = [255, 255, 255]

const SUPERSAMPLE = 4

function insideRoundedRect(x, y, size, inset, radius) {
  const min = inset
  const max = size - inset
  if (x < min || y < min || x > max || y > max) {
    return false
  }

  const cx = Math.min(Math.max(x, min + radius), max - radius)
  const cy = Math.min(Math.max(y, min + radius), max - radius)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= radius * radius
}

/**
 * Draws the brand mark: a rounded gradient tile with two text bars and a short
 * accent bar, which reads as "text + translation" even at 16px.
 */
function renderIcon(size) {
  const hi = size * SUPERSAMPLE
  const canvas = Buffer.alloc(hi * hi * 4)

  const radius = hi * 0.24
  const bars = [
    { x0: 0.24, x1: 0.76, y0: 0.32, y1: 0.4 },
    { x0: 0.24, x1: 0.76, y0: 0.48, y1: 0.56 },
    { x0: 0.24, x1: 0.52, y0: 0.64, y1: 0.72 }
  ]

  for (let y = 0; y < hi; y += 1) {
    for (let x = 0; x < hi; x += 1) {
      const at = (y * hi + x) * 4
      if (!insideRoundedRect(x + 0.5, y + 0.5, hi, 0, radius)) {
        continue
      }

      const t = (x / hi + y / hi) / 2
      canvas[at] = Math.round(ACCENT_TOP[0] + (ACCENT_BOTTOM[0] - ACCENT_TOP[0]) * t)
      canvas[at + 1] = Math.round(ACCENT_TOP[1] + (ACCENT_BOTTOM[1] - ACCENT_TOP[1]) * t)
      canvas[at + 2] = Math.round(ACCENT_TOP[2] + (ACCENT_BOTTOM[2] - ACCENT_TOP[2]) * t)
      canvas[at + 3] = 255
    }
  }

  const barRadius = hi * 0.04
  for (const bar of bars) {
    const x0 = bar.x0 * hi
    const x1 = bar.x1 * hi
    const y0 = bar.y0 * hi
    const y1 = bar.y1 * hi
    for (let y = Math.floor(y0); y < Math.ceil(y1); y += 1) {
      for (let x = Math.floor(x0); x < Math.ceil(x1); x += 1) {
        const cx = Math.min(Math.max(x + 0.5, x0 + barRadius), x1 - barRadius)
        const cy = Math.min(Math.max(y + 0.5, y0 + barRadius), y1 - barRadius)
        const dx = x + 0.5 - cx
        const dy = y + 0.5 - cy
        if (dx * dx + dy * dy > barRadius * barRadius) {
          continue
        }
        const at = (y * hi + x) * 4
        canvas[at] = INK[0]
        canvas[at + 1] = INK[1]
        canvas[at + 2] = INK[2]
        canvas[at + 3] = 255
      }
    }
  }

  // Box-downsample the supersampled canvas for anti-aliasing.
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const at = ((y * SUPERSAMPLE + sy) * hi + (x * SUPERSAMPLE + sx)) * 4
          const alpha = canvas[at + 3] / 255
          r += canvas[at] * alpha
          g += canvas[at + 1] * alpha
          b += canvas[at + 2] * alpha
          a += canvas[at + 3]
        }
      }
      const count = SUPERSAMPLE * SUPERSAMPLE
      const averageAlpha = a / count
      const weight = averageAlpha / 255
      const at = (y * size + x) * 4
      out[at] = weight > 0 ? Math.min(255, Math.round(r / count / weight)) : 0
      out[at + 1] = weight > 0 ? Math.min(255, Math.round(g / count / weight)) : 0
      out[at + 2] = weight > 0 ? Math.min(255, Math.round(b / count / weight)) : 0
      out[at + 3] = Math.round(averageAlpha)
    }
  }

  return out
}

/* ── Emit ──────────────────────────────────────────────────────────── */

async function writeFileAt(relativePath, buffer) {
  const target = join(projectRoot, relativePath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, buffer)
  console.log(`  ${relativePath} (${buffer.length} bytes)`)
}

async function main() {
  console.log('Generating icon assets…')

  const png = (size) => encodePng(size, size, renderIcon(size))

  await writeFileAt('resources/icons/icon.png', png(512))

  for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
    await writeFileAt(`resources/icons/${size}x${size}.png`, png(size))
  }

  await writeFileAt('resources/tray/tray.png', png(32))
  await writeFileAt('resources/tray/tray@2x.png', png(64))

  console.log('Done.')
}

await main()
