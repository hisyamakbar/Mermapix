// The plugin follows Figma's light/dark theme. With `themeColors: true` in figma.showUI, Figma puts the
// class `figma-light` or `figma-dark` on the plugin iframe's <html> element and updates it live.
// The rules (which theme wins when) are pure and unit-tested in tests/unit/figma-theme.test.mjs;
// the observer and the state live in AppPlugin.tsx. The web app does not use any of this.
import type { Theme } from '../types/index.ts'

/** Theme when Figma's is unknown (the UI opened in a normal browser). */
export const FALLBACK_THEME: Theme = 'dark'

/** Figma's theme from the class names of <html> (`figma-light` / `figma-dark`), or null when neither is there. */
export function figmaThemeFromClassList(list: Iterable<string> | ArrayLike<string>): Theme | null {
  let found: Theme | null = null
  for (const name of Array.from(list as ArrayLike<string>)) {
    if (name === 'figma-dark') found = 'dark'
    else if (name === 'figma-light') found = 'light'
  }
  return found
}

/** Theme when the plugin opens: Figma's, else the default. Nothing is remembered from earlier runs. */
export function initialTheme(figma: Theme | null): Theme {
  return figma ?? FALLBACK_THEME
}

/**
 * Figma's theme just changed to `figma`. Outside edit mode the plugin follows (the latest change wins over
 * an earlier manual toggle). While a linked diagram is being edited its own theme stays in force: a change
 * here would regenerate the diagram in the other theme.
 */
export function themeOnFigmaChange(input: { current: Theme; figma: Theme | null; editing: boolean }): Theme {
  if (input.editing || input.figma === null) return input.current
  return input.figma
}

/**
 * Edit mode ended. Figma's theme if it changed during the edit, otherwise the theme the user had before
 * entering edit mode.
 */
export function themeAfterEdit(input: {
  draftTheme: Theme
  figmaAtStart: Theme | null
  figmaNow: Theme | null
}): Theme {
  const { draftTheme, figmaAtStart, figmaNow } = input
  return figmaNow !== null && figmaNow !== figmaAtStart ? figmaNow : draftTheme
}
