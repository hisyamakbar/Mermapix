## Product

**Mermapix** — Mermaid to Editable Figma. Paste Mermaid diagrams (ERD-first), DBML, or SQL schemas and get editable Figma vector layers with native Auto Layout, not flat images.

- Maintainers keep the roadmap, phase checklist and decision history in `plans/mermapix-plan.md` (+ `plans/archive/`). `plans/` is maintainer-local and not part of the public repository; when it exists, read its "Agent Rules" section before any modifications and update its checklist when a phase is done.
- Contributors without `plans/`: this file, [`tests/README.md`](tests/README.md) and [`CHANGELOG.md`](CHANGELOG.md) describe the architecture, the test harness and what changed. [`docs/source-linked-diagrams.md`](docs/source-linked-diagrams.md) describes how an inserted diagram stays linked to its Mermaid code (edit after insert, update in place, canvas edits applied back to the code).

---

# Mermapix: System Architecture & Agent Guide

React 19 + Vite 8 + Tailwind CSS v4 standalone web application and companion Figma Plugin.

## Development Server

A Vite development server runs on `$PORT` (default 8443).

- Preview URL: Access the running app at `http://localhost:8443`.
- Hot reload: Changes to source files are reflected immediately.

## Project Structure

This is the canonical project structure. Start with task-relevant files below.

```
Mermapix/
├── src/
│   ├── main.tsx                    # React entrypoint mounting into #root
│   ├── web.css                     # Web app only (imported by main.tsx, not by the plugin UI): hides the shared onboarding card behind the web one
│   ├── App.tsx                     # Top-level state coordinator (code, theme, sidebar, modal)
│   ├── index.css                   # Global CSS, Tailwind v4 imports, design tokens, responsive styles (shared with the plugin UI)
│   ├── links.ts                    # FIGMA_PLUGIN_URL (Figma Community listing)
│   ├── vite-env.d.ts               # Vite client types (?raw imports)
│   ├── components/                 # UI components
│   │   ├── Toolbar.tsx             # Navbar shared by web and plugin: brand logo, theme toggle, export (hidden in the plugin: `showExport`), primary action: plugin = Insert / Update with its states (`primaryActionDisabled`), web = red "Open in Figma" link to the Community plugin (`primaryActionHref`)
│   │   ├── FigmaIcon.tsx           # Lucide-style Figma mono-outline icon (lucide ISC); used only to refer to Figma (web toolbar link, onboarding step, About link)
│   │   ├── EditorPanel.tsx         # Sidebar editor container with unified mobile/desktop toolbar
│   │   ├── CodeEditor.tsx          # Code editor with syntax highlighting, line numbers, error alerts
│   │   ├── Canvas.tsx              # Interactive pan/zoom canvas and floating zoom pill
│   │   ├── CanvasEmptyState.tsx    # 3-step onboarding card with sample loader; `variant` "web" (step 3 links to the Community plugin) or "plugin" (step 3 describes Insert)
│   │   ├── WebEmptyState.tsx       # Web-only onboarding card (rule 8 fork of CanvasEmptyState, portaled into the canvas by App.tsx): general title, step 3 = Export (SVG/PNG, plugin link); fold back at the next plugin release
│   │   ├── ImportModal.tsx         # DBML & SQL schema import modal with table naming options
│   │   ├── AboutModal.tsx          # About dialog with open source licenses and disclaimers; `showPluginLink` (web only) adds the Figma Community link
│   │   ├── MermapixLogo.tsx        # Brand lockup: inline SVG (icon as ?inline WebP data URL + wordmark paths)
│   │   └── mermaidHighlighter.ts   # Syntax token parser for Mermaid code
│   ├── converters/                 # Schema to Mermaid ERD parsers
│   │   ├── dbml.ts                 # DBML parser (tables, columns, types, keys, refs)
│   │   ├── sql.ts                  # SQL CREATE TABLE parser (Postgres/MySQL subset)
│   │   ├── utils.ts                # Table naming transforms and Mermaid ERD serializer
│   │   ├── types.ts                # AST definitions for schemas, tables, and relations
│   │   └── index.ts                # Converter barrel export
│   ├── assets/
│   │   ├── mermapix-icon-96.webp   # 96px brand icon, inlined as base64 so it works in the single-file plugin UI
│   │   └── fonts/                  # Self-hosted Inter + JetBrains Mono woff2 (SIL OFL), no Google Fonts request
│   ├── export/
│   │   └── svg.ts                  # SVG normalization, foreignObject removal, Figma layer preparation
│   ├── hooks/
│   │   └── useCanvasZoom.ts        # Canvas zoom/pan gesture handlers and fit-to-view math
│   ├── themes/
│   │   └── presets.ts              # Theme variables (light/dark, contrast-audited), categorical palette, railroad colors, Mermaid initialization
│   ├── types/
│   │   └── index.ts                # Global type contracts (Theme, ZoomState, TableNaming)
│   ├── plugin/                     # Figma plugin UI (built into plugin/ui.html)
│   │   ├── index.html / main.tsx   # Plugin UI entry
│   │   ├── AppPlugin.tsx           # Plugin app: editor, preview, insert, edit mode for source-linked diagrams (live update queue, automatic apply)
│   │   ├── plugin-window.css       # Plugin-only: html/body/#root/app root fill the iframe and never scroll (Windows page scrollbar); imported by main.tsx, not by the web app
│   │   ├── SourceLinkStrip.tsx     # Contextual strip: "Diagram selected", "Editing: ..." with Live switch and Revert, Save (✕ Close in a component instance), apply result with Undo, Save confirmations
│   │   ├── sourcePatch.ts          # Pure: applyTextChanges, writes text edited on the canvas back into Mermaid code
│   │   ├── changeSummary.ts        # Pure: pendingEdits (canvas edits restated against the current code), wording of the apply result and the update confirmation
│   │   ├── liveSync.ts             # Pure: live update rules (when an update is due, slow detection, Live switch, editor hint)
│   │   ├── figmaTheme.ts           # Pure: Figma's theme from the `figma-light`/`figma-dark` class on <html>, which theme wins (open, Figma switch, edit mode)
│   │   └── diagramName.ts          # Pure: layer name of a new diagram, from its code (frontmatter title, title directive, accTitle, diagram type)
│   ├── utils/
│   │   ├── sanitize.ts             # AI markdown fence sanitizer
│   │   └── diagramSupport.ts       # Pure: Mermaid diagram ids and keywords Mermapix converts, the "not supported" list (ZenUML), the message for a render error
│   └── examples/                   # Built-in diagram templates (?raw imports)
│       ├── erd.mmd                 # Default e-commerce database schema
│       ├── flowchart.mmd           # Flowchart example with subgraphs
│       ├── sequence.mmd            # Authentication sequence diagram
│       ├── flowchart-sitemap.mmd   # Generic website sitemap diagram
│       └── index.ts                # Examples registry
├── plugin/                         # Companion Figma Plugin
│   ├── manifest.json               # Figma Plugin manifest (Figma Plugin API v1; relaunch button "Edit diagram")
│   ├── src/                        # Plugin sandbox TypeScript modules (bundled to code.js)
│   │   ├── main.ts                 # Entry: figma.showUI + message handlers (insert, selection, watch/inspect, update in place, live updates)
│   │   ├── protocol.ts             # Types only: UI <-> sandbox messages, LinkedDiagram, TextContext, DiagramChanges
│   │   ├── sourceLink.ts           # Pure: store/find the Mermaid source on the diagram root, fingerprint, editability
│   │   ├── snapshot.ts             # Pure: per-layer stamps, text context (ERD row/column, node id), diagramChanges
│   │   ├── update.ts               # Pure: transplantDiagram, swaps a root's content in place (root node is kept)
│   │   ├── diagram.ts              # Shared fonts + createDiagramNode (prepareSvgForFigma -> createNodeFromSvg -> optimize); also used by plugin-dev
│   │   ├── optimize.ts             # optimizeDiagramNodes orchestrator + DIAGRAM_STEPS registry
│   │   ├── erd.ts                  # ERD entity detection + native Auto Layout table conversion
│   │   ├── cleanup.ts              # Purge, wrapper dissolve, sequence-number elevate, root unwrap, final naming
│   │   ├── markers.ts              # Pure SVG marker inliner (copy of src/export/markers.ts)
│   │   ├── svgPrep.ts              # Pure pre-import SVG prep: drop label-only clipPaths, inline-once + unique ids on marker groups
│   │   ├── treemap.ts              # Treemap sections/leaves -> nested frames (+ pure treemapGeometry.ts)
│   │   ├── railroad.ts             # Railroad grammars: terminal/non-terminal frames, Rule groups (+ pure railroadGeometry.ts)
│   │   ├── usecase.ts              # Use case: Actor units, Use Case frames, boundary/package containers, relations (+ pure usecaseGeometry.ts)
│   │   ├── agentflow.ts            # Agentflow: Flow containers, nodes named by kind, sequence/reference/failure edges (+ pure agentflowGeometry.ts)
│   │   ├── naming.ts               # Pure helpers: ERD entity matcher, marker kind/layer names, connector/shape patterns
│   │   ├── erdPaints.ts            # Pure per-part ERD fill/border extraction (header, rows, border)
│   │   ├── erdLayout.ts            # Pure ERD column-width planner
│   │   ├── theme.ts                # Theme presets + color parsing
│   │   └── globals.d.ts            # Ambient `figma` / `__html__` typings (any)
│   ├── code.js                     # Generated by `pnpm build:plugin` (IIFE bundle of src/, committed, do not edit)
│   ├── ui.html                     # Standalone bundled plugin dialog UI
│   ├── assets/                     # Publishing visual assets (icon-128.png, cover-1920x1080.png)
│   └── PUBLISHING_GUIDE.md         # Official community publishing checklist and form
├── plugin-dev/                     # Developer-only Figma plugin "Mermapix Test Runner" (not published; `pnpm build:test-runner`)
│   ├── manifest.json               # Own manifest/id (mermapix-test-runner-dev)
│   ├── src/                        # main.ts sandbox, auditCore.js (shared audit), gridLayout.ts, protocol.ts, ui/ (React UI)
│   └── code.js / ui.html           # Generated, committed (import plugin-dev/manifest.json in Figma Desktop)
├── public/                         # Static assets served at root
│   ├── favicon.ico                 # 16/32/48 favicon (PNG-compressed entries)
│   ├── favicon-32.png              # PNG favicon
│   ├── apple-touch-icon.png        # 180x180 opaque iOS home-screen icon (squircle on brand pink)
│   ├── icon-192.png / icon-512.png # PWA/manifest icons
│   ├── site.webmanifest            # Web app manifest (theme/background #090d16)
│   ├── og-image.jpg                # OpenGraph social preview image (1200x630)
│   └── logo/                       # mermapix-icon.png (256px) + light/dark wordmark lockup SVGs (embedded WebP icon)
├── tests/                          # Test harness & fixtures
│   ├── plugin-mock/                # In-memory mock Figma + synthetic ERD scene used by tests/unit/plugin-harness.test.mjs; session.mjs runs several messages (insert, select, update) against one plugin start
│   ├── export-svg.mjs              # Headless Chrome regression runner via CDP
│   ├── fixtures/                   # Mermaid sample files for regression
│   ├── figma-fixtures/             # One or more .mmd per diagram type, exported by export-fixtures.mjs and inserted by the Test Runner
│   ├── official-samples/           # Mermaid's own sample diagrams (@mermaid-js/examples), refreshed by scripts/refresh-official-samples.mjs
│   ├── baseline/                   # Verified baseline SVG exports
│   ├── unit/                       # Converter & sanitizer unit tests (node --test)
│   └── README.md                   # Automated & manual Figma testing guidelines
├── docs/
│   └── source-linked-diagrams.md   # Edit after insert: stored data format, update in place, change detection, write-back rules
├── plans/                          # Project plans and decision archives
│   ├── mermapix-plan.md            # Roadmap, phase checklist, and architectural rules
│   └── research-competitors.md     # Market and technical competitor research
├── package.json                    # Dependencies, version and scripts (build, build:plugin, build:test-runner, test:unit, test:export, test:colors)
├── CHANGELOG.md                    # Release notes
├── CONTRIBUTING.md                 # Contributor guide (setup, pipeline rules, fixture workflow)
├── CODE_OF_CONDUCT.md / SECURITY.md # Contributor Covenant 2.1, private vulnerability reporting
├── .github/                        # Issue templates (diagram conversion, bug, feature), PR template, CI workflow
├── tsconfig.json                   # TypeScript configuration
├── vite.config.ts                  # Standard Vite config with React and Tailwind v4
└── LICENSE                         # MIT License
```

## Critical Invariants & Rules for Agents (DO NOT VIOLATE)

1. **Protect the SVG Export Pipeline**: `buildExportSvg` / `copyToFigma` in `src/export/svg.ts` and `htmlLabels: false` in `src/themes/presets.ts` are the core of the product. Never change the computed-style capture (`SVG_PRESENTATION_PROPERTIES`), the rewrite of every `<text>` into flat, absolutely positioned `<tspan>` rows (this is what makes Figma import editable text instead of outlines), or `htmlLabels: false`. Any other change to `svg.ts` needs the user's explicit approval for that specific bug and must be re-verified on every `tests/figma-fixtures/*.mmd` (`node tests/export-fixtures.mjs`). Approved so far (2026-11-06, see `plans/mermapix-plan.md` Phase 10): viewBox padding for any origin (`padViewBoxAxis`), `<foreignObject>` labels converted to `<text>` (`convertForeignObjectLabels`), elements Mermaid hides with `display:none` are dropped, CSS-only transforms baked into `transform=matrix()` (`bakeCssTransform`), `<switch>` text fallbacks take the color of the HTML label they replace (`switchSiblingTextColor`, journey).
2. **Plugin Auto Layout Engine**: In `plugin/src/` (`optimize.ts`, `erd.ts`, `cleanup.ts`), preserve `optimizeDiagramNodes` which converts ERD tables into native vertical Auto Layout frames and dissolves redundant nested wrapper groups.
3. **Theme Synchronization**: The diagram appearance is directly synchronized with the UI theme (`light` and `dark`). Light mode renders clean neutral cards; dark mode renders midnight cyan cards. In the plugin the default follows Figma's theme (`themeColors: true` in `figma.showUI`, class `figma-light`/`figma-dark` on `<html>`, `src/plugin/figmaTheme.ts`); the toggle is per session and the theme is not stored. While a linked diagram is edited, its own stored theme stays in force.
4. **Mobile Layout Architecture**: Mobile uses a streamlined 2-row layout: Row 1 = Brand + compact theme/export/copy actions; Row 2 = Tab switcher + quick tool icons. Do not introduce a cluttered 3rd row.
5. **Static Assets**: All public-facing static assets (logos, favicon, og-image) reside in `public/` and are referenced from `/logo/...` or root. Assets used inside the Figma plugin UI (e.g. the logo icon) must instead be imported with `?inline` from `src/assets/`, because `plugin/ui.html` is a single file and `/logo/...` URLs do not resolve there.
6. **One Phase Per Session**: Work on one phase at a time per session and update the checklist in `plans/mermapix-plan.md`.
7. **Offline, no network**: the plugin declares `networkAccess: none` and the listing promises 100% offline. Never add a remote font, script, stylesheet or fetch. Fonts are self-hosted woff2 in `src/assets/fonts/` (inlined into the plugin UI by `assetsInlineLimit`); `scripts/build-plugin.mjs` also strips any remote CSS `@import` from the plugin build.
8. **Web-only changes between plugin releases must not change the plugin bundle**: the plugin UI imports the shared components (`Toolbar`, `Canvas`, `CanvasEmptyState`, `EditorPanel`, `AboutModal`, ...) and `src/index.css`. While a plugin release is published, a change meant only for the web app goes into `App.tsx`, a prop of the shared component, or a web-only file, so `pnpm build:plugin` stays byte-identical. Once the plugin is released, fold any such fork back into the shared component.
9. **Generated bundles are committed**: `plugin/code.js`, `plugin/ui.html`, `plugin-dev/code.js`, `plugin-dev/ui.html`. After changing `plugin/src/`, `src/export/`, `src/themes/`, `src/plugin/`, `src/index.css` or a fixture, run `pnpm build:plugin` and `pnpm build:test-runner` and commit the outputs, or Figma keeps running the old code.
10. **Source-linked diagrams** (see `docs/source-linked-diagrams.md`):
   - The stored format is permanent. `mermapix:diagram` (`{ v: 1, source, theme, type }`) lives in users' Figma files; later builds must keep reading `v: 1`. Add a new version, never redefine one.
   - An update keeps the root node (`transplantDiagram`): never replace it with a new node, or position, layer order and component instances are lost.
   - An update is transactional: build the new diagram completely before touching the target, and ask before replacing a diagram that was changed in Figma.
   - `src/plugin/sourcePatch.ts` stays conservative: apply a canvas text edit only when its place in the code is certain, report the rest as unresolved, never choose by order of occurrence.
   - The UI and the sandbox change together through `plugin/src/protocol.ts`; a new message or field goes there first.
   - The editor draft is never overwritten without a user action, and is not persisted while a linked diagram is being edited. Inside edit mode the code belongs to the diagram: canvas text edits are written into it (with Undo); the remembered draft is never touched.
   - Live update never replaces changes made in Figma: a live (`quiet`) update that meets `update-needs-confirm` pauses live update until the user clicks Update. A code change that came from the canvas never triggers a live update. One update in flight at a time, always built from a preview of exactly the editor's code.
   - Finishing edit mode (Save) never drops typed code: it updates the diagram first, asks before replacing Figma edits, and asks before leaving with code that cannot be rendered.
11. **Mermaid defaults are pinned** (`initMermaid` in `src/themes/presets.ts`): `look: 'classic'` globally and `layout: 'dagre'` per type for flowchart, state, class, er and requirement, plus the 11.x node sizing. Mermaid 12 defaults to ELK and the `neo` look; the plugin converters, the fixtures and the themes are built on the pinned values. Never set `layout` globally (mindmap and swimlane choose their own). Styles Mermaid offers no theme variable for go into `themeCss()` in `presets.ts`, or into `src/index.css` for renderers that drop Mermaid's `<style>` (wardley).
12. **Every Mermaid diagram type is accounted for**: `src/utils/diagramSupport.ts` lists the types Mermapix converts and the ones it refuses; `tests/unit/diagram-coverage.test.mjs` fails when the installed Mermaid registers a type in neither list or a supported type has no fixture. After a Mermaid upgrade, also run `node tests/export-fixtures.mjs` on `tests/figma-fixtures` and `tests/official-samples` and regenerate `tests/fixtures/plugin/` (see `tests/README.md`).

## Dependencies

- Runtime: React 19 and React DOM 19
- Icons: `lucide-react`
- Diagram Engine: `mermaid` (^12.3.0)
- Styling: Tailwind CSS v4 with `@tailwindcss/vite`
- Tooling: Vite 8, TypeScript 5.7, Node 22+

## Code Quality

- Use double quotes for strings containing apostrophes (`"We're here to help"`), or escape them in single-quoted strings.
- Ensure JSX tags are properly closed and braces are balanced.
- Export components as default exports where appropriate.
- Run `npx tsc --noEmit` and `pnpm test:unit` after modifying code.
