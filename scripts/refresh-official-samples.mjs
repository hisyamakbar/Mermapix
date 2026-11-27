#!/usr/bin/env node
// Refreshes tests/official-samples/ from the unpacked npm package @mermaid-js/examples.
//
//   npm pack @mermaid-js/examples@<version>          # in an empty folder, outside the repo
//   tar -xzf mermaid-js-examples-<version>.tgz       # unpacks into ./package
//   node scripts/refresh-official-samples.mjs <folder>/package
//
// The package is never installed and never becomes a dependency: only its sample
// code is copied. One file per sample, named <id>__<n>.mmd (the entry's id and the
// sample's position in it). Files of ids the package knows are rewritten and stale
// ones of the same id are removed; files of other ids (agentflow__0.mmd, taken from
// the Mermaid docs) are left alone. Prints what changed.

import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const target = path.join(here, "..", "tests", "official-samples")
const pkgDir = process.argv[2] ? path.resolve(process.argv[2]) : null
if (!pkgDir) {
  console.error("Usage: node scripts/refresh-official-samples.mjs <unpacked @mermaid-js/examples folder>")
  process.exit(2)
}

const pkg = JSON.parse(await readFile(path.join(pkgDir, "package.json"), "utf8"))
if (pkg.name !== "@mermaid-js/examples") {
  console.error(`${pkgDir} is not @mermaid-js/examples (found ${pkg.name})`)
  process.exit(2)
}
const entry = path.join(pkgDir, "dist", "mermaid-examples.core.mjs")
const { diagramData } = await import(pathToFileURL(entry).href)

await mkdir(target, { recursive: true })
const existing = new Set((await readdir(target)).filter((f) => f.endsWith(".mmd")))
const wanted = new Map()
for (const diagram of diagramData) {
  ;(diagram.examples ?? []).forEach((example, n) => {
    wanted.set(`${diagram.id}__${n}.mmd`, example.code)
  })
}
const ids = new Set(diagramData.map((d) => d.id))
let written = 0, changed = 0, removed = 0
for (const [file, code] of wanted) {
  const before = existing.has(file) ? await readFile(path.join(target, file), "utf8") : null
  if (before !== code) {
    await writeFile(path.join(target, file), code)
    changed++
    console.log(`${before === null ? "added  " : "changed"} ${file}`)
  }
  written++
}
for (const file of existing) {
  const id = file.replace(/__\d+\.mmd$/, "")
  if (ids.has(id) && !wanted.has(file)) {
    await unlink(path.join(target, file))
    removed++
    console.log(`removed ${file}`)
  }
}
console.log(`${pkg.name}@${pkg.version}: ${written} samples from ${ids.size} entries, ${changed} added/changed, ${removed} removed`)
