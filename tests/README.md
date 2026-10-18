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
