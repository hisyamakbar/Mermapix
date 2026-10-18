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
│   │   └── mermaidHighlighter.ts   # Syntax token parser for Mermaid code
│   ├── converters/                 # Schema to Mermaid ERD parsers
│   │   ├── dbml.ts                 # DBML parser (tables, columns, types, keys, refs)
│   │   ├── sql.ts                  # SQL CREATE TABLE parser (Postgres/MySQL subset)
│   │   ├── utils.ts                # Table naming transforms and Mermaid ERD serializer
│   │   ├── types.ts                # AST definitions for schemas, tables, and relations
│   │   └── index.ts                # Converter barrel export
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
│   ├── code.ts / code.js           # Plugin sandbox script with native Auto Layout engine
│   ├── ui.html                     # Standalone bundled plugin dialog UI
│   ├── assets/                     # Publishing visual assets (icon-128.png, cover-1920x1080.png)
│   └── PUBLISHING_GUIDE.md         # Official community publishing checklist and form
├── public/                         # Static assets served at root
│   ├── favicon.svg                 # SVG favicon
│   ├── og-image.jpg                # OpenGraph social preview image
│   └── logo/                       # Brand logo vectors (light, dark, icon)
├── tests/                          # Test harness & fixtures
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

1. **Protect the SVG Export Pipeline**: Never modify `buildExportSvg`, `copyToFigma`, or presentation properties in `src/export/svg.ts`, nor `htmlLabels: false` in `src/themes/presets.ts`. This pipeline ensures text nodes export with absolute `<tspan>` positioning so Figma renders editable text layers rather than flat outlines.
2. **Plugin Auto Layout Engine**: In `plugin/code.ts`, preserve `optimizeDiagramNodes` which converts ERD tables into native vertical Auto Layout frames and dissolves redundant nested wrapper groups.
3. **Theme Synchronization**: The diagram appearance is directly synchronized with the UI theme (`light` and `dark`). Light mode renders clean neutral cards; dark mode renders midnight cyan cards.
4. **Mobile Layout Architecture**: Mobile uses a streamlined 2-row layout: Row 1 = Brand + compact theme/export/copy actions; Row 2 = Tab switcher + quick tool icons. Do not introduce a cluttered 3rd row.
5. **Static Assets**: All public-facing static assets (logos, favicon, og-image) reside in `public/` and are referenced from `/logo/...` or root.
6. **One Phase Per Session**: Work on one phase at a time per session and update the checklist in `plans/mermapix-plan.md`.

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
