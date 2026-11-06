# Contributing to Mermapix

Thanks for helping make Mermaid diagrams land cleanly in Figma! Bug reports, diagram cases that convert badly, docs fixes and pull requests are all welcome.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a diagram that does not convert cleanly.** This is the most valuable contribution. Use the [Diagram conversion issue](https://github.com/hisyamakbar/Mermapix/issues/new?template=diagram-conversion.yml) template and include the Mermaid code, the theme (light / dark), where you inserted it (web "Copy to Figma" or the Figma plugin) and a screenshot of the Figma result next to the preview.
- **Report a bug** in the web app or the plugin UI with the [Bug report](https://github.com/hisyamakbar/Mermapix/issues/new?template=bug_report.yml) template.
- **Suggest a feature** with the [Feature request](https://github.com/hisyamakbar/Mermapix/issues/new?template=feature_request.yml) template.
- **Send a pull request**: fixes for a reported case, a new converter for a diagram type, docs.
- **Security issues**: please do not open a public issue, see [SECURITY.md](SECURITY.md).

## Development setup

Requirements: Node.js 22+ and pnpm 10 (`.mise.toml` pins both; `mise install` sets them up).

```bash
git clone https://github.com/hisyamakbar/Mermapix.git
cd Mermapix
pnpm install
pnpm dev          # web app on http://localhost:8443
```

To try the Figma plugin: `pnpm build:plugin`, then in **Figma Desktop** go to Plugins > Development > Import plugin from manifest and pick `plugin/manifest.json`.

## How the project fits together

Read [`AGENTS.md`](AGENTS.md) for the full architecture. The short version:

1. **Web app** (`src/`): Mermaid renders the diagram, then `buildExportSvg` (`src/export/svg.ts`) writes every computed style onto the SVG and rebuilds each label as absolutely positioned `<tspan>`s so Figma imports editable text. The SVG goes to the clipboard or a download.
2. **Figma plugin** (`plugin/src/`, bundled to `plugin/code.js`): the plugin UI (`src/plugin/`) sends that same SVG to the sandbox, which runs `prepareSvgForFigma` → `figma.createNodeFromSvg` → `optimizeDiagramNodes`. One step per diagram type (`DIAGRAM_STEPS` in `optimize.ts`: ERD, flowchart, sequence, class, state, treemap, railroad, edge labels, then a generic fallback) turns the imported vectors into frames, Auto Layout and named layers.

## Rules that keep the output correct

- **The export pipeline is protected.** Do not change the computed-style capture, the flat `<tspan>` text rewrite in `src/export/svg.ts`, or `htmlLabels: false` in `src/themes/presets.ts`. Other `svg.ts` changes need a maintainer's OK in the issue first, and must be checked on every fixture (`node tests/export-fixtures.mjs`).
- **Offline only.** The plugin declares `networkAccess: none`. No remote fonts, scripts, stylesheets or fetches; assets the plugin UI uses are imported with `?inline` (it is a single HTML file).
- **Positions stay where Mermaid put them.** Converters may wrap, merge and rename layers, but every shape and text must keep its bounds (within about 1px) and nothing may be dropped or duplicated.
- **Generated bundles are committed.** After changing `plugin/src/`, `src/export/`, `src/themes/`, `src/plugin/` or `src/index.css`, run `pnpm build:plugin` and `pnpm build:test-runner` and commit `plugin/` and `plugin-dev/` outputs. CI fails if they are stale.
- No new runtime dependencies without discussing it in an issue first.

## Fixing a diagram case (the usual workflow)

1. Add the Mermaid code as a fixture: `tests/figma-fixtures/NN-short-name.mmd`.
2. Export the payload SVGs the plugin receives, in both themes, with the dev server running:
   ```bash
   node tests/export-fixtures.mjs --out tests/output/fixtures --only NN
   ```
   Copy `NN-short-name-dark.svg` to `tests/fixtures/plugin/NN-case-short-name.svg` and the light one to `…-light.svg`.
3. Write a failing test in `tests/unit/plugin-*.test.mjs`. The tests run the real built `plugin/code.js` in a mock Figma (`tests/plugin-mock/`), calibrated against real Figma behavior. Run `pnpm build:plugin` before `pnpm test:unit`.
4. Fix the converter in `plugin/src/`, rebuild, and make the test pass.
5. If you can, check the result in real Figma: import `plugin-dev/manifest.json` (the developer-only **Mermapix Test Runner**) and click **Run all**; it inserts every fixture in light and dark and writes an audit (see [`tests/README.md`](tests/README.md)). Attach a screenshot to the PR.

## Checks

```bash
npx tsc --noEmit      # types
pnpm test:unit        # unit + mock-Figma plugin tests (no browser needed)
pnpm build            # web build
pnpm build:plugin     # plugin bundle (commit the output)
pnpm build:test-runner

# Need the dev server (pnpm dev) and Google Chrome:
pnpm test:export      # export regression against tests/baseline
pnpm test:colors      # contrast audit of every fixture, light + dark
```

CI runs the first five on every pull request and fails if the committed plugin bundles differ from a fresh build.

## Pull requests

- Keep a PR focused on one issue or one diagram type.
- Describe the problem, the cause, and how you verified the fix (tests, screenshots of the Figma result, light and dark).
- Add a line under a new "Unreleased" heading in [`CHANGELOG.md`](CHANGELOG.md).
- Code style: TypeScript, single quotes (double quotes for strings that contain an apostrophe), no semicolons, as in the existing files. `pnpm format` runs the formatter.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
