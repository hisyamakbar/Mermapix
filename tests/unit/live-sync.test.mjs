// Phase 13: the rules of live update while a linked diagram is being edited (src/plugin/liveSync.ts).
// Pure, so the .ts file is imported directly. The sandbox side (quiet updates, timing, undo steps) is in
// plugin-watch.test.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LIVE_DELAY_MS,
  LIVE_MAX_DELAY_MS,
  LIVE_SLOW_MS,
  LIVE_SLOW_STREAK,
  editorHint,
  isSlowStreak,
  liveDelay,
  liveNote,
  liveState,
  nextSlowStreak,
  readLivePreference,
  sameSnapshot,
  saveStep,
  updateButtonState,
  wantsLiveUpdate,
} from '../../src/plugin/liveSync.ts'

const base = { editable: true, live: true, hold: false, slow: false }

test('liveState: instance first, then the switch, then slow, then paused', () => {
  assert.equal(liveState(base), 'on')
  assert.equal(liveState({ ...base, editable: false, live: false }), 'unavailable')
  assert.equal(liveState({ ...base, live: false, slow: true, hold: true }), 'off')
  assert.equal(liveState({ ...base, slow: true, hold: true }), 'slow')
  assert.equal(liveState({ ...base, hold: true }), 'paused')
})

test('wantsLiveUpdate: only when on and the editor differs from what is accounted for (code or theme)', () => {
  const synced = { code: 'flowchart LR\n  a --> b', theme: 'light' }
  assert.equal(wantsLiveUpdate('on', synced, { ...synced }), false)
  assert.equal(wantsLiveUpdate('on', { ...synced, code: synced.code + '\n  b --> c' }, synced), true)
  assert.equal(wantsLiveUpdate('on', { ...synced, theme: 'dark' }, synced), true)
  for (const state of ['off', 'paused', 'slow', 'unavailable']) {
    assert.equal(wantsLiveUpdate(state, { ...synced, theme: 'dark' }, synced), false, state)
  }
  assert.equal(sameSnapshot(synced, { ...synced }), true)
})

test('slow streak: only live updates count; a fast one resets; the streak length turns it off', () => {
  let streak = 0
  streak = nextSlowStreak(streak, LIVE_SLOW_MS + 1, true)
  assert.equal(streak, 1)
  assert.equal(isSlowStreak(streak), LIVE_SLOW_STREAK <= 1)
  assert.equal(nextSlowStreak(streak, LIVE_SLOW_MS * 10, false), 1, 'an update the user asked for does not count')
  assert.equal(nextSlowStreak(streak, LIVE_SLOW_MS, true), 0, 'a fast one resets')
  for (let i = 1; i < LIVE_SLOW_STREAK; i++) streak = nextSlowStreak(streak, LIVE_SLOW_MS + 1, true)
  assert.equal(isSlowStreak(streak), true)
})

test('editor hint says what follows the typing', () => {
  assert.equal(editorHint(null), 'Preview updates as you type.')
  assert.equal(editorHint('unavailable'), 'Preview updates as you type.')
  assert.equal(editorHint('on'), 'The diagram in Figma updates as you type.')
  for (const state of ['off', 'paused', 'slow']) {
    assert.equal(editorHint(state), 'Preview updates as you type. Click Update to change the diagram in Figma.')
  }
})

test('live note: only paused and slow explain themselves; slow names the duration', () => {
  assert.equal(liveNote('on'), null)
  assert.equal(liveNote('off'), null)
  assert.match(liveNote('paused'), /changed in Figma/)
  assert.match(liveNote('slow', 1840), /about 1\.8 s/)
  assert.doesNotMatch(liveNote('slow'), /about/)
})

test('the Live switch is on unless it was explicitly turned off', () => {
  assert.equal(readLivePreference(null), true)
  assert.equal(readLivePreference('on'), true)
  assert.equal(readLivePreference('garbage'), true)
  assert.equal(readLivePreference('off'), false)
})

test('liveDelay: a slow diagram waits longer instead of losing live update', () => {
  assert.equal(liveDelay(undefined), LIVE_DELAY_MS)
  assert.equal(liveDelay(0), LIVE_DELAY_MS)
  assert.equal(liveDelay(120), LIVE_DELAY_MS, 'a fast diagram keeps the short pause')
  assert.equal(liveDelay(800), 1200, 'measured in real Figma: about 0.8 s per update')
  assert.equal(liveDelay(10_000), LIVE_MAX_DELAY_MS)
})

test('an ordinary diagram (about 0.8 s per update in real Figma) never counts as slow', () => {
  let streak = 0
  for (let i = 0; i < 5; i++) streak = nextSlowStreak(streak, 800, true)
  assert.equal(streak, 0)
  assert.equal(isSlowStreak(nextSlowStreak(nextSlowStreak(0, 1500, true), 1500, true)), false)
})

test('updateButtonState: busy, then up to date only when nothing would change', () => {
  const idle = { updating: false, inSync: true, hold: false, canvasChanged: false }
  assert.equal(updateButtonState(idle), 'up-to-date')
  assert.equal(updateButtonState({ ...idle, updating: true }), 'updating')
  assert.equal(updateButtonState({ ...idle, inSync: false }), 'update', 'code not in Figma yet')
  assert.equal(updateButtonState({ ...idle, hold: true }), 'update', 'paused: the user may replace Figma edits')
  assert.equal(updateButtonState({ ...idle, canvasChanged: true }), 'update', 'Figma edits an update would replace')
  assert.equal(updateButtonState({ ...idle, updating: true, inSync: false }), 'updating')
})

test('saveStep: Save never leaves with code the diagram does not show', () => {
  const s = { editable: true, updating: false, inSync: true, renderError: false }
  assert.equal(saveStep(s), 'exit')
  assert.equal(saveStep({ ...s, inSync: false }), 'update', 'Live off or typing pause not over: send it first')
  assert.equal(saveStep({ ...s, inSync: false, updating: true }), 'wait', 'an update in flight is answered first')
  assert.equal(saveStep({ ...s, updating: true }), 'wait')
  assert.equal(saveStep({ ...s, inSync: false, renderError: true }), 'leave-confirm', 'broken code: ask')
  assert.equal(saveStep({ ...s, renderError: true }), 'exit', 'diagram already shows the last good code that was sent')
  assert.equal(saveStep({ ...s, editable: false, inSync: false, renderError: true }), 'close', 'instance: nothing to update')
})
