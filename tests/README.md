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
  figma-fixtures/  # One or more diagrams per Mermaid type (export, viewBox, colour audit, Test Runner)
  official-samples/ # Mermaid's own sample diagrams (@mermaid-js/examples), see its README
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
- Payload SVGs: `fixtures/plugin/*.svg` (dark, `-light` for light theme); `fixtures/plugin/survey/*.svg.gz` are the gzipped payloads of the remaining Mermaid types (Phase 8.5 survey) and of the Phase 14 types (`usecase`, `usecase-variants`, `usecase-extras`, `agentflow`, `agentflow-extras`). Sources: `figma-fixtures/*.mmd`. All of them are **Mermaid 12.3.0** exports taken through the real **SVG** button of the current tree (theme CSS and the 12.x layout pins included); the earlier 11.16.1 payloads are gone. `usecase*` / `agentflow*` have dedicated converters (`plugin-usecase.test.mjs`, `plugin-agentflow.test.mjs`) and are listed as dedicated in `plugin-generic.test.mjs`, which proves the generic fallback stays away from them.
- `MERMAPIX_CODE=<path> pnpm test:unit` runs the plugin tests against another bundle (e.g. the previous `code.js`) to prove a new test fails before the fix. The mock importer reproduces real Figma's inline `<clipPath>` behavior (a visible shape, not a mask).
- Regenerate the payloads: with the dev server running, `node tests/export-fixtures.mjs --out <dir>` writes `<fixture>-<theme>.svg` for every fixture; copy each to its payload name (dark = no suffix, `-light` for light, survey payloads gzipped with `gzip -9`; mapping: the `NN-case-*` / `N-ex-*` names above, `NN-survey-<type>` to `survey/<type>`, `43-usecase-checkout` to `survey/usecase`, `44-usecase-variants` to `survey/usecase-variants`, `45-agentflow-support` to `survey/agentflow`, `46-usecase-extras`, `47-agentflow-extras` likewise). Mermaid's hand-drawn paths (rough.js) draw their control points at random, so a re-export of an unchanged diagram differs in path data (never in bounds, ids or text): compare layer trees, not bytes. Then `pnpm build:plugin && pnpm test:unit`. A single payload by hand: load the `.mmd` in the web app, pick the theme and use the **SVG** export button (what the plugin UI posts).
- `fixtures/plugin/raw-erd-not-inlined.svg` is derived, not exported: it is `baseline/erd-basic.svg` with its four `<g class="inlined-marker ...">` groups removed again (`svg.replace(/<g class="inlined-marker[^>]*>[\s\S]*?<\/g>/g, '')`), i.e. an export from before marker inlining. Refresh it whenever `baseline/erd-basic.svg` is refreshed (`node tests/export-svg.mjs --out tests/baseline`).
- Use case and agentflow suites share `plugin-mock/diagram-asserts.mjs` (zero-drop texts, no generic names, every painted vector keeps its bounds, fallback tag absent). The 12.3.0 official samples `usecase__0..2` and `agentflow__0` (`official-samples/`) convert with the same rules; they are not payload fixtures, check them by hand after changing `usecase.ts` / `agentflow.ts` (`export-fixtures.mjs --fixtures` on a folder holding them, then the mock tree).

### Source-linked diagrams (edit after insert)
How the feature works: [`docs/source-linked-diagrams.md`](../docs/source-linked-diagrams.md). Four suites cover it, none needs Figma:

| Suite | What it proves |
|---|---|
| `unit/plugin-source-link.test.mjs` | The code is stored on the root and found from any nested layer; fingerprint rules; `transplantDiagram` keeps the root; insert, selection and update end to end; every failure path leaves the target untouched. |
| `unit/plugin-snapshot.test.mjs` | Per-layer stamps and text context; every field of the change report; an untouched diagram of every diagram family reports nothing. |
| `unit/source-patch.test.mjs` | Writing a canvas text edit into Mermaid code, per context kind, including every case that must stay unresolved; the wording of the apply result and confirmation. |
| `unit/plugin-roundtrip.test.mjs` | The seam between the two halves: an edit on the mock canvas, reported by the sandbox bundle, written into the real example code. |
| `unit/plugin-watch.test.mjs` | Live link: the sandbox watch (`watch-diagram`, page `nodechange`, debounce), repeated canvas edits written into the code as the UI does it (`pendingEdits`), quiet updates, one undo step per update, an edit made while an update loads fonts. |
| `unit/live-sync.test.mjs` | Live update rules and wording (`src/plugin/liveSync.ts`). |
| `unit/figma-theme.test.mjs` | Which theme the plugin shows: Figma's at open, on a Figma switch, in and after edit mode (`src/plugin/figmaTheme.ts`). |

- `plugin-mock/session.mjs` starts the bundle once and lets a test send several messages (`send`), change the selection (`select`, fires `selectionchange`) and read what the sandbox posted. It adds a document, a page, `getNodeByIdAsync`, relaunch data and two failure switches (`IMPORT_FAILURE`, `OPTIMIZE_FAILURE`) to make the SVG import or the optimizer throw. `runPlugin` in `figma-mock.mjs` stays the single-message runner of the older suites.
- The sandbox suites run the built `plugin/code.js`: run `pnpm build:plugin` first. `source-patch.test.mjs` imports the TypeScript directly and needs no build.
- What the mock cannot show: it does not recompute Auto Layout (growth after a text edit is simulated by hand), it has no undo, and it says nothing about the cost of writing plugin data on every layer. Those are in the manual round below.

### Export fixtures, viewBox check and colour audit (Phase 10.1)
- `node tests/export-fixtures.mjs --out <dir> [--shots <dir>] [--only 37,40] [--themes dark]` exports every `figma-fixtures/*.mmd` in both themes through the real **SVG** button and checks that the exported content (client rects of all painted shapes and texts, mapped into SVG user space) lies inside the exported viewBox (1px tolerance; layers wholly outside the box, such as gantt's today marker, are Mermaid clipping them on purpose). Writes `<name>-<theme>.svg`, `viewbox-check.txt` and optionally a PNG per export; exit code 1 on any overflow or leftover `<foreignObject>`. These files are what `fixtures/plugin/*` hold: regenerate a payload by copying the matching `<name>-<theme>.svg` (dark = no suffix, `-light` for light; survey payloads are gzipped).
- `node tests/color-audit.mjs` (`pnpm test:colors`) also audits `<foreignObject>` HTML labels (`h` column) and the `<text>` of the exported SVG (`x` column, mounted 1:1 on the diagram background).
- `--fixtures <dir>` exports another folder of `.mmd` files with the same checks (default `tests/figma-fixtures`). Mermaid's own samples: `node tests/export-fixtures.mjs --fixtures tests/official-samples --out <dir>` (82 files, about 6 minutes for both themes). A sample that does not render is listed as `ERROR no svg rendered: <the editor's message>`.
- `unit/export-viewbox.test.mjs` (padding rule), `unit/plugin-safety-net.test.mjs` (the plugin's root frame never crops its content) and `unit/plugin-eventmodeling.test.mjs`.

### Diagram type coverage (Phase 14)
Mermaid adds diagram types between releases and the docs list some that Mermapix cannot render, so the suite checks the types themselves, not only the fixtures we remembered to write.
- `unit/diagram-coverage.test.mjs` (in `pnpm test:unit`, no browser) asks the installed Mermaid which diagram ids it registers (`mermaid.initialize` then `getRegisteredDiagramsMetadata()`, which works in Node) and requires each one to be supported, refused on purpose or internal. Supported: listed in `DIAGRAM_KEYWORDS` (`src/utils/diagramSupport.ts`) and covered by a fixture in `figma-fixtures/` or `official-samples/` that Mermaid's `detectType` assigns to it. Refused: an entry in `UNSUPPORTED_DIAGRAMS` (same file) with the reason and the message the editor shows. Internal (`error`, `---`, `info`): `INTERNAL_IDS` in the test.
- After a Mermaid upgrade that adds a type the test fails with the new id and the three ways out (convert it with a fixture, refuse it with a message, or mark it internal). It also fails when a listed keyword is no longer detected as its type, when a refused type starts to render, or when a type disappears.
- `unit/diagram-support.test.mjs`: the editor message for code that cannot render (`explainRenderError`): a refused type names itself and the alternative, a misspelled first word is never called unsupported and gets a "Did you mean" suggestion, any other error passes through.
- Refresh Mermaid's samples: [`official-samples/README.md`](official-samples/README.md).

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

> Baselines were refreshed on 2026-11-06 (after Phases 8–10: palette, marker inlining, export fixes) and the compare passes again. The `inlined-marker …` classes added by `src/export/markers.ts` are intentional and allowed by the class-leak check; any other `class` attribute in an export is still a failure.

To intentionally update verified baselines after updating fixtures or themes:
```bash
node tests/export-svg.mjs --out tests/baseline
```

---

## 2. Manual Verification in Figma

Perform this verification after modifying themes, the SVG export pipeline, or the Auto Layout plugin engine:

1. Open the Mermapix companion plugin in Figma.
2. Load an ERD fixture or example into the editor.
3. Click **Insert to Canvas**.
4. In Figma, verify:
   - [ ] Resulting nodes are native **editable layers**, not flattened raster images.
   - [ ] ERD tables are structured into vertical **Auto Layout frames** (Plugin) with clean padding.
   - [ ] Text nodes can be edited directly with a double-click without drill-down friction.
   - [ ] Text is properly vertically and horizontally centered inside entity cells.
   - [ ] Line arrows, relationship paths, and cardinality notations render crisply.
   - [ ] ERD types, keys (PK, FK, UK), and column notes are preserved.

### Use case and agentflow diagrams (Mermaid 12.3.0, Phase 14.3 / 14.4)

Insert `figma-fixtures/43-usecase-checkout.mmd`, `44-usecase-variants.mmd`, `46-usecase-extras.mmd`, `45-agentflow-support.mmd`, `47-agentflow-extras.mmd` with the production plugin (dark and light) and compare each with the preview.

Use case
- [ ] Each actor is ONE frame `Actor: <name>` (select it in the Layers panel and drag it: figure and name move together). The figure looks like the preview (plain, hollow, awesome, business slash, icon placeholder).
- [ ] Each use case is a frame `Use Case: <label>`: the ellipse is a vector inside it (a frame cannot be elliptical), stroke and fill like the preview, the label is editable text centred on the ellipse (double-click edits it without ungrouping). The rect form `Name[Label]` is an Auto Layout frame with square corners and the paint on the frame itself.
- [ ] Check the ellipse stroke (2px, centre aligned) is not clipped at the wrapper frame's edge and that the label stays centred after editing it to something longer.
- [ ] System boundary `System Boundary: <title>` and package `Package: <title>` (Tab + Body frames): border, title and tab look like the preview; the use cases are children of the boundary (drag the boundary: they follow); actors outside it stay outside.
- [ ] Notes `Note: <text>`; the dotted note connector reaches the note and its actor.
- [ ] Layers panel: one `Connectors` group on top with `Edge: A → B` per relation; the arrowhead, circle or hollow generalization arrow (`Inheritance Arrow`) and the «include» / «extend» label are inside their edge group; arrowheads touch the ellipse border like in the preview (no gap, no overlap).
- [ ] Edit a use case label, an actor name and a boundary title on the canvas with the plugin open in edit mode: the code follows (`Browse("...")`, `actor Customer("...")`, `systemBoundary shop["..."]`).

Agentflow
- [ ] Nodes are frames named by kind (`Task:`, `Tool:`, `Input:`, `Decision:`, `Action:`, `Refdoc:`) with the shape (parallelogram, double-bar rectangle, diamond, hexagon, lined document) as one vector, border and fill like the preview; tasks are rounded Auto Layout frames. The lined document no longer has a second, stacked outline vector.
- [ ] Flow containers are `Flow: <title>` frames (stroke only, rounded corners), nested like the source, with their nodes as children.
- [ ] Edges: `Edge: A → B` groups in `Connectors`; the line layer is named `Sequence`, `Reference` (dotted, no arrow, suffix `(reference)`) or `Failure` (cross marker, suffix `(failure)`); the `yes` / `no` labels travel with their edge.
- [ ] Edit a node label and a flow title on the canvas in edit mode: the code follows (`classify["..."]@{ shape: task }`, `flow triage["..."]`).

### Source-linked diagrams (edit after insert)

Run this round after changing `plugin/src/sourceLink.ts`, `snapshot.ts`, `update.ts`, `main.ts` or anything in `src/plugin/`. Use the production plugin (`plugin/manifest.json`), not the test runner: plugin data is private to the plugin id.

Insert and update
- [ ] Insert a diagram: the strip "Diagram selected" with **Edit source** appears right away, and Figma shows the **Edit diagram** button for the selected diagram.
- [ ] Select a layer deep inside the diagram: the strip still appears.
- [ ] **Edit source**, change the code, **Update diagram**: the diagram changes in place (same position, parent, layer order, layer name) and **no** "edited in Figma" question appears. A question here is a false positive of the fingerprint or the stamps.
- [ ] Undo once in Figma: the previous diagram is back.
- [ ] Names: a new diagram is named from its code. Frontmatter `title:` or a `title` line in a sequence, gantt or pie (`pie showData title X`) diagram gives that title; without one the diagram type ("Flowchart", "ER diagram", "Sequence diagram"); an ERD with a column named `title` is still "ER diagram".
- [ ] Rename the diagram layer in Figma, edit the code, update: the new name is kept.
- [ ] No download menu in the plugin (toolbar and mobile export menu); the web app still downloads SVG and PNG. Export the inserted layers with Figma's Export panel.
- [ ] The strip has no "Insert as new". Duplicate the diagram (Cmd+D / Ctrl+D), select the copy and edit it: the original is untouched and the copy updates on its own.
- [ ] Update button (edit mode): "Up to date" (disabled) right after opening or after an update; "Update" after a change in the editor with Live off; "Updating…" (disabled) during an update; "Update" again after moving a layer in Figma.
- [ ] Save, up to date: leaves edit mode at once and the previous draft comes back.
- [ ] Save, Live off with typed code: shows "Saving…", the diagram changes, then leaves and the draft comes back.
- [ ] Save while an update is running (slow diagram) and with code typed during it: the diagram ends up with the last code, then leaves.
- [ ] Save right after typing, before the preview has rendered: the diagram still gets the typed code.
- [ ] Save after moving a node in Figma and changing the code: the strip asks **Replace & save** / **Keep editing**. Keep editing leaves everything as is; Replace & save updates and leaves.
- [ ] Save with a syntax error in the code, or with an empty editor: the strip asks **Leave anyway** / **Keep editing**. Leave anyway keeps the diagram's last update and restores the draft. Fixing the code while it asks closes the question; Save then works normally.
- [ ] Fix a syntax error and click Save at once (before the preview catches up): no "Leave anyway" question, the fixed code is saved.
- [ ] Save when the update fails (for example the diagram was deleted or the source is too large): stays in edit mode and shows the error.
- [ ] A diagram inside a component instance: the button is a ✕ **Close** and only leaves edit mode.

Live link (plugin stays open)
- [ ] Type in the editor: about a second after you stop, the diagram in Figma changes. No toast, the selection does not jump, the line under the editor reads "The diagram in Figma updates as you type."
- [ ] Type a syntax error: nothing is sent; fix it: the diagram follows.
- [ ] Edit a label on the canvas: within a second the code has it and the strip says "Added 1 text edit from Figma to the code." **Undo** takes it out and it is not added again.
- [ ] Edit the same label a second time, then rename an ERD table and edit a column in it: the code follows each time, without reopening the plugin.
- [ ] While you type a label on the canvas, the diagram is not regenerated under your cursor.
- [ ] Move a node, then type in the editor: the confirmation names the move, live update pauses ("Live update is paused") until **Update** / **Update anyway**.
- [ ] Cmd+Z in Figma after a few live updates: each Cmd+Z takes back one update, and the diagram is never left half regenerated.
- [ ] **Live** switch off: typing changes only the preview, the label reads "Live off" with a hollow dot ("Live on" with a green dot, "Live paused" with an amber dot after a Figma edit); the choice survives reopening the plugin.
- [ ] **Revert**: the code and the diagram go back to how they were when editing started.
- [ ] An ordinary diagram (about 0.8 s per update): live update stays on and simply waits a little longer after you stop typing.
- [ ] A large diagram: only when each update takes several seconds does live update turn itself off with a note; **Update diagram** still works. The plugin console (Plugins > Development > Show console) logs where the time of a slow update goes.
- [ ] Start from the **Edit diagram** button with the plugin closed: it opens in edit mode with the diagram's code.

Plugin theme follows Figma (production plugin; switch Figma's theme in its preferences while the plugin is open)
- [ ] Figma in dark: open the plugin: UI, preview and the Light/Dark toggle are dark. Close it, switch Figma to light, open it again: light (the previous run's theme is not remembered).
- [ ] With the plugin open, switch Figma's theme: the plugin follows at once, even after you used the Light/Dark toggle. The toggle itself still changes the theme for this session.
- [ ] Insert a diagram: it uses the theme shown in the plugin (light plugin = light diagram).
- [ ] Select a diagram stored in the other theme and **Edit source**: the plugin shows the diagram's theme. Switch Figma's theme during the edit: the plugin theme does not change and the diagram is not regenerated (no extra undo step in Figma). **Save**: the plugin goes to Figma's current theme. Repeat without switching Figma: after **Save** the theme you had before editing comes back.
- [ ] The plugin looks the same as before (Figma's `--figma-color-*` variables must not change colors or fonts).

Plugin window never scrolls (Windows; macOS hides the problem because its scrollbars overlay)
- [ ] Windows, Figma desktop: open the plugin (500x680) in the Code tab, the Diagram tab, the empty-editor card, with the Examples menu open and with the About and Import dialogs open: no scrollbar along the window edge. Mouse wheel and touchpad scrolling over the header, the tab bar and the footer do nothing; only the code editor, the diagram canvas (pan), the Examples menu and a dialog taller than the window scroll on their own.
- [ ] Edit mode with the note and the "Added ... text edits" row showing: nothing scrolls away, Save/Revert/Undo stay reachable. Repeat with Windows display scaling at 125% and 150%.

Edits made in Figma
- [ ] Change a flowchart node label on the canvas with the plugin closed, then **Edit source**: the label is added to the code ("Added 1 text edit from Figma to the code."); **Update diagram** runs without a question.
- [ ] ERD: rename a column in one table whose name also exists in another table (`id`): only the right table changes in the code. Rename a table title: its relationships follow.
- [ ] Make a label much longer inside an Auto Layout node or an ERD cell: the report shows the text edit and no "moved or resized layers".
- [ ] Move a node, recolor a fill, recolor only a stroke, delete a layer, duplicate a layer: each is named in the confirmation before the update.

Copies, components, other places
- [ ] Duplicate a diagram and edit the copy: the original is untouched.
- [ ] Turn the diagram into a component (the code must still load), create an instance, update the main component: the instance follows. Select the instance: the code loads, the main button stays **Insert to Canvas**.
- [ ] A diagram inside an Auto Layout frame and inside a Section updates without breaking the parent.
- [ ] FigJam: insert, select, edit, update.
- [ ] A diagram on another page than the current one (start edit mode, switch page, update).

Size and age
- [ ] A large diagram (a few hundred nodes): insert and **Edit source** stay responsive with the per-layer stamps.
- [ ] A diagram inserted by an older build (no code): no strip, nothing breaks.
