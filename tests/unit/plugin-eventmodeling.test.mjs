// Phase 10.1 eventmodeling: Mermaid draws every card label as <foreignObject> HTML. buildExportSvg now converts it
// to <text>/<tspan>, so the generic "nodes" fallback sees a rounded rect + one centered label per card and turns it
// into a frame with the label inside (fixture 40, tests/figma-fixtures/40-eventmodeling-cart.mmd, dark + light).
// Requires `pnpm build:plugin` first.
import test from 'node:test'
import assert from 'node:assert/strict'
import { walk } from '../plugin-mock/figma-mock.mjs'
import { runFixture } from '../plugin-mock/run-fixture.mjs'

const CARDS = ['ShopUI', 'AddItemToCart', 'ItemAdded', 'CartView', 'CheckoutUI', 'PlaceOrder', 'OrderPlaced', 'OrderStatus']
const LANES = ['UI/Automation', 'Command/Read Model', 'Events']
const all = (tree, pred) => { const out = []; walk(tree, (n) => pred(n) && out.push(n)); return out }
const lum = ({ r, g, b }) => { const f = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
const contrast = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }

for (const theme of ['dark', 'light']) {
  test(`[eventmodeling/${theme}] the payload carries all 8 card labels and the 3 lane labels as text`, async () => {
    const { svg } = await runFixture('40-case-eventmodeling-cart', theme)
    assert.ok(!/foreignObject/.test(svg), 'no foreignObject left')
    for (const label of [...CARDS, ...LANES]) assert.ok(new RegExp(`<tspan[^>]*>${label.replace('/', '\\/')}</tspan>`).test(svg), `${label} is a tspan`)
  })

  test(`[eventmodeling/${theme}] every card is a frame holding exactly its label, readable against the card fill`, async () => {
    const { root } = await runFixture('40-case-eventmodeling-cart', theme)
    for (const label of CARDS) {
      const frames = all(root, (n) => n.type === 'FRAME' && n.name.endsWith(`: ${label}`))
      assert.equal(frames.length, 1, `frame for ${label}`)
      const [frame] = frames
      assert.equal(all(frame, (n) => n !== frame && n.type === 'VECTOR').length, 0, `${label}: no loose vector`)
      const texts = all(frame, (n) => n.type === 'TEXT')
      assert.equal(texts.length, 1)
      assert.equal(texts[0].characters, label)
      const fill = frame.fills.find((f) => f.type === 'SOLID' && f.visible !== false)
      const ink = texts[0].fills.find((f) => f.type === 'SOLID')
      assert.ok(fill && ink, `${label} has a fill and a text color`)
      assert.ok(contrast(fill.color, ink.color) >= 4.5, `${label}: contrast ${contrast(fill.color, ink.color).toFixed(2)}`)
    }
    for (const lane of LANES) assert.equal(all(root, (n) => n.type === 'TEXT' && n.characters === lane).length, 1, `lane label ${lane}`)
    assert.equal(all(root, (n) => n.type === 'TEXT' && !n.characters.trim()).length, 0)
  })
}
