// Phase 13: live link while a linked diagram is being edited. The rules that decide when the plugin
// regenerates the diagram in Figma by itself, and the words it uses for that. Pure (no DOM, no React),
// unit-tested in tests/unit/live-sync.test.mjs. The timers and messages live in AppPlugin.tsx.
import type { Theme } from '../types/index.ts'

/** Pause after the last keystroke before a live update is sent (for a diagram that updates quickly). */
export const LIVE_DELAY_MS = 700
/** Longest pause: a slow diagram waits longer before updating, never more than this. */
export const LIVE_MAX_DELAY_MS = 4000
/**
 * A live update slower than this (in the sandbox) counts as slow. Measured in real Figma: an ordinary
 * diagram takes about 0.8 s, which is fine with a longer pause; only multi-second updates are a problem.
 */
export const LIVE_SLOW_MS = 3000
/** This many slow live updates in a row turn live update off for the rest of the session. */
export const LIVE_SLOW_STREAK = 2
/** localStorage key of the "Live" switch, remembered per user. Absent means on. */
export const LIVE_STORAGE_KEY = 'mermapix:live'

/** Code and theme as one comparable pair: what a diagram was (or will be) generated from. */
export interface Snapshot {
  code: string
  theme: Theme
}

export const sameSnapshot = (a: Snapshot, b: Snapshot): boolean => a.code === b.code && a.theme === b.theme

/**
 * State of live update in the current edit session.
 * - `on`: the diagram in Figma follows the editor.
 * - `off`: the user switched it off.
 * - `paused`: the diagram was edited in Figma (or the last live update failed); the next update replaces
 *   those edits, so only the user may send it.
 * - `slow`: regenerating this diagram took too long, live update is off until the plugin is reopened.
 * - `unavailable`: the diagram cannot be updated in place (inside a component instance).
 */
export type LiveState = 'on' | 'off' | 'paused' | 'slow' | 'unavailable'

export function liveState(s: { editable: boolean; live: boolean; hold: boolean; slow: boolean }): LiveState {
  if (!s.editable) return 'unavailable'
  if (!s.live) return 'off'
  if (s.slow) return 'slow'
  if (s.hold) return 'paused'
  return 'on'
}

/**
 * True when the editor holds something the diagram in Figma does not show yet and a live update may
 * send it. `base` is what is accounted for: what the diagram was last generated from, moved forward by
 * text edits that came from the canvas (those are on the canvas already; regenerating for them would
 * replace the text layer under the cursor of the person typing in Figma).
 */
export function wantsLiveUpdate(state: LiveState, editor: Snapshot, base: Snapshot): boolean {
  return state === 'on' && !sameSnapshot(editor, base)
}

/** Next count of slow live updates in a row. Updates the user asked for do not count either way. */
export function nextSlowStreak(streak: number, ms: number, quiet: boolean): number {
  if (!quiet) return streak
  return ms > LIVE_SLOW_MS ? streak + 1 : 0
}

export const isSlowStreak = (streak: number): boolean => streak >= LIVE_SLOW_STREAK

/**
 * Pause before the next live update, from how long the last update took: 1.5 times that, at least
 * LIVE_DELAY_MS and at most LIVE_MAX_DELAY_MS. A diagram that takes 0.8 s to regenerate updates after a
 * 1.2 s pause, so Figma is not busy regenerating while the user is still typing.
 */
export function liveDelay(lastMs?: number): number {
  if (!lastMs || lastMs <= 0) return LIVE_DELAY_MS
  return Math.min(LIVE_MAX_DELAY_MS, Math.max(LIVE_DELAY_MS, Math.round(lastMs * 1.5)))
}

/** The line under the editor. `null`: not editing a linked diagram (the plugin's normal mode). */
export function editorHint(state: LiveState | null): string {
  if (state === null || state === 'unavailable') return 'Preview updates as you type.'
  if (state === 'on') return 'The diagram in Figma updates as you type.'
  return 'Preview updates as you type. Click Update to change the diagram in Figma.'
}

/** Note under the "Editing" row, or null. An update error is shown instead of this. */
export function liveNote(state: LiveState, slowMs?: number): string | null {
  if (state === 'paused') {
    return 'Live update is paused: this diagram was changed in Figma. Click Update to replace those changes.'
  }
  if (state === 'slow') {
    const took = slowMs ? ` (about ${Math.round(slowMs / 100) / 10} s each time)` : ''
    return `Live update is off: this diagram is too slow to regenerate while typing${took}. Click Update when you are ready.`
  }
  return null
}

/**
 * The Update button while a linked diagram is being edited.
 * - `updating`: an update is in flight.
 * - `up-to-date`: the diagram in Figma shows the editor's code and nothing was changed in Figma that an
 *   update would replace (`canvasChanged`: layers moved, restyled, added or removed, or text edits that are
 *   not in the code). Updating would only regenerate the same diagram.
 * - `update`: anything else.
 */
export type UpdateButtonState = 'update' | 'updating' | 'up-to-date'

export function updateButtonState(s: {
  updating: boolean
  inSync: boolean
  hold: boolean
  canvasChanged: boolean
}): UpdateButtonState {
  if (s.updating) return 'updating'
  if (s.inSync && !s.hold && !s.canvasChanged) return 'up-to-date'
  return 'update'
}

/**
 * The next step of "Save": bring the diagram in Figma up to date with the code, then leave edit mode.
 * Asked again after every answer from the sandbox, until it says `exit`.
 * - `close`: the diagram cannot be updated in place (component instance); leave without updating.
 * - `wait`: an update is in flight; ask again when it is answered.
 * - `exit`: the diagram shows the code; leave.
 * - `leave-confirm`: the code cannot be rendered, so the diagram cannot be updated; ask before leaving.
 * - `update`: send an update (one the user asked for: it asks before replacing changes made in Figma).
 */
export type SaveStep = 'close' | 'wait' | 'exit' | 'leave-confirm' | 'update'

export function saveStep(s: {
  editable: boolean
  updating: boolean
  inSync: boolean
  renderError: boolean
}): SaveStep {
  if (!s.editable) return 'close'
  if (s.updating) return 'wait'
  if (s.inSync) return 'exit'
  if (s.renderError) return 'leave-confirm'
  return 'update'
}

/** Reads the remembered "Live" switch; anything but an explicit "off" is on. */
export function readLivePreference(stored: string | null): boolean {
  return stored !== 'off'
}
