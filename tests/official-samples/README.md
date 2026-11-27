# Official Mermaid samples

Mermaid's own sample diagrams, kept as fixtures so a diagram type listed in the Mermaid docs and
sample menus cannot stop working in Mermapix without a test noticing (plan Phase 14).

- Source: npm package [`@mermaid-js/examples`](https://www.npmjs.com/package/@mermaid-js/examples) **2.1.0**
  (what mermaid.live uses for its "Sample Diagrams" menu): 34 entries, 81 samples.
  The package is not a dependency of Mermapix; only the sample code is copied here.
- Licence: MIT, Copyright (c) 2014 - 2022 Knut Sveidqvist (see `LICENSE` in this folder, copied from the package).
- Names: `<id>__<n>.mmd`, the entry's `id` and the position of the sample in it (`radar__1.mmd` is the
  second radar sample). The id is Mermaid's package id, not always the keyword (`flowchart-v2` starts with
  `flowchart`, `er` with `erDiagram`).
- `agentflow__0.mmd` is not from the package (it has no agentflow sample). It is the example of the
  `agentflow-beta` page of the Mermaid docs, kept so that type has a fixture too.

## What uses them

- `node tests/export-fixtures.mjs --fixtures tests/official-samples --out <dir>` exports every sample in both
  themes through the app's real SVG button and checks the content against the viewBox
  (see [`../README.md`](../README.md)).
- `tests/unit/diagram-coverage.test.mjs` counts them, together with `tests/figma-fixtures/`, as coverage:
  every diagram type of the installed Mermaid needs a fixture here or in `figma-fixtures/`, or an entry in
  the "unsupported" list of `src/utils/diagramSupport.ts`.

## Refreshing

Do this after upgrading Mermaid, when `@mermaid-js/examples` has a release for it:

```bash
mkdir /tmp/mermaid-examples && cd /tmp/mermaid-examples      # outside the repo
npm pack @mermaid-js/examples@<version>
tar -xzf mermaid-js-examples-<version>.tgz                   # unpacks into ./package
cd <repo> && node scripts/refresh-official-samples.mjs /tmp/mermaid-examples/package
```

The script rewrites changed samples, adds new ones, removes samples that left the package and prints what
changed. Then update the version above, run `pnpm test:unit` (a new diagram type shows up there) and the
export command above.
