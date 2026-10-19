// The layout arithmetic of an agent card: the room its body leaves for the
// step strip, the spinner, and English counts.

export const MIN_CARD_WIDTH = 24
const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

/** The width a card's body text gets inside its border and padding. */
export const innerWidth = (width: number): number => Math.max(0, width - 4)

/** How many step glyphs fit beside `right` on a body line. */
export const stripRoom = (width: number, right: string): number =>
  Math.max(0, innerWidth(width) - right.length - 1)

export const spinnerFrame = (now: number, periodMs: number): string =>
  SPINNER[Math.floor(now / periodMs) % SPINNER.length] ?? '●'

export const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

// A 32-bit integer hash (lowbias32): the same column always gets the same shade.
const hash = (n: number): number => {
  let x = (n + 0x9e3779b9) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0

  return (x ^ (x >>> 16)) >>> 0
}

/**
 * `count` cells, each one of `shades` picked by its column, as noise: the
 * same at every draw, and never the same shade as the cell before it.
 */
export function shadedRun(count: number, shades: readonly string[]): string {
  const kinds = shades.length
  let out = ''
  let prev = -1
  for (let i = 0; i < count; i += 1) {
    let pick = hash(i) % kinds
    if (pick === prev && kinds > 1) pick = (pick + 1 + (hash(i + 7919) % (kinds - 1))) % kinds
    out += shades[pick] ?? ''
    prev = pick
  }

  return out
}
