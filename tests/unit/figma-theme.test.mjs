// The plugin theme follows Figma's light/dark theme (src/plugin/figmaTheme.ts). Pure, so the .ts file is
// imported directly. The wiring in AppPlugin.tsx is checked in a browser (see tests/README.md).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FALLBACK_THEME,
  figmaThemeFromClassList,
  initialTheme,
  themeAfterEdit,
  themeOnFigmaChange,
} from '../../src/plugin/figmaTheme.ts'

test('figmaThemeFromClassList: figma-light / figma-dark, anything else is unknown', () => {
  assert.equal(figmaThemeFromClassList(['figma-light']), 'light')
  assert.equal(figmaThemeFromClassList(['figma-dark']), 'dark')
  assert.equal(figmaThemeFromClassList(['foo', 'figma-dark', 'bar']), 'dark')
  assert.equal(figmaThemeFromClassList([]), null)
  assert.equal(figmaThemeFromClassList(['dark', 'light', 'figma']), null)
  assert.equal(figmaThemeFromClassList(new Set(['figma-light'])), 'light')
})

test('figmaThemeFromClassList: accepts a DOMTokenList-like object', () => {
  assert.equal(figmaThemeFromClassList({ length: 2, 0: 'x', 1: 'figma-light' }), 'light')
})

test('initialTheme: Figma\'s theme, else the default dark', () => {
  assert.equal(FALLBACK_THEME, 'dark')
  assert.equal(initialTheme('light'), 'light')
  assert.equal(initialTheme('dark'), 'dark')
  assert.equal(initialTheme(null), 'dark')
})

test('themeOnFigmaChange: outside edit mode the plugin follows, even over a manual toggle', () => {
  assert.equal(themeOnFigmaChange({ current: 'light', figma: 'dark', editing: false }), 'dark')
  assert.equal(themeOnFigmaChange({ current: 'dark', figma: 'light', editing: false }), 'light')
  assert.equal(themeOnFigmaChange({ current: 'dark', figma: 'dark', editing: false }), 'dark')
})

test('themeOnFigmaChange: while editing the diagram\'s theme stays', () => {
  assert.equal(themeOnFigmaChange({ current: 'light', figma: 'dark', editing: true }), 'light')
  assert.equal(themeOnFigmaChange({ current: 'dark', figma: 'light', editing: true }), 'dark')
})

test('themeOnFigmaChange: an unknown Figma theme changes nothing', () => {
  assert.equal(themeOnFigmaChange({ current: 'light', figma: null, editing: false }), 'light')
})

test('themeAfterEdit: Figma changed during the edit, so Figma\'s theme wins', () => {
  assert.equal(themeAfterEdit({ draftTheme: 'light', figmaAtStart: 'light', figmaNow: 'dark' }), 'dark')
  assert.equal(themeAfterEdit({ draftTheme: 'dark', figmaAtStart: 'dark', figmaNow: 'light' }), 'light')
  // The theme became known only during the edit.
  assert.equal(themeAfterEdit({ draftTheme: 'dark', figmaAtStart: null, figmaNow: 'light' }), 'light')
})

test('themeAfterEdit: Figma did not change, so the theme from before the edit comes back', () => {
  // The user had toggled to dark while Figma is light: that choice survives an edit.
  assert.equal(themeAfterEdit({ draftTheme: 'dark', figmaAtStart: 'light', figmaNow: 'light' }), 'dark')
  assert.equal(themeAfterEdit({ draftTheme: 'light', figmaAtStart: 'dark', figmaNow: 'dark' }), 'light')
  assert.equal(themeAfterEdit({ draftTheme: 'dark', figmaAtStart: null, figmaNow: null }), 'dark')
})

test('themeAfterEdit: switched and switched back during the edit is no change', () => {
  assert.equal(themeAfterEdit({ draftTheme: 'dark', figmaAtStart: 'light', figmaNow: 'light' }), 'dark')
})
