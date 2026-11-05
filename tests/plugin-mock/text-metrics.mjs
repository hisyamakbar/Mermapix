// Text width model shared by the mock Figma and the SVG importer.
// Arial advances are the real Helvetica/Arial AFM widths (1/1000 em). Inter is modelled as a
// constant factor wider than Arial per style (measured ratio is ~1.05-1.12 for UI strings).
const ARIAL = '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584'.split(' ').map(Number)

export const advance = (ch) => (ARIAL[ch.charCodeAt(0) - 32] ?? 600) / 1000
export const arialWidth = (s, size) => [...s].reduce((w, ch) => w + advance(ch), 0) * size

const INTER_FACTOR = { Regular: 1.06, Medium: 1.08, 'Semi Bold': 1.1, Bold: 1.12 }

export function textWidth(characters, font, size) {
  const f = font.family === 'Inter' ? INTER_FACTOR[font.style] ?? 1.06 : font.style === 'Bold' ? 1.06 : 1
  return Math.ceil(Math.max(0, ...String(characters).split('\n').map((l) => arialWidth(l, size))) * f)
}
export const lineHeight = (size) => Math.ceil(size * 1.15)
export const textHeight = (characters, size) => lineHeight(size) * Math.max(1, String(characters).split('\n').length)
