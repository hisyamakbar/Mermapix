# Mermapix 🧜‍♂️✨

> **Mermaid to Editable Figma.**  
> Paste Mermaid diagrams (ERD-first), DBML, or SQL schemas and get native, editable Figma vector layers with clean Auto Layout — not a flat image.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Figma Plugin: 100% Offline](https://img.shields.io/badge/Figma_Plugin-100%25_Offline-10b981.svg)](plugin/manifest.json)
[![Tests: Passing](https://img.shields.io/badge/Tests-Passing-success.svg)](tests/)
[![Contrast: audited](https://img.shields.io/badge/Contrast-WCAG_AA_audited-cyan.svg)](tests/color-audit.mjs)
[![Version](https://img.shields.io/badge/version-1.1.0-ec4899.svg)](CHANGELOG.md)

---

## 🌟 What is Mermapix?

Most diagram converters export raster PNGs or flattened, non-editable SVGs where text is converted into messy outline paths. 

**Mermapix** is designed for software engineers, database architects, and product designers who want diagrams to look like real design system components in Figma. It provides:

1. **Web App (Flagship Zero-Install)**: Open in any browser, write Mermaid code or import SQL/DBML schemas, and copy SVG directly to your clipboard (`Cmd+V` in Figma).
2. **Figma Companion Plugin**: Run directly inside Figma Design or FigJam. Every Mermaid diagram lands as native Figma structure: shapes become frames with their border merged in, ERD tables and class boxes become **Auto Layout** frames, and every layer gets a meaningful name.

---

## ✨ Key Features

- 🏗️ **Native Auto Layout ERD Frames** *(Plugin)*: Converts database entities into vertical Auto Layout frames. Add or delete fields directly in Figma and the container card responds naturally.
- 🧩 **Native frames for every diagram type** *(Plugin)*: flowchart and sitemap nodes and subgraphs, sequence participants, notes and alt/loop blocks, class boxes, states, treemap sections and railroad boxes all become frames with fill + border merged; connectors are grouped as `Edge: A → B`. Gantt, pie, mindmap, timeline, journey, C4 and the rest keep their geometry with semantic layer names.
- 🧼 **Clean Layers (No Redundant Groups)**: Dissolves nested SVG wrapper groups so you can double-click and edit text instantly.
- 🗄️ **DBML & SQL Schema Import**: Instantly convert raw DBML or SQL `CREATE TABLE` definitions (Postgres/MySQL) into structured Mermaid ERD diagrams.
- 🎨 **Light & Dark Theme Sync**: Toggle between Light (clean neutral) and Dark (midnight cyan). A 12-color categorical palette gives treemaps, mindmaps, timelines, pies and git graphs distinct colors, and every theme is checked by an automated contrast audit (WCAG AA: text ≥ 4.5:1, lines ≥ 3:1).
- ⚡ **100% Offline & Private**: Zero network requests (`"allowedDomains": ["none"]`), fonts are self-hosted. Your proprietary database schemas and architecture designs never leave your local machine.
- 🔍 **Interactive Canvas & Auto-Fit**: Infinite dot-grid canvas with pan, zoom (10% to 500%), and automatic viewport centering whenever your diagram updates.

---

## 🚀 Getting Started

### Prerequisites
- Node.js 22+
- pnpm (`npm install -g pnpm`)

### Development
```bash
# 1. Clone repository
git clone https://github.com/hisyamakbar/mermapix.git
cd mermapix

# 2. Install dependencies
pnpm install

# 3. Start development server
pnpm dev
```
Open `http://localhost:8443` in your browser.

---

## 🛠️ Build & Test Commands

```bash
# Build web production bundle
pnpm build

# Build Figma Companion Plugin (bundles plugin/src/main.ts -> plugin/code.js and inlines UI -> plugin/ui.html)
pnpm build:plugin

# Build the developer-only Figma test runner (plugin-dev/, never published)
pnpm build:test-runner

# Unit tests: converters, export helpers, and the real plugin bundle in a mock Figma
pnpm test:unit

# Headless Chrome SVG export regression test (dev server must be running)
pnpm test:export

# Contrast audit of every fixture in light + dark (dev server must be running)
pnpm test:colors

# Export every fixture and check nothing falls outside its viewBox
node tests/export-fixtures.mjs --out tests/output/fixtures
```

After changing `plugin/src/`, `src/export/`, `src/themes/`, `src/plugin/` or `src/index.css`, rebuild and commit `plugin/` and `plugin-dev/` outputs: Figma runs the committed bundles.

---

## 🔌 Running the Figma Plugin Locally

1. Open **Figma Desktop**.
2. Right click on any canvas > **Plugins** > **Development** > **Import plugin from manifest...**.
3. Select `plugin/manifest.json`.
4. Click **Run** or open `plugin/PUBLISHING_GUIDE.md` for full Figma Community publishing instructions.

**Regression pass in real Figma**: import `plugin-dev/manifest.json` (Mermapix Test Runner, developer only) and click **Run all**. It inserts every `tests/figma-fixtures/*.mmd` in light and dark on a new page and stores an audit you can read back with `tests/figma-read-audit.js` (see `tests/README.md`).

---

## 🐛 Support, Issues & Contributing

- Found a diagram that does not convert cleanly? [Open an issue](https://github.com/hisyamakbar/Mermapix/issues) with the Mermaid code, the theme (light/dark) and a screenshot of the Figma result.
- Pull requests are welcome. Please read [`AGENTS.md`](AGENTS.md) first (architecture and the rules that keep the export pipeline intact), add the failing case as a fixture in `tests/figma-fixtures/`, and run `pnpm test:unit`.
- Release notes: [`CHANGELOG.md`](CHANGELOG.md).

**Privacy**: Mermapix collects no data. Diagrams are rendered and converted locally, in your browser or inside Figma.

---

## ⚖️ License & Open Source

This project is open-source software licensed under the **[MIT License](LICENSE)**.  
Copyright (c) 2026 **Hisyam Akbar**.

You are free to use, modify, distribute, and build upon this software for personal and commercial purposes under the terms of the MIT License.

---

## 📢 Legal & Trademark Disclaimers

- **Figma**: *Figma* and the Figma logo are registered trademarks of Figma, Inc. Mermapix is an independent open-source tool and is not affiliated with, endorsed by, or sponsored by Figma, Inc.
- **Mermaid**: *Mermaid* is an open-source diagramming and charting tool created by Knut Sveidqvist and maintained by the Mermaid community. Mermapix is an independent project and is not officially affiliated with Mermaid-js.
- **Warranty**: This software is provided "AS IS", without warranty of any kind, express or implied. Please review the [LICENSE](LICENSE) for the complete disclaimer of liability.

---

## 💖 Acknowledgments & Third-Party Notices

Mermapix is built upon exceptional open-source projects:
- [Mermaid.js](https://github.com/mermaid-js/mermaid) by Knut Sveidqvist (MIT)
- [React](https://react.dev) by Meta Platforms, Inc. (MIT)
- [Lucide Icons](https://lucide.dev) by Lucide Contributors (ISC)
- [Tailwind CSS](https://tailwindcss.com) by Tailwind Labs, Inc. (MIT)
- [Vite](https://vite.dev) by Evan You and Vite Contributors (MIT)
- [Inter](https://rsms.me/inter/) by The Inter Project Authors and [JetBrains Mono](https://www.jetbrains.com/lp/mono/) by JetBrains (SIL OFL 1.1, self-hosted)

Detailed licenses and copyright notices for third-party dependencies are compiled in **[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)**.
