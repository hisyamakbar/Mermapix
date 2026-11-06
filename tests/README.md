# Mermapix Test Suite & Verification

Mermapix utilizes a two-tier verification approach:

1. **Automated Testing**:
   - Headless Chrome SVG export regression runner (`export-svg.mjs`)
   - Unit tests for DBML/SQL converters and Markdown code sanitizers (`unit/`)
2. **Manual Figma Verification**:
   - Validating that pasted or inserted nodes produce native, editable vector layers and Auto Layout frames inside Figma.

---

## Directory Structure

```
tests/
  fixtures/        # Stable Mermaid sample files for regression testing
    erd-basic.mmd
    flowchart-basic.mmd
    sequence-basic.mmd
  baseline/        # Verified baseline SVG exports and structural summaries (*.summary.json)
  output/          # Latest generated export artifacts (git-ignored)
  unit/            # Node native test runner suite (converters, sanitizers)
  export-svg.mjs   # Headless Chrome CDP automation harness
```

---

## 1. Automated Regression & Unit Testing

The export regression runner requires the development server to be accessible (`pnpm dev`, port 8443) and Google Chrome installed.

```bash
# Run unit tests (converters, markdown fences, table naming)
pnpm test:unit

# Re-export fixtures -> tests/output and compare against baseline
pnpm test:export
```

### Figma plugin tests (mock Figma)
`unit/plugin-*.test.mjs` run the real built `plugin/code.js` (run `pnpm build:plugin` first) against real Mermaid payload SVGs through a mock Figma sandbox (`plugin-mock/`: `svg-import.mjs` imitates `figma.createNodeFromSvg`, `figma-mock.mjs` the plugin API, `layout-sim.mjs` a minimal Auto Layout simulation, `survey-metrics.mjs` layer metrics).
- Payload SVGs: `fixtures/plugin/*.svg` (dark, `-light` for light theme); `fixtures/plugin/survey/*.svg.gz` are the gzipped payloads of the remaining Mermaid types (Phase 8.5 survey). Sources: `figma-fixtures/*.mmd`.
- `MERMAPIX_CODE=<path> pnpm test:unit` runs the plugin tests against another bundle (e.g. the previous `code.js`) to prove a new test fails before the fix. The mock importer reproduces real Figma's inline `<clipPath>` behavior (a visible shape, not a mask).
- Regenerate a payload: load the `.mmd` in the web app, pick the theme and use the **SVG** export button (what the plugin UI posts).

### Export fixtures, viewBox check and colour audit (Phase 10.1)
- `node tests/export-fixtures.mjs --out <dir> [--shots <dir>] [--only 37,40] [--themes dark]` exports every `figma-fixtures/*.mmd` in both themes through the real **SVG** button and checks that the exported content (client rects of all painted shapes and texts, mapped into SVG user space) lies inside the exported viewBox (1px tolerance; layers wholly outside the box, such as gantt's today marker, are Mermaid clipping them on purpose). Writes `<name>-<theme>.svg`, `viewbox-check.txt` and optionally a PNG per export; exit code 1 on any overflow or leftover `<foreignObject>`. These files are what `fixtures/plugin/*` hold: regenerate a payload by copying the matching `<name>-<theme>.svg` (dark = no suffix, `-light` for light; survey payloads are gzipped).
- `node tests/color-audit.mjs` (`pnpm test:colors`) also audits `<foreignObject>` HTML labels (`h` column) and the `<text>` of the exported SVG (`x` column, mounted 1:1 on the diagram background).
- `unit/export-viewbox.test.mjs` (padding rule), `unit/plugin-safety-net.test.mjs` (the plugin's root frame never crops its content) and `unit/plugin-eventmodeling.test.mjs`.

### How the Regression Harness Works
The test runner loads each fixture into the web editor via `localStorage`, programmatically clicks the **"SVG"** export action, captures the downloaded file, and compares its structural fingerprint (`*.summary.json`):
- Element counts (`rect`, `path`, `text`, `tspan`, etc.)
- **Zero `<foreignObject>` tags** (Figma strips `<foreignObject>`, resulting in missing text)
- Zero leaked CSS class attributes
- Normalized text label order and content matching
- Preservation of baseline fill colors and `classDef` styles

> Note: Absolute coordinates are intentionally excluded from comparison to avoid false positives caused by cross-platform font hinting differences.

> The Phase 0 baselines (`baseline/*.summary.json`) no longer match the current pipeline (extra `<g>`/`<path>` counts, fill palette; also true on commits before Phase 10.1). The positive-origin viewBox fix does not touch them: ERD, flowchart and sequence exports are byte-identical to before apart from rough.js path jitter.

To intentionally update verified baselines after updating fixtures or themes:
```bash
node tests/export-svg.mjs --out tests/baseline
```

---

## 2. Manual Verification in Figma

Perform this verification after modifying themes, the SVG export pipeline, or the Auto Layout plugin engine:

1. Open the Mermapix web app or companion plugin.
2. Load an ERD fixture or example into the editor.
3. Click **Copy to Figma** (Web) or **Insert to Canvas** (Plugin).
4. In Figma, verify:
   - [ ] Resulting nodes are native **editable layers**, not flattened raster images.
   - [ ] ERD tables are structured into vertical **Auto Layout frames** (Plugin) with clean padding.
   - [ ] Text nodes can be edited directly with a double-click without drill-down friction.
   - [ ] Text is properly vertically and horizontally centered inside entity cells.
   - [ ] Line arrows, relationship paths, and cardinality notations render crisply.
   - [ ] ERD types, keys (PK, FK, UK), and column notes are preserved.
