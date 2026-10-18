# Mermapix 🧜‍♂️✨

> **Mermaid to Editable Figma.**  
> Paste Mermaid diagrams (ERD-first), DBML, or SQL schemas and get native, editable Figma vector layers with clean Auto Layout — not a flat image.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Figma Plugin: 100% Offline](https://img.shields.io/badge/Figma_Plugin-100%25_Offline-10b981.svg)](plugin/manifest.json)
[![Tests: Passing](https://img.shields.io/badge/Tests-Passing-success.svg)](tests/)
[![WCAG AAA: 10.5--17.5:1](https://img.shields.io/badge/WCAG_AAA-10.5--17.5:1-cyan.svg)](src/themes/presets.ts)

---

## 🌟 What is Mermapix?

Most diagram converters export raster PNGs or flattened, non-editable SVGs where text is converted into messy outline paths. 

**Mermapix** is designed for software engineers, database architects, and product designers who want diagrams to look like real design system components in Figma. It provides:

1. **Web App (Flagship Zero-Install)**: Open in any browser, write Mermaid code or import SQL/DBML schemas, and copy SVG directly to your clipboard (`Cmd+V` in Figma).
2. **Figma Companion Plugin**: Run directly inside Figma Design or FigJam to generate native vertical **Auto Layout** frames for ERD tables and clean up nested layer hierarchies automatically.

---

## ✨ Key Features

- 🏗️ **Native Auto Layout ERD Frames** *(Plugin)*: Converts database entities into vertical Auto Layout frames. Add or delete fields directly in Figma and the container card responds naturally.
- 🧼 **Clean Layers (No Redundant Groups)**: Dissolves nested SVG wrapper groups so you can double-click and edit text instantly.
- 🗄️ **DBML & SQL Schema Import**: Instantly convert raw DBML or SQL `CREATE TABLE` definitions (Postgres/MySQL) into structured Mermaid ERD diagrams.
- 🎨 **WCAG AAA Theme Synchronization**: Seamlessly toggle between Light (clean neutral) and Dark (midnight cyan) modes. Diagram aesthetics update synchronously with the app interface.
- ⚡ **100% Offline & Private**: Zero network requests (`"allowedDomains": ["none"]`). Your proprietary database schemas and architecture designs never leave your local machine.
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

# Build Figma Companion Plugin (compiles code.ts -> code.js and inlines UI -> plugin/ui.html)
pnpm build:plugin

# Run unit tests (converters, sanitize, table naming)
pnpm test:unit

# Run headless Chrome SVG export regression test
pnpm test:export
```

---

## 🔌 Running the Figma Plugin Locally

1. Open **Figma Desktop**.
2. Right click on any canvas > **Plugins** > **Development** > **Import plugin from manifest...**.
3. Select `plugin/manifest.json`.
4. Click **Run** or open `plugin/PUBLISHING_GUIDE.md` for full Figma Community publishing instructions.

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

Detailed licenses and copyright notices for third-party dependencies are compiled in **[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)**.
