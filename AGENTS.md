## Product

**Mermapix** — Mermaid to Editable Figma. Paste Mermaid diagrams (ERD-first), DBML, or SQL schemas and get editable Figma vector layers with native Auto Layout, not flat images.

- Source of truth for roadmap, architectural rules, and phase checklist: [`plans/mermapix-plan.md`](plans/mermapix-plan.md). Read its "Agent Rules" section before any modifications.
- Work one phase per session and update the checklist in that file when done.
- Decision history: `plans/archive/`.

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
│   ├── App.tsx                     # Top-level state coordinator (code, theme, sidebar, modal)
│   ├── index.css                   # Global CSS, Tailwind v4 imports, design tokens, responsive styles
│   ├── vite-env.d.ts               # Vite client types (?raw imports)
│   ├── components/                 # UI components
│   │   ├── Toolbar.tsx             # Navbar: brand logo, theme toggle, export menu, Copy CTA
│   │   ├── EditorPanel.tsx         # Sidebar editor container with unified mobile/desktop toolbar
│   │   ├── CodeEditor.tsx          # Code editor with syntax highlighting, line numbers, error alerts
│   │   ├── Canvas.tsx              # Interactive pan/zoom canvas and floating zoom pill
│   │   ├── CanvasEmptyState.tsx    # 3-step onboarding card with sample loader
│   │   ├── ImportModal.tsx         # DBML & SQL schema import modal with table naming options
│   │   ├── AboutModal.tsx          # About dialog with open source licenses and disclaimers
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
│   │   └── presets.ts              # WCAG AAA theme variables (light/dark) and Mermaid initialization
│   ├── types/
│   │   └── index.ts                # Global type contracts (Theme, ZoomState, TableNaming)
│   ├── utils/
│   │   └── sanitize.ts             # AI markdown fence sanitizer
│   └── examples/                   # Built-in diagram templates (?raw imports)
│       ├── erd.mmd                 # Default e-commerce database schema
│       ├── flowchart.mmd           # Flowchart example with subgraphs
│       ├── sequence.mmd            # Authentication sequence diagram
│       ├── flowchart-sitemap.mmd   # Generic website sitemap diagram
│       └── index.ts                # Examples registry
├── plugin/                         # Companion Figma Plugin
│   ├── manifest.json               # Figma Plugin manifest (Figma Plugin API v1)
│   ├── src/                        # Plugin sandbox TypeScript modules (bundled to code.js)
│   │   ├── main.ts                 # Entry: figma.showUI + figma.ui.onmessage
│   │   ├── diagram.ts              # Shared fonts + createDiagramNode (prepareSvgForFigma -> createNodeFromSvg -> optimize); also used by plugin-dev
│   │   ├── optimize.ts             # optimizeDiagramNodes orchestrator + DIAGRAM_STEPS registry
│   │   ├── erd.ts                  # ERD entity detection + native Auto Layout table conversion
│   │   ├── cleanup.ts              # Purge, wrapper dissolve, sequence-number elevate, root unwrap, final naming
│   │   ├── markers.ts              # Pure SVG marker inliner (copy of src/export/markers.ts)
│   │   ├── svgPrep.ts              # Pure pre-import SVG prep: drop label-only clipPaths, inline-once + unique ids on marker groups
│   │   ├── treemap.ts              # Treemap sections/leaves -> nested frames (+ pure treemapGeometry.ts)
│   │   ├── railroad.ts             # Railroad grammars: terminal/non-terminal frames, Rule groups (+ pure railroadGeometry.ts)
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
│   ├── plugin-mock/                # In-memory mock Figma + synthetic ERD scene used by tests/unit/plugin-harness.test.mjs
│   ├── export-svg.mjs              # Headless Chrome regression runner via CDP
│   ├── fixtures/                   # Mermaid sample files for regression
│   ├── baseline/                   # Verified baseline SVG exports
│   ├── unit/                       # Converter & sanitizer unit tests (node --test)
│   └── README.md                   # Automated & manual Figma testing guidelines
├── plans/                          # Project plans and decision archives
│   ├── mermapix-plan.md            # Roadmap, phase checklist, and architectural rules
│   └── research-competitors.md     # Market and technical competitor research
├── package.json                    # Dependencies and scripts (build, dev, test:unit, test:export)
├── tsconfig.json                   # TypeScript configuration
├── vite.config.ts                  # Standard Vite config with React and Tailwind v4
└── LICENSE                         # MIT License
```

## Critical Invariants & Rules for Agents (DO NOT VIOLATE)

1. **Protect the SVG Export Pipeline**: `buildExportSvg` / `copyToFigma` in `src/export/svg.ts` and `htmlLabels: false` in `src/themes/presets.ts` are the core of the product. Never change the computed-style capture (`SVG_PRESENTATION_PROPERTIES`), the rewrite of every `<text>` into flat, absolutely positioned `<tspan>` rows (this is what makes Figma import editable text instead of outlines), or `htmlLabels: false`. Any other change to `svg.ts` needs the user's explicit approval for that specific bug and must be re-verified on every `tests/figma-fixtures/*.mmd` (`node tests/export-fixtures.mjs`). Approved so far (2026-11-06, see `plans/mermapix-plan.md` Phase 10): viewBox padding for any origin (`padViewBoxAxis`), `<foreignObject>` labels converted to `<text>` (`convertForeignObjectLabels`), elements Mermaid hides with `display:none` are dropped, CSS-only transforms baked into `transform=matrix()` (`bakeCssTransform`).
2. **Plugin Auto Layout Engine**: In `plugin/src/` (`optimize.ts`, `erd.ts`, `cleanup.ts`), preserve `optimizeDiagramNodes` which converts ERD tables into native vertical Auto Layout frames and dissolves redundant nested wrapper groups.
3. **Theme Synchronization**: The diagram appearance is directly synchronized with the UI theme (`light` and `dark`). Light mode renders clean neutral cards; dark mode renders midnight cyan cards.
4. **Mobile Layout Architecture**: Mobile uses a streamlined 2-row layout: Row 1 = Brand + compact theme/export/copy actions; Row 2 = Tab switcher + quick tool icons. Do not introduce a cluttered 3rd row.
5. **Static Assets**: All public-facing static assets (logos, favicon, og-image) reside in `public/` and are referenced from `/logo/...` or root. Assets used inside the Figma plugin UI (e.g. the logo icon) must instead be imported with `?inline` from `src/assets/`, because `plugin/ui.html` is a single file and `/logo/...` URLs do not resolve there.
6. **One Phase Per Session**: Work on one phase at a time per session and update the checklist in `plans/mermapix-plan.md`.
7. **Offline, no network**: the plugin declares `networkAccess: none` and the listing promises 100% offline. Never add a remote font, script, stylesheet or fetch. Fonts are self-hosted woff2 in `src/assets/fonts/` (inlined into the plugin UI by `assetsInlineLimit`); `scripts/build-plugin.mjs` also strips any remote CSS `@import` from the plugin build.
8. **Generated bundles are committed**: `plugin/code.js`, `plugin/ui.html`, `plugin-dev/code.js`, `plugin-dev/ui.html`. After changing `plugin/src/`, `src/export/`, `src/themes/`, `src/plugin/`, `src/index.css` or a fixture, run `pnpm build:plugin` and `pnpm build:test-runner` and commit the outputs, or Figma keeps running the old code.

## Dependencies

- Runtime: React 19 and React DOM 19
- Icons: `lucide-react`
- Diagram Engine: `mermaid` (^11.16.1)
- Styling: Tailwind CSS v4 with `@tailwindcss/vite`
- Tooling: Vite 8, TypeScript 5.7, Node 22+

## Code Quality

- Use double quotes for strings containing apostrophes (`"We're here to help"`), or escape them in single-quoted strings.
- Ensure JSX tags are properly closed and braces are balanced.
- Export components as default exports where appropriate.
- Run `npx tsc --noEmit` and `pnpm test:unit` after modifying code.
