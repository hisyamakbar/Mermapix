# Source-linked diagrams

How a diagram inserted by the Figma plugin stays connected to its Mermaid code: what the user sees, what is stored in the Figma file, how an update works, how edits made on the canvas find their way back into the code, and how both directions stay in step while the plugin is open (live link).

For the rest of the architecture see [`AGENTS.md`](../AGENTS.md). For the test harness see [`tests/README.md`](../tests/README.md).

## What the user gets

1. **Insert.** The plugin stores the Mermaid code and the theme on the diagram it inserts.
2. **Select and edit.** Selecting the diagram, or any layer inside it, shows a strip in the plugin: "Diagram selected" with **Edit source**. The same is available from the **Edit diagram** button Figma shows for the selected diagram.
3. **Update in place.** The diagram is regenerated where it is: same position, same parent, same place in the layer order, same layer name.
   - With **Live** on (the default), the diagram in Figma follows the editor: a short pause in typing updates it.
   - The main button reads **Update diagram** and updates on demand, also when Live is off or paused. It reads **Updating…** (disabled) while an update is in flight, and **Up to date** (disabled) when the diagram matches the code, live update is not paused, and nothing was moved, restyled, added or removed in Figma.
4. **Edits made in Figma.**
   - Text changed on the canvas goes into the code by itself while the plugin is open, as long as its place in the code is certain. The strip says "Added 1 text edit from Figma to the code." with **Undo**. Text that cannot be placed is listed as "Could not match".
   - Anything else an update would replace is named before it happens, for example "Updating replaces edits made in Figma: 2 moved or resized layers, 1 restyled layer." Live update pauses until the user decides.
5. **Save or Revert.** **Save** (disk icon) brings the diagram up to date with the code and then ends edit mode; the editor gets the previous draft back (see [Saving](#saving)). **Revert** puts the code and the diagram back to how they were when editing started.
6. **Branching.** There is no "Insert as new" in edit mode. To keep the original and try a variation, duplicate the diagram in Figma (Cmd+D / Ctrl+D), select the copy and edit it. Each copy is linked on its own.
7. **Names.** A new diagram is named from its code (see [Names](#names-of-new-diagrams)). An update keeps the layer's current name, so a rename in Figma stays.
8. **Exporting.** The plugin has no download buttons. Export from Figma's own Export panel on the inserted layers (SVG, PNG, PDF, any scale). The web app keeps its SVG and PNG downloads.

### What is and is not two-way

Mermaid code has no place for positions or sizes. The layout is computed again on every render, so a layer that was moved or resized cannot be written into the code by any tool.

| Edit made in Figma | Reaches the code? | What happens on update |
|---|---|---|
| Text: node label, table or column name, type, key, comment, message text | Yes, automatically while the plugin is open (with **Undo**) | Reproduced from the code |
| Moved, resized, added or deleted layers | No | Replaced, after a warning that names them |
| Fill or stroke color | No | Replaced, after a warning that names them |

Diagrams inserted before this feature, and diagrams pasted from the web app's clipboard copy, carry no code and cannot be edited this way.

## Where the code lives

Everything is private plugin data (`setPluginData`), written by `plugin/src/sourceLink.ts` and `plugin/src/snapshot.ts`. Nothing leaves the Figma file.

| Key | On | Value |
|---|---|---|
| `mermapix:diagram` | diagram root | JSON `{ "v": 1, "source", "theme", "type" }`. `source` is the editor text as typed. |
| `mermapix:fingerprint` | diagram root | Hash of the generated layer tree. Answers "was this diagram touched?". |
| `mermapix:count` | diagram root | Number of layers the plugin generated. |
| `mermapix:snap` | every layer | Rounded bounds and solid fill and stroke colors as generated, for example `237,233,0,117||e4e4e7`. |
| `mermapix:text` | every text layer | JSON `{ "t": <generated characters>, "x": <TextContext> }`. `x` is omitted when the converter knows nothing more than the text. |

Rules that follow from this:

- **The format is versioned and must stay readable.** Files that hold diagrams outlive the plugin build that wrote them. Add a new version next to `v: 1`; never change what `v: 1` means. `decodeDiagram` returns `null` for anything it does not understand, and such a diagram is simply treated as not linked.
- **One plugin data entry is limited to 100 kB.** A source above about 90 kB is not stored. The diagram is inserted, Figma shows a notice, and that diagram cannot be re-edited. An update whose new source is too large fails instead of silently unlinking the diagram.
- **The data sits on the layers, not in one table keyed by node id.** A copied or duplicated diagram gets new node ids but keeps its plugin data, so each copy is linked and editable on its own.

### The fingerprint

`fingerprint(root)` hashes a depth-first walk of the root's descendants: type, name, bounds rounded to whole pixels, text characters and solid fill colors, plus the root's size.

It deliberately leaves out the root's own position, name and type. Moving or renaming the whole diagram is not an edit, and neither is turning the root frame into a component.

### Text context

A text layer records where it came from when the same words may occur several times in the code (`TextContext` in `plugin/src/protocol.ts`).

| Context | Recorded for | Why |
|---|---|---|
| `erd-entity` | title of an ERD table | An entity rename has to reach every relationship line. |
| `erd-attr` (entity, row, column) | every ERD attribute cell | `id`, `name` and `created_at` repeat across tables, so text search cannot place them. |
| `node` (Mermaid id) | label of a node frame | Two nodes may share a label. |
| `cluster` (Mermaid id) | title of a subgraph, namespace or composite state | A subgraph and a node may share a title. |
| none | everything else (edge labels, sequence messages, class members, chart labels) | Placed only when the text occurs exactly once in the code. |

The ERD context is read from the finished table: each column frame holds one cell per attribute row, so a cell's index in its column is the row in the code.

## Selecting and updating

The UI (`src/plugin/AppPlugin.tsx`) and the sandbox (`plugin/src/main.ts`) talk through the messages typed in `plugin/src/protocol.ts`. That file is types only and is imported by both sides.

| Direction | Message | Meaning |
|---|---|---|
| UI → sandbox | `create-svg` (+ `source`) | Insert a new diagram and store its code. |
| UI → sandbox | `request-selection` | Sent once when the UI starts. |
| sandbox → UI | `selection` | The linked diagram under the selection, or `null`. Sent on every selection change. `autoEdit` is set when the plugin was started from the **Edit diagram** button. |
| UI → sandbox | `watch-diagram { id }` | Sent when edit mode starts: report this diagram now and after every change to it. `id: null` (sent when edit mode ends) stops. One diagram is watched at a time. |
| UI → sandbox | `inspect-diagram` | One report on request. Sent when the plugin window gets focus, in case the watch missed something. |
| sandbox → UI | `diagram-changes` | Text edits and counts (`DiagramChanges`): always the whole canvas compared with what was generated, never a delta. |
| UI → sandbox | `update-svg` (+ `force`, `quiet`) | Regenerate the diagram in place. `quiet` marks a live update: no toast, the selection is left alone. |
| sandbox → UI | `update-needs-confirm` | The diagram was changed in Figma; carries the same `DiagramChanges`. |
| sandbox → UI | `updated { ms }`, `update-failed` | Result. `ms` is how long the update took. `update-failed` has a reason: `missing`, `instance` or `error`. |

### Edit mode in the UI

- **The draft is never overwritten silently.** Loading a diagram's code needs a click on **Edit source**, or the explicit **Edit diagram** button in Figma. Inside edit mode the code belongs to the diagram: text edited on the canvas is written into it, with **Undo**. The remembered draft is never touched.
- **Edit mode is bound to one diagram, not to the live selection.** Clicking elsewhere on the canvas does not change what **Update diagram** targets.
- **The draft survives.** While editing, the code and theme are not written to `localStorage`. Leaving edit mode restores the draft; closing the plugin mid-edit leaves the stored draft as it was.
- **Save never drops typed code.** It is "done", not "discard": the diagram is brought up to date with the code before edit mode ends (see [Saving](#saving)). To go back, **Revert** (shown while the code or the diagram differs from the start of the session) restores the code and sends one update with it.
- **If the diagram is deleted while it is being edited,** edit mode ends and the editor text becomes the draft.
- **A diagram inside a component instance** can be loaded but not updated in place, because the layers of an instance are read-only. The main button stays **Insert to Canvas**, and the Save button is a ✕ **Close** that only leaves edit mode.
- **A syntax error disables the main button,** exactly as for a normal insert. A stale preview is never sent: an update is built only from a preview rendered from exactly the editor's code and theme, and a click that comes too early waits for that preview.

### Saving

**Save** ends edit mode, but only after the diagram in Figma matches the code. Typed code is never dropped (before this, finishing with Live off, during an update in flight, or before the preview had rendered returned the editor to the draft without updating the diagram).

| Situation when Save is clicked | What happens |
|---|---|
| The diagram is up to date | Leaves at once. |
| Unsent changes (Live off, or the typing pause is not over) | Sends an update, shows "Saving…", leaves once the sandbox answers `updated`. |
| An update is in flight | Waits for it, sends what was typed after it, then leaves. |
| The diagram was edited in Figma (the update meets `update-needs-confirm`) | The strip asks: **Replace & save** or **Keep editing**. Edits made in Figma are never replaced silently. |
| The code has a syntax error, or is empty | The strip asks: **Leave anyway** (the diagram keeps its last update) or **Keep editing**. Nothing is sent while it asks; fixing the code closes the question (click Save again). Only an error of the code in the editor counts, not one left over from code typed before. |
| The update fails | Stays in edit mode and shows the error. |
| The diagram is inside a component instance | There is nothing to save: the button is a ✕ **Close**. |

The editor's draft comes back in every case that leaves edit mode.

### The update itself

`updateFromSvg` in `plugin/src/main.ts`, with `transplantDiagram` in `plugin/src/update.ts`:

1. Find the target with `getNodeByIdAsync`. Fail with `missing` if it is gone or has no code, `instance` if it sits inside an instance.
2. Load the target's page (needed under `documentAccess: dynamic-page`) and the fonts.
3. Unless `force` is set, ask for confirmation when the diagram was touched. Two checks, either one is enough: the stored fingerprint differs, or the per-layer stamps report a change. The second check also sees what the fingerprint does not hash, such as a stroke-only recolor. This runs after the awaits of step 2 and nothing awaits between it and the transplant, so an edit made on the canvas meanwhile cannot be lost.
4. Build the new diagram completely, on the target's page, before touching the target. If building throws, the leftover is removed and the target is untouched.
5. Transplant: append the new children to the target, then delete the old ones, resize the target and copy the root's paint. If moving the new children fails, they are removed again and the target keeps its old content.
6. Write the new code, fingerprint and relaunch data on the target, then `figma.commitUndo()`.

The target root is kept on purpose. It keeps its node id, parent, layer order, position and name. A root that the user turned into a component stays the same component, so its instances follow the update.

| Copied from the new root | Kept from the target |
|---|---|
| children, size, `fills`, `strokes`, `strokeWeight`, `cornerRadius`, `clipsContent`, every `mermapix:*` plugin data entry | node id, name, position, parent, layer order, opacity, effects, constraints, exports, plugin data of other plugins |

Every update ends with `figma.commitUndo()`, so each one is its own undo step in Figma: Cmd+Z restores the diagram as it was before the last update, not before the whole session.

## What changed in Figma

`diagramChanges(root)` in `plugin/src/snapshot.ts` compares every layer with its stamp and returns `DiagramChanges`.

| Field | Counts |
|---|---|
| `texts` | Text layers whose characters differ from the stamp, each with `from`, `to` and its context. |
| `moved` | Layers whose rounded position or size differs. |
| `restyled` | Layers whose solid fill or stroke colors differ. |
| `added` | Layers without a stamp (the top one of each such subtree), plus stamped layers beyond the generated count (duplicates). |
| `removed` | Generated count minus the stamped layers still present. |
| `other` | The fingerprint differs but nothing above explains it (renamed or reordered layers), or the diagram has no per-layer stamps. |

The counts explain a warning. They are not an exact diff:

- Geometry that only follows a text edit is not a move: the edited text layer itself, the size of its Auto Layout ancestors, and the positions of its siblings inside an Auto Layout parent.
- A moved group counts once, not once per child.
- A duplicated layer cannot be told apart from its original, so one duplicate and one deletion cancel out.

## Writing text edits back into the code

`applyTextChanges(source, changes)` in `src/plugin/sourcePatch.ts` returns the new source plus two lists: `applied` and `unresolved`.

The rule above all others: **be conservative.** A wrong replacement silently corrupts someone's diagram; an unresolved one only asks them to type it. The patcher never chooses between candidates by order of occurrence.

| Context | How the place is found | Left unresolved when |
|---|---|---|
| `erd-attr` | The entity's `{ }` block, the nth attribute line (blank lines and `%%` comments skipped), the token for the column. | The token at that position is not the generated text; a type or name would contain whitespace; a key cell would not be a list of `PK`, `FK`, `UK`. |
| `erd-entity` | Renamed as a whole token in the block header, both sides of relationship lines and `style` / `class` lines. With `NAME["Alias"]` only the alias changes. | The name occurs on a line the patcher does not understand; the new name collides with another entity; the entity has more than one block. |
| `node`, `cluster` | The id followed by a shape opener (`[ ]`, `( )`, `{ }`, `[[ ]]`, `(( ))`, `[( )]`, `{{ }}`, `id@{ label: ... }`, `subgraph id [Title]`) whose label is the generated text. The quoting style is kept; an unsafe bare label gets quoted. | No such definition and the generic rule does not apply either. |
| none | The generated text occurs exactly once in the code as a complete label: between quotes, pipes or shape delimiters, on an edge, or after a colon or keyword up to the end of the line. | It occurs more than once, or only as part of a longer label. |

Shared behavior:

- `%%` comment lines never match.
- Whitespace runs and `<br>` variants are interchangeable when matching, because canvas text has line breaks where the code has `<br/>` or where Mermaid wrapped a long label.
- Line endings are preserved. A new line break is written as `<br/>`.
- Characters that would break the syntax are made safe (`"` becomes `#quot;` inside a quoted label) or the change is unresolved.
- A multi-key ERD cell (`PK, FK`) is one text layer on the canvas, so its edit replaces the whole key list of that row.

When every difference is a text edit that was applied to the code, the UI answers `update-needs-confirm` with `force` on its own: the update reproduces those edits, so there is nothing to ask.

### Restating edits against the current code

The sandbox always compares the canvas with what was generated, and stamps are not rewritten when an edit is applied (so closing the plugin before the next update loses nothing: the edit is reported again next time). The code, however, moves on with every applied edit. `pendingEdits` in `src/plugin/changeSummary.ts` restates each reported edit against the code as it is now:

| Situation | What is passed to the patcher |
|---|---|
| A layer edited again after its first edit was applied | `from` is the applied text, not the generated one. |
| A cell inside an ERD table whose title was renamed and applied | The context names the table by its new title. |
| An applied edit typed back to the generated text on the canvas | The reverse edit. Not offered when layers were deleted: a deleted layer and a reverted one look the same in the report. |
| Two layers with the same generated text and context | Never restated: the patcher reports them as unresolved instead of guessing which one changed. |

Edits that could not be placed, and edits taken back with **Undo**, go on an ignore list and are not tried again until that layer changes once more. They still count when an update asks before replacing edits made in Figma.

## Live link while the plugin is open

The rules live in `src/plugin/liveSync.ts` (pure); the timers and messages in `src/plugin/AppPlugin.tsx`; the watch in `plugin/src/main.ts`.

### Figma → code

- The sandbox listens to `nodechange` on the diagram's page. That is the page-level event that works with `documentAccess: dynamic-page`; `documentchange` would need every page loaded. A change inside the diagram, or any deletion on the page (a deleted node can no longer be placed), sends a new report 300 ms after the last change. Typing in a text layer fires one event per keystroke, hence the debounce.
- The UI writes the edits it can place into the code (see above). A code change that came from the canvas never triggers a live update. Regenerating for it would replace the text layer under the cursor of the person typing in Figma. It is carried along by the next update the user causes.

### Code → Figma

| Rule | Why |
|---|---|
| A live update is sent after a pause in typing, only from a valid, rendered preview. The pause is 700 ms, or 1.5 times the duration of the last update when that is longer (at most 4 s). | A syntax error never reaches the canvas; the payload always belongs to the code it carries. A slow diagram updates less often instead of keeping Figma busy while the user types. |
| One update in flight. A newer request waits and is built from the editor when the answer arrives. | No pile-up on slow diagrams; the last state always wins. |
| Any update that meets `update-needs-confirm` (live, Update or Save) pauses live update and shows the confirmation. Cancel / Keep editing leaves it paused. | Changes made in Figma are never replaced without the user's click, and the next keystroke does not ask the same question again. **Update** resumes it. |
| A failed live update shows its error and is retried only once the code changes. | No retry storm. |
| Two live updates in a row slower than 3 s turn live update off for the session, with a note. | Multi-second regenerations make Figma lag. An ordinary diagram takes about 0.8 s in real Figma and stays live. Updates the user asks for do not count. |
| Canvas events in the 400 ms after an update are skipped by the watch. | They are the update's own changes; the UI resets its state on `updated` and needs no second walk of the diagram. An edit made in that moment is still caught by the next update's check. |
| An update slower than 500 ms logs its phases (`load`, `check`, `build`, `transplant`, `stamp`) to the plugin console. | To see where the time goes in real Figma (Plugins > Development > Show console). |
| The **Live** switch is remembered in `localStorage` (`mermapix:live`). | A user who prefers clicking **Update** says so once. |

The **Live** switch in the strip reads "Live on", "Live off" or "Live paused". The dot is green when on, hollow when off, and amber when paused or when live update turned itself off because the diagram is slow ("Live off" with a warning dot).

The line under the editor says what follows the typing: "The diagram in Figma updates as you type." when live update is on, otherwise "Preview updates as you type." (plus "Click Update to change the diagram in Figma." in edit mode). The web app keeps its own wording.

## Names of new diagrams

`diagramName(source)` in `src/plugin/diagramName.ts` (pure) gives a new insert a layer name taken from its code, first match wins:

1. YAML frontmatter `title:`.
2. A `title` directive, only for diagram types that have one (sequence, gantt, journey, pie including `pie showData title X`, quadrant, timeline, xychart, C4 and similar). Never for ERD, class, flowchart or state diagrams, where a line starting with `title` is a column or a node, not the diagram's title.
3. `accTitle:`.
4. The diagram type in words ("Flowchart", "ER diagram", "Sequence diagram"); an unknown keyword is humanized.
5. "Mermapix Diagram".

The name is cleaned (quotes, comments, whitespace) and cut at 60 characters with "…". It is sent in `create-svg.name`; the sandbox still falls back to "Mermapix Diagram" when none is given. An update does not send a name and keeps the layer's current one.

## Limits

- Moved, resized, recolored, added and deleted layers are replaced by an update. Colors are not carried across updates.
- A click on **Insert to Canvas** within the 250 ms render debounce after typing can still send the previous preview (updates wait for the preview, inserts do not).
- After Cmd+Z in Figma undoes an update, the editor still holds the newer code. The next change to the code updates the diagram again; nothing tells the user that the diagram is behind.
- Live update regenerates the whole diagram each time. Its cost on large diagrams, and how Figma groups the undo steps, are only known from real Figma (see the manual checklist).
- Two people editing the same diagram at once: the other person's canvas edits are respected only if they are reported before the next live update.
- Sequence messages and class members use the exactly-once rule; they have no structural context yet.

## Files

| File | Role |
|---|---|
| `plugin/src/protocol.ts` | Message and data types shared by the UI and the sandbox. |
| `plugin/src/sourceLink.ts` | Store and find the code on the root, fingerprint, editability. |
| `plugin/src/snapshot.ts` | Per-layer stamps, text context, `diagramChanges`. |
| `plugin/src/update.ts` | `transplantDiagram`: swap a root's content in place. |
| `plugin/src/main.ts` | Message handlers: insert, selection, watch and inspect, update. |
| `src/plugin/AppPlugin.tsx` | Edit mode state, live update queue, automatic apply, messages. |
| `src/plugin/SourceLinkStrip.tsx` | The contextual strip: Live switch, Revert, apply result with Undo, the Save confirmations. |
| `src/plugin/diagramName.ts` | `diagramName`: layer name of a new diagram, from its code. |
| `src/plugin/sourcePatch.ts` | `applyTextChanges`: text edits into Mermaid code. |
| `src/plugin/changeSummary.ts` | `pendingEdits` / `settleHandled` (edits restated against the current code), wording of the result and the confirmation. |
| `src/plugin/liveSync.ts` | Live update rules and wording: state, when an update is due, slow detection, the editor hint. |

## Tests

All of them run without Figma (`pnpm test:unit`), the sandbox ones against the built `plugin/code.js` on the mock in `tests/plugin-mock/` (`session.mjs` runs several messages against one plugin start).

| Suite | Covers |
|---|---|
| `tests/unit/plugin-source-link.test.mjs` | Storing and finding the code, fingerprint, transplant, insert / select / update end to end, failure paths. |
| `tests/unit/plugin-snapshot.test.mjs` | Stamps, text context, every `DiagramChanges` field, untouched diagrams of every diagram family report nothing. |
| `tests/unit/source-patch.test.mjs` | The patch rules per context and the wording helpers. |
| `tests/unit/plugin-roundtrip.test.mjs` | The seam: an edit on the mock canvas, reported by the sandbox, written into the real example code. |
| `tests/unit/plugin-watch.test.mjs` | The watch (`nodechange`, debounce, start and stop), repeated canvas edits written into the code (same label twice, ERD table renamed then a column in it, typed back), quiet updates, one undo step per update, an edit made during an update. |
| `tests/unit/live-sync.test.mjs` | Live update rules and wording. |
| `tests/unit/diagram-name.test.mjs` | Names from frontmatter, `title` directives (and not for ERD columns), `accTitle`, diagram type, fallback, cleaning and the length limit. |

The mock cannot answer everything. The manual round in real Figma is listed in [`tests/README.md`](../tests/README.md#source-linked-diagrams-edit-after-insert).
