// Mermapix Mermaid design tokens + color parsing for the plugin sandbox.

// Canonical Mermapix Mermaid Design Tokens (identical to src/themes/presets.ts)
export const SYSTEM_THEME_PRESETS: Record<'light' | 'dark', Record<string, string>> = {
  light: {
    primaryColor: '#f8fafc',
    primaryTextColor: '#09090b',
    primaryBorderColor: '#e4e4e7',
    lineColor: '#71717a',
    secondaryColor: '#ffffff',
    tertiaryColor: '#ffffff',
    background: '#ffffff',
    attributeBackgroundColorOdd: '#ffffff',
    attributeBackgroundColorEven: '#fafafa',
  },
  dark: {
    darkMode: 'true',
    primaryColor: '#1e293b',
    primaryTextColor: '#f8fafc',
    primaryBorderColor: '#38bdf8',
    lineColor: '#38bdf8',
    secondaryColor: '#0f172a',
    tertiaryColor: '#1e293b',
    background: '#090d16',
    attributeBackgroundColorOdd: '#1e293b',
    attributeBackgroundColorEven: '#131b2e',
  },
}

export function parseColorToFigma(colorStr?: any): { r: number; g: number; b: number } | null {
  if (!colorStr || typeof colorStr !== 'string') return null
  const str = colorStr.trim().toLowerCase()

  if (str.startsWith('#')) {
    let hex = str.slice(1)
    if (hex.length === 3) {
      hex = hex.split('').map((c) => c + c).join('')
    }
    if (hex.length === 6) {
      const num = parseInt(hex, 16)
      if (!isNaN(num)) {
        return {
          r: ((num >> 16) & 255) / 255,
          g: ((num >> 8) & 255) / 255,
          b: (num & 255) / 255,
        }
      }
    }
  }

  const rgbMatch = str.match(/rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/)
  if (rgbMatch) {
    const r = parseFloat(rgbMatch[1]) / 255
    const g = parseFloat(rgbMatch[2]) / 255
    const b = parseFloat(rgbMatch[3]) / 255
    return {
      r: Math.min(1, Math.max(0, r)),
      g: Math.min(1, Math.max(0, g)),
      b: Math.min(1, Math.max(0, b)),
    }
  }

  return null
}
