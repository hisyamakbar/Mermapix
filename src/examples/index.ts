// Built-in diagram examples. Sources live next to this file as plain .mmd so they
// are easy to edit and can be reused by tests/fixtures without touching app code.
import erd from "./erd.mmd?raw"
import flowchart from "./flowchart.mmd?raw"
import sequence from "./sequence.mmd?raw"
import sitemap from "./flowchart-sitemap.mmd?raw"

export type Example = { id: string; label: string; code: string }

export const EXAMPLES: Example[] = [
  { id: "erd", label: "ERD (online store)", code: erd },
  { id: "flowchart", label: "Flowchart", code: flowchart },
  { id: "sequence", label: "Sequence", code: sequence },
  { id: "sitemap", label: "Sitemap (flowchart)", code: sitemap },
]

export const DEFAULT_EXAMPLE = EXAMPLES[0]
