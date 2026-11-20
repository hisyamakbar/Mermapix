# Changelog

All notable changes to Mermapix are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## 1.2.0 - 2026-11-20

### Added
- **The plugin theme follows Figma.** The theme follows Figma's light or dark theme each time the plugin opens and when Figma's theme changes (not while a diagram is being edited); the Light/Dark toggle still switches it for the session.
- **Edit a diagram after inserting it (plugin).** Every diagram the plugin inserts now remembers its Mermaid code and theme. Select the diagram, or any layer inside it, and the plugin offers **Edit source**; change the code and **Update diagram** regenerates it in place, keeping its position, parent, layer order and layer name. Figma also shows an **Edit diagram** button for a selected diagram. Copies and duplicates are each editable on their own. See [`docs/source-linked-diagrams.md`](docs/source-linked-diagrams.md).
- **Text edited in Figma goes into the code (plugin).** While a diagram is being edited, a label, table or column name, type, key or comment you change directly on the canvas is written into the code by itself, without reopening the plugin ("Added 1 text edit from Figma to the code." with **Undo**). ERD cells are placed by table and row, node labels by their Mermaid id, everything else only when the text occurs exactly once in the code. Anything that cannot be placed safely is listed for you to type.
- **Live update (plugin).** While a diagram is being edited, it follows the editor: a short pause in typing regenerates it in Figma, without a toast and without moving your selection. A **Live** switch in the strip turns it off (remembered); live update pauses by itself when the diagram was changed in Figma, waits longer between updates for diagrams that take a while to regenerate, and turns itself off only when each update takes several seconds. **Revert** puts the code and the diagram back to how they were when editing started. Each update is its own undo step in Figma.
- The line under the plugin editor says what follows your typing: the preview, or the diagram in Figma.
- **Specific warning before an update replaces manual work (plugin).** If a diagram was changed in Figma, the update names what it would replace ("2 moved or resized layers, 1 restyled layer") and waits for **Update anyway**. When the only changes are text edits you already applied to the code, it updates without asking.
- Your draft in the plugin editor is kept: loading a diagram's code needs a click, and closing edit mode restores the draft.
- **Save (plugin).** The button that ends edit mode is now **Save** (disk icon): it brings the diagram in Figma up to date with the code, then leaves edit mode and gives the editor your previous draft back. If the diagram was edited in Figma it asks first (**Replace & save** or **Keep editing**); if the code has a syntax error it asks **Leave anyway** or **Keep editing**; if the update fails it stays in edit mode and shows the error. A diagram inside a component instance, which cannot be updated, gets a ✕ **Close** instead.
- **The update button shows its state (plugin).** While editing, it reads **Updating…** during an update and **Up to date** when the diagram matches the code and nothing was changed in Figma; otherwise **Update**.
- **New diagrams are named from their code (plugin).** The layer name comes from the YAML frontmatter `title:`, a `title` directive (sequence, gantt, journey, pie, quadrant, timeline, xychart, C4 and similar), `accTitle:`, or else the diagram type ("Flowchart", "ER diagram", ...). Updates keep the layer's current name, so a rename in Figma is kept.

### Changed
- Plugin: the plugin no longer remembers its theme between runs (the code draft and the Live switch are still remembered).
- Web app: the main button is now **Open in Figma**. It opens the Mermapix plugin on Figma Community in a new tab (a plain link: it does not copy the code; paste your Mermaid code into the plugin and click Insert). **Copy to Figma** (SVG via the clipboard) is removed: a pasted SVG has no Auto Layout and is far behind what the plugin builds. SVG and PNG downloads stay. The plugin itself is unchanged.
- Web app: the onboarding card shown when the editor is empty now reads, in step 3, "Open in Figma: Get the Mermapix plugin, paste your code and click Insert".
- The web app moved to https://mermapix.hisyamakbar.com (Cloudflare); the old mermapix.netlify.app address redirects there. Canonical URL, Open Graph, structured data, `robots.txt`, `sitemap.xml` and the `llms` files use the new address, and the response headers moved from `netlify.toml` to `public/_headers`.
- README, `llms.txt`, `llms-full.txt` and the structured data point to the Figma Community listing; the README has an install section for the published plugin and keeps the development-plugin steps for contributors.
- Plugin: the empty-canvas card describes Insert ("Insert into Figma: click Insert to add the diagram as editable layers. Select it later to edit its code.") instead of Copy to Figma.
- Web app: the About dialog links to the plugin on Figma Community.
- Plugin: **Insert as new** is removed from the editing strip. To branch a diagram, duplicate it in Figma (Cmd+D / Ctrl+D), select the copy and edit it; each copy is linked on its own.
- Plugin: the SVG and PNG download buttons are hidden. Export the inserted layers with Figma's own Export panel (SVG, PNG, PDF, any scale). The web app keeps its downloads.
- Plugin: the **Live** switch reads "Live on", "Live off" or "Live paused"; its dot is green when on, hollow when off and amber when paused or slow.

### Fixed
- **Canvas text edits never land on the wrong ERD row while the editor is ahead (plugin).** When you had typed in the editor and the diagram was not regenerated yet (or Live was off), a text edit made on the canvas was placed by row number in the changed code, so it could land on another row. It is now placed where the diagram's own code has it and carried over only when that line, and the table it belongs to, is unchanged in the editor; otherwise it is listed as "Could not match".
- Plugin: on Windows the plugin window showed a page scrollbar; scrolling it moved the whole app away and left an empty window.
- The Load Sample ERD Schema button on the empty canvas (web and plugin) now loads the sample into the editor; it did nothing because the canvas's pan handler captured the pointer and swallowed the click. Presses on buttons, links and inputs inside the canvas no longer start a pan.
- Plugin: code typed just before finishing edit mode was dropped when **Live** was off, while an update was in flight, or before the preview had rendered: the editor went back to the draft and the diagram was not updated. **Save** now updates the diagram first.
- Plugin: **Update diagram** clicked right after typing could send the previous preview; an update now waits for the preview of the current code.

### Notes
- Mermaid code cannot express positions, sizes or manual colors, so those edits are still replaced by an update (after the warning). Diagrams inserted with 1.1.0 or earlier, and diagrams pasted from the web app's former **Copy to Figma**, carry no code and cannot be edited this way.
- A Mermaid source above about 90 kB is inserted but not stored (Figma limits one plugin data entry to 100 kB); the plugin says so.
- The plugin manifest gains `relaunchButtons` (the **Edit diagram** button). Network access is unchanged: none.

## 1.1.0 - 2026-11-06

### Added
- **Native Figma structure for every diagram type (plugin).** Each shape becomes a FRAME with its fill and border merged into the frame (no separate outline vector), text inside, positions exactly as Mermaid laid them out, and semantic layer names instead of "Vector" / "Group".
  - Flowcharts and sitemaps: every node shape, subgraphs as frames holding their nodes, connectors in one `Connectors` group named `Edge: A → B`, edge labels as pill frames.
  - Sequence diagrams: participants, actors, notes, activations, badges and alt/loop/opt/par/critical/break blocks as frames; one named group per message.
  - Class diagrams: Auto Layout class boxes (header, attributes, methods), namespaces, notes, interfaces.
  - State diagrams: states, composite states with their own start/end, regions, start/end/choice/fork/join, notes.
  - Treemaps: sections and leaves as nested frames with name and value.
  - Railroad / grammar diagrams (railroad, EBNF, ABNF, PEG): terminals, non-terminals, specials, start/end markers, one group per rule.
  - Every other type (gantt, pie, mindmap, timeline, journey, kanban, gitGraph, C4, requirement, quadrant, xychart, sankey, …): semantic names, cards with a single label become frames.
- **Categorical theme palette** for light and dark (treemap, mindmap, timeline, journey, kanban, pie, gitGraph, xychart, venn, …) and readable railroad colors.
- **Developer test runner** (`plugin-dev/`, not published): inserts every fixture in light and dark into one Figma page and writes an audit the maintainers read back.
- Contrast audit (`pnpm test:colors`), exported-fixture viewBox check (`tests/export-fixtures.mjs`) and a mock Figma harness that runs the real plugin bundle in unit tests.
- "Report an issue" link and a privacy note in the About dialog.
- Contributor guide (`CONTRIBUTING.md`), Code of Conduct, security policy, GitHub issue templates (diagram conversion, bug, feature), PR template and a CI workflow (types, builds, stale-bundle check, tests).
- New brand icon set (favicon, PWA icons, logo lockups, plugin icon, social preview, community cover).

### Fixed
- ERD: duplicated markers, a table skipped when its name contained "edge", lost marker names, header color taken from a row stripe, text overflowing its cell.
- Light mode: connector lines were almost invisible (#e4e4e7 on white); now #71717a.
- Export: diagrams whose Mermaid viewBox does not start at 0 (treemap, timeline, kanban, mindmap) were cropped.
- Export: eventmodeling card labels (HTML `<foreignObject>`) were dropped; they are converted to editable text.
- Export: elements Mermaid hides (`display: none`, e.g. the treemap root value) showed up in Figma.
- Export: gantt milestones lost their diamond shape (CSS-only rotation is now written into the SVG).
- Export: journey section titles ("Go to work") came out in their section's own fill color and were invisible; they now use the label color the browser shows.
- Gantt: the chart width followed the window width (labels pushed outside their bars in the plugin); it is now a fixed 1200px.
- Plugin: inline label `<clipPath>`s landed as black boxes (treemap); the root frame now grows to fit its content instead of cropping.
- Plugin: Insert is disabled while the code has a syntax error, and "Added!" only appears after the canvas confirms the insert.

### Changed
- Fonts (Inter, JetBrains Mono) are self-hosted woff2 files; the web app and the plugin make no font network requests.

## 1.0.2

Initial public release: web app (Mermaid, DBML and SQL import, light/dark themes, SVG/PNG export, copy to Figma) and the Figma companion plugin with Auto Layout ERD tables.

