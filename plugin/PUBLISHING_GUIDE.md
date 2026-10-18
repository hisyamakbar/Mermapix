# Mermapix: Figma Community Publishing Guide

A comprehensive, step-by-step guide for publishing the **Mermapix: Mermaid to Editable Figma** plugin to the Figma Community in full compliance with the [Figma Plugin and Widget Review Guidelines](https://help.figma.com/hc/en-us/articles/360039958914-Plugin-and-widget-review-guidelines).

---

## 1. Plugin Readiness (Pre-Flight Checklist)

- [x] **100% Offline & Zero Network Requests**: `manifest.json` specifies `"networkAccess": { "allowedDomains": ["none"] }`. All runtime dependencies (Mermaid, React, Lucide Icons, inline vector logos) are bundled into a single standalone file (`plugin/ui.html`). No external scripts, fonts, or CDNs are requested at runtime.
- [x] **Native Auto Layout Engine**: Converts ERD entity tables directly into vertical Figma Auto Layout frames (`layoutMode: 'VERTICAL'`) with 8px corner radiuses, uniform padding, and direct editable text layers.
- [x] **Clean Layers (No Redundant Groups)**: The optimizer dissolves intermediate wrapper groups so users can double-click and edit text immediately without deep drilling.
- [x] **Figma Trademark Compliance**: The listing title is **"Mermapix: Mermaid to Editable Figma"** (brand name "Mermapix" is leading, never prefixed with "Figma"). Logos and iconography are original and do not mimic official Figma brand assets.
- [x] **Visual Assets Prepared**:
  - Icon: `plugin/assets/icon-128.png` (128x128 px, PNG format)
  - Cover Banner: `plugin/assets/cover-1920x1080.png` (1920x1080 px, 16:9 PNG format)
- [x] **Multi-Editor Support**: Ready for both **Figma Design** and **FigJam** (`"editorType": ["figma", "figjam"]`).

---

## 2. Building & Synchronizing the Plugin

Before publishing or testing the latest changes, compile the production plugin bundle:

```bash
# Build sandbox backend (code.ts -> code.js) and frontend UI (Vite -> plugin/ui.html)
pnpm build:plugin
```

Verify that the following files are present and up to date:
- `plugin/manifest.json`
- `plugin/code.js`
- `plugin/ui.html`
- `plugin/assets/icon-128.png`
- `plugin/assets/cover-1920x1080.png`

---

## 3. Local Testing in Figma Desktop

1. Open the **Figma Desktop** application.
2. Open any design file or create a new blank canvas.
3. Right-click on the canvas or open the top menu:  
   **Plugins** > **Development** > **Import plugin from manifest...**
4. Select the manifest file:  
   `plugin/manifest.json`
5. **Mermapix** will now appear in your *Development Plugins* list.
6. Click **Mermapix** to run.
7. Test core functionality:
   - Select example diagrams from the **Examples** menu (ERD, Flowchart, Sequence).
   - Click **Insert to Canvas**: confirm the diagram is centered in your current Figma viewport.
   - Click an ERD table in Figma: verify in the right-hand properties panel that it is a native **Auto Layout Frame (Vertical)** and field labels can be edited directly with a double-click.
   - Switch between **Light / Dark** modes and test **Import Schema (DBML / SQL)**.

---

## 4. Figma Community Publishing Form (Copy-Paste Ready)

Click the **"..."** menu next to the plugin name in the Development menu, then select **"Publish..."**. Complete the submission dialog using these fields:

### Name
```text
Mermapix: Mermaid to Editable Figma
```

### Tagline / Subtitle (Maximum 100 characters)
```text
Convert Mermaid ERDs, DBML, and SQL into clean, native Auto Layout Figma frames.
```

### Icon
- Click upload on the Icon field and choose:  
  `plugin/assets/icon-128.png` (128x128 PNG)

### Cover Art / Banner
- Click upload on the Cover Image field and choose:  
  `plugin/assets/cover-1920x1080.png` (1920x1080 PNG)

### Description (Copy and paste the markdown below)
```markdown
🚀 **Mermapix** transforms Mermaid diagrams, DBML, and SQL schemas into clean, editable vector layers and native Auto Layout frames in Figma and FigJam.

Unlike standard converters that flatten diagrams into non-editable raster images or messy nested groups, Mermapix generates structured Figma components tailored for designers and software engineers.

---

### ✨ Key Features

- 🏗️ **Native Auto Layout ERD Frames**: Tables and entities are converted directly into vertical Auto Layout frames. Add or remove fields and the container card responds automatically!
- 🧼 **Clean Layers (Zero Group Clutter)**: Redundant wrapper groups are dissolved so you can double-click and edit text instantly.
- 🗄️ **DBML & SQL Schema Import**: Paste raw DBML or SQL `CREATE TABLE` definitions (Postgres/MySQL) and convert them directly to Mermaid ERDs.
- 🎨 **Light & Dark Theme Sync**: Fully WCAG AAA compliant contrast presets for clean light documentation or midnight cyan presentations.
- ⚡ **100% Offline & Private**: Zero network requests (`allowedDomains: ["none"]`). Your proprietary database schemas never leave your machine.
- 🧩 **FigJam & Figma Design**: Seamlessly insert diagrams into design files or whiteboards.

---

### 📖 Supported Diagrams

1. **Entity Relationship Diagrams (ERD)**: Primary keys, foreign keys, types, and cardinality relationships.
2. **Flowcharts**: Subgraphs, decision nodes, and directed arrows.
3. **Sequence Diagrams**: Actors, participants, sync/async messages, and activation boxes.
4. **Sitemaps & Architecture Diagrams**: Clean tree structures for UX architecture.

---

### 🔒 Privacy & Security
Mermapix runs completely locally in your Figma client. It does not send analytics, telemetry, or diagrams to any external server.

---

### ⚖️ Legal & Trademark Disclaimers
- Figma is a registered trademark of Figma, Inc. Mermapix is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Figma, Inc.
- Mermaid is an open-source diagramming library created by Knut Sveidqvist and maintained by the Mermaid community.
- Mermapix is open-source software licensed under the MIT License by Hisyam Akbar.
```

### Tags (Up to 12 tags)
`mermaid`, `erd`, `database`, `auto-layout`, `sql`, `dbml`, `flowchart`, `sequence`, `diagram`, `architecture`, `developer-tools`

### Categories
- Primary: **Development**
- Secondary: **Diagramming** (or **Utilities**)

---

## 5. Security & Network Disclosure Questionnaire

Figma reviewers require answers to safety and compliance questions during submission:

| Reviewer Question | Recommended Response | Context & Rationale |
| :--- | :--- | :--- |
| **Does this plugin access external network resources?** | **No** | The plugin configures `"networkAccess": { "allowedDomains": ["none"] }`. All logic and assets are bundled locally into `plugin/ui.html`. |
| **Does this plugin collect or store user data?** | **No** | Zero telemetry, analytics, or user diagram content is stored or transmitted. |
| **Does this plugin use third-party code through `<script src="...">`?** | **No** | All dependencies (Mermaid, React) are bundled statically at compile-time via Vite. |
| **Does this plugin access Figma document content outside the active selection/page?** | **No** | The plugin only creates nodes on the current active page (`documentAccess: "dynamic-page"`). |
| **Is the plugin free or paid?** | **Free** | The plugin is completely free and open source. |

---

## 6. Review Approval Checklist

1. **Trademark Safety**:
   - The plugin name does not start with "Figma" (e.g., NOT "Figma Mermaid").
   - Descriptions use approved phrasing ("in Figma", "into Figma").
2. **Quality of Execution**:
   - Diagrams are inserted centered within the user's viewport without cluttering the canvas.
   - Text layers remain genuine Figma editable text nodes (`figma.createTextAsync()`), not rasterized paths.
3. **User-Friendly Error Handling**:
   - Mermaid syntax issues display clear line numbers inside the editor and prevent corrupted nodes from inserting into the document.
4. **Memory Performance**:
   - Configures `documentAccess: "dynamic-page"` to prevent loading entire multi-page documents into memory.

---

Happy publishing to Figma Community! 🎉
