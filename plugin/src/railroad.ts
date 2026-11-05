// Railroad grammar diagrams (Phase 9.2: railroad-beta / ebnf / abnf / peg). Per rule Mermaid draws loose
// boxes, tracks, two marker circles and a rule name. They become:
//   terminal      -> FRAME `Terminal: <text>`      rounded box, fill + border merged, centered text
//   non-terminal  -> FRAME `NonTerminal: <text>`   square box, same
//   special       -> FRAME `Special: <text>`       square box with a `? text ?` label
//   start / end   -> FRAME `Start` / `End`         circle markers
//   tracks        -> VECTOR `Track`
//   rule name     -> TEXT (Inter Bold, left aligned, position kept)
//   rule          -> GROUP `Rule: <name>` holding all of the above flat (nested helper groups dissolved)
// Boxes reuse the shape engine (`convertShapeGroup`: FIXED size, Auto Layout centered label).

import { classifyShape } from './shapeGeometry.ts'
import {
  childOrigin,
  collectParts,
  convertShapeGroup,
  hasFill,
  hasStroke,
  paintFrameFromVectors,
  pathDataOf,
  styleShapeText,
  tag,
} from './shapes.ts'
import { absRect } from './subgraphs.ts'
import { boxKind, boxTitle, markerNames, ruleNameOf } from './railroadGeometry.ts'

export const RAILROAD_RULE_PREFIX = 'Rule: '

const isLive = (n: any): boolean => Boolean(n) && !n.removed

export interface RailroadResult {
  rules: number
  terminals: number
  nonTerminals: number
  specials: number
}

interface NameGroup {
  group: any
  text: any
  name: string
}

const weightOf = (t: any): number =>
  typeof t.fontWeight === 'number' ? t.fontWeight : t.fontName && /bold/i.test(t.fontName.style || '') ? 700 : 400

const liveKids = (n: any): any[] => (n && 'children' in n ? n.children.filter(isLive) : [])

/** The group holding only the bold `<name> =` text of a rule. */
function nameGroupOf(rule: any): NameGroup | null {
  for (const c of liveKids(rule)) {
    if (c.type !== 'GROUP') continue
    const kids = liveKids(c)
    if (kids.length !== 1 || kids[0].type !== 'TEXT') continue
    const name = ruleNameOf(kids[0].characters || '', weightOf(kids[0]))
    if (name !== null) return { group: c, text: kids[0], name }
  }
  return null
}

function findRules(root: any): Array<{ group: any; nameGroup: NameGroup }> {
  const out: Array<{ group: any; nameGroup: NameGroup }> = []
  const visit = (n: any): void => {
    for (const c of liveKids(n)) {
      if (c.type !== 'GROUP') continue
      const ng = nameGroupOf(c)
      if (ng) out.push({ group: c, nameGroup: ng })
      else visit(c)
    }
  }
  visit(root)
  return out
}

/** Leaf-level groups (no group/frame children) below `rule`, in z-order. */
function leafGroups(rule: any): any[] {
  const out: any[] = []
  const visit = (n: any): void => {
    for (const c of liveKids(n)) {
      if (c.type !== 'GROUP') continue
      if (liveKids(c).some((k) => k.type === 'GROUP' || k.type === 'FRAME')) visit(c)
      else out.push(c)
    }
  }
  visit(rule)
  return out
}

/** Moves every child of nested GROUPs up into `rule`, preserving z-order, and deletes the emptied groups. */
function flattenInto(rule: any): void {
  let guard = 0
  let again = true
  while (again && guard++ < 50) {
    again = false
    for (const c of [...rule.children]) {
      if (c.type !== 'GROUP') continue
      const at = rule.children.indexOf(c)
      const kids = [...c.children]
      kids.forEach((k, i) => rule.insertChild(at + i, k))
      try {
        c.remove()
      } catch {}
      again = true
    }
  }
}

export function convertRailroad(root: any): RailroadResult {
  const res: RailroadResult = { rules: 0, terminals: 0, nonTerminals: 0, specials: 0 }
  for (const { group: rule, nameGroup } of findRules(root)) {
    // 1. boxes (rect + label) and 2. marker circles, collected from the original leaf groups.
    const circles: Array<{ v: any; x: number }> = []
    for (const g of leafGroups(rule)) {
      if (g === nameGroup.group) continue
      const parts = collectParts(g)
      if (parts.others.length > 0 || parts.vectors.length !== 1) continue
      const v = parts.vectors[0]
      const cls = classifyShape(pathDataOf(v), v.width, v.height)
      if (parts.texts.length === 1) {
        if (!cls.rectLike || (!hasStroke(v) && !hasFill(v))) continue
        const converted = convertShapeGroup(g)
        if (!converted) continue
        const kind = boxKind(cls.cornerRadius, converted.label)
        converted.frame.name = boxTitle(kind, converted.label)
        tag(converted.frame, 'mermapix:kind', `Railroad ${kind}`)
        tag(converted.frame, 'mermapix:label', converted.label)
        if (kind === 'Terminal') res.terminals++
        else if (kind === 'Special') res.specials++
        else res.nonTerminals++
      } else if (parts.texts.length === 0 && cls.kind === 'Circle' && hasFill(v)) {
        circles.push({ v, x: absRect(v).x })
      }
    }
    const names = markerNames(circles.map((c) => c.x))
    circles.forEach((c, i) => {
      const cls = classifyShape(pathDataOf(c.v), c.v.width, c.v.height)
      const frame = paintFrameFromVectors([c.v], cls, names[i])
      tag(frame, 'mermapix:kind', `Railroad ${names[i]}`)
    })

    // 3. rule name: Inter Bold, left aligned, same left edge and vertical center.
    const t = nameGroup.text
    const a = absRect(t)
    const cy = a.y + a.height / 2
    styleShapeText(t)
    try {
      t.textAlignHorizontal = 'LEFT'
    } catch {}
    t.y = cy - t.height / 2 - childOrigin(t.parent).y
    t.name = `${nameGroup.name} =`

    // 4. remaining plain vectors are tracks.
    const nameTracks = (n: any): void => {
      for (const c of liveKids(n)) {
        if (c.type === 'VECTOR') c.name = 'Track'
        else if (c.type === 'GROUP') nameTracks(c)
      }
    }
    nameTracks(rule)

    // 5. one flat `Rule: <name>` group.
    flattenInto(rule)
    rule.name = `${RAILROAD_RULE_PREFIX}${nameGroup.name}`
    tag(rule, 'mermapix:kind', 'Railroad Rule')
    res.rules++
  }
  return res
}
