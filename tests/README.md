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

### Developer test runner (real Figma, one click)
`plugin-dev/` is a separate, developer-only Figma plugin (**Mermapix Test Runner (dev)**, id `mermapix-test-runner-dev`). It is not published and not part of the production plugin. Its generated `plugin-dev/code.js` + `plugin-dev/ui.html` are committed, like `plugin/`, so you can import it without building.

**How to run**
1. Figma Desktop, open the file to test.
2. Plugins > Development > **Import plugin from manifest...** > choose `plugin-dev/manifest.json` (once).
3. Plugins > Development > **Mermapix Test Runner (dev)** > optionally filter fixtures / pick a theme > **Run all**. It renders every `tests/figma-fixtures/*.mmd` in dark and light (same Mermaid config, `buildExportSvg` and plugin conversion as the production plugin), inserts them on a new page `Test Run <YYYY-MM-DD HH:mm>`, one row per fixture with dark and light side by side, each inside a SECTION named `<fixture> · <theme>`. A failing fixture is recorded and does not stop the run.
4. Send the agent the file link (and the page name, shown in the plugin).

The runner audits each diagram (the `tests/figma-audit.js` metrics plus content overflowing the root frame, lost texts vs the payload SVG's `<text>` count, and near-black/near-white boxes over 25% of their parent) and shows a summary table (click a row to jump to it).

**Where results are stored** (readable with `getSharedPluginData`; `setPluginData` is not available via MCP): `figma.root` namespace `mermapix` key `lastAudit` (run summary + per-diagram issues), the same on the page, per-diagram `mermapix`/`audit` and `mermapix`/`meta` on each diagram root frame (and `audit` on failed placeholder sections), plus a TEXT node `Audit Summary` above the grid.

**How the agent reads them**: paste `tests/figma-read-audit.js` into `use_figma`. It returns `{ run, problems, clean }` (set `FULL = true` or list keys in `DETAIL` for the full per-diagram audit). `tests/figma-audit.js` is the older standalone audit of the current page (frames and sections); it is generated from `plugin-dev/src/auditCore.js`, the same module the runner uses, so they cannot drift (`node scripts/gen-figma-audit.mjs`, also run by the build, and checked by a unit test).

**Build**: `pnpm build:test-runner` (writes `plugin-dev/code.js`, `plugin-dev/ui.html`, regenerates `tests/figma-audit.js`). Run it after changing `plugin/src/`, `src/export/`, `src/themes/` or a fixture, because the runner bundles them. `pnpm build:plugin` is unaffected. Mock-Figma coverage: `unit/test-runner.test.mjs` (`plugin-mock/dev-runner.mjs` adds pages, sections, shared plugin data to the mock; Auto Layout positions are not recomputed by the mock, so `contentOverflow` is only meaningful in real Figma).

### How the Regression Harness Works
The test runner loads each fixture into the web editor via `localStorage`, programmatically clicks the **"SVG"** export action, captures the downloaded file, and compares its structural fingerprint (`*.summary.json`):
- Element counts (`rect`, `path`, `text`, `tspan`, etc.)
- **Zero `<foreignObject>` tags** (Figma strips `<foreignObject>`, resulting in missing text)
- Zero leaked CSS class attributes
- Normalized text label order and content matching
- Preservation of baseline fill colors and `classDef` styles

> Note: Absolute coordinates are intentionally excluded from comparison to avoid false positives caused by cross-platform font hinting differences.

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
