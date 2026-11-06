# Changelog

All notable changes to Mermapix are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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

