## What and why

<!-- The problem (link the issue: "Fixes #123"), its cause, and what this PR changes. -->

## How it was verified

<!-- Tests added or updated, and for conversion changes a screenshot of the Figma result (light and dark). -->

## Checklist

- [ ] `npx tsc --noEmit` and `pnpm test:unit` pass
- [ ] A diagram fix comes with a fixture in `tests/figma-fixtures/` and a test that failed before the fix
- [ ] `pnpm build:plugin` and `pnpm build:test-runner` were run and their outputs committed (if `plugin/src/`, `src/export/`, `src/themes/`, `src/plugin/` or `src/index.css` changed)
- [ ] The export pipeline rules in `CONTRIBUTING.md` are respected (no `<tspan>` / style-capture / `htmlLabels` changes, no network access)
- [ ] `CHANGELOG.md` has a line under "Unreleased"
