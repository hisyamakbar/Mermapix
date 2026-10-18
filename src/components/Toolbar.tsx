import { useState, useRef, useEffect } from 'react'
import {
  Moon,
  Sun,
  Download,
  ImageDown,
  Copy,
  Check,
  ChevronDown,
  FileDown,
} from 'lucide-react'
import type { Theme } from '../types/index.ts'
import MermapixLogo from './MermapixLogo.tsx'

export interface ToolbarProps {
  theme: Theme
  onToggleTheme: () => void
  hasSvg: boolean
  copied: boolean
  onCopyToFigma: () => void
  onExportSvg: () => void
  onExportPng: () => void
  primaryActionLabel?: string
  primaryActionShortLabel?: string
  primaryActionCopiedLabel?: string
  primaryActionShortCopiedLabel?: string
  primaryActionTooltip?: string
  primaryActionIcon?: React.ReactNode
}

export default function Toolbar({
  theme,
  onToggleTheme,
  hasSvg,
  copied,
  onCopyToFigma,
  onExportSvg,
  onExportPng,
  primaryActionLabel,
  primaryActionShortLabel,
  primaryActionCopiedLabel,
  primaryActionShortCopiedLabel,
  primaryActionTooltip,
  primaryActionIcon,
}: ToolbarProps) {
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!exportMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExportMenuOpen(false)
    }
    window.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [exportMenuOpen])

  const handleThemeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      onToggleTheme()
      const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]')
      const targetBtn = theme === 'light' ? buttons[1] : buttons[0]
      targetBtn?.focus()
    }
  }

  return (
    <header className="mpx-toolbar">
      <div className="site-title">
        <div className="brand-header">
          <h1 className="sr-only">Mermapix</h1>
          <MermapixLogo theme={theme} height={32} />
        </div>
      </div>

      <div className="toolbar-actions">
        {/* Desktop Theme Switcher (34px) */}
        <div
          className="control-group theme-group"
          role="radiogroup"
          aria-label="Interface and diagram theme"
          onKeyDown={handleThemeKeyDown}
        >
          <button
            type="button"
            role="radio"
            aria-checked={theme === 'light'}
            tabIndex={theme === 'light' ? 0 : -1}
            className={`segmented-btn ${theme === 'light' ? 'is-active' : ''}`}
            onClick={() => theme !== 'light' && onToggleTheme()}
            title="Light mode (Clean light diagram & interface)"
          >
            <Sun size={13} aria-hidden="true" />
            <span className="btn-label">Light</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={theme === 'dark'}
            tabIndex={theme === 'dark' ? 0 : -1}
            className={`segmented-btn ${theme === 'dark' ? 'is-active' : ''}`}
            onClick={() => theme !== 'dark' && onToggleTheme()}
            title="Dark mode (Modern dark diagram & interface)"
          >
            <Moon size={13} aria-hidden="true" />
            <span className="btn-label">Dark</span>
          </button>
        </div>

        {/* Desktop Export Files Group (34px) */}
        <div className="control-group export-tray" role="group" aria-label="Export diagram files">
          <button
            type="button"
            className="segmented-btn export-file-btn"
            onClick={onExportSvg}
            disabled={!hasSvg}
            title="Download SVG vector file"
            aria-label="Download SVG vector"
          >
            <Download size={13} aria-hidden="true" />
            <span className="btn-label">SVG</span>
          </button>
          <button
            type="button"
            className="segmented-btn export-file-btn"
            onClick={onExportPng}
            disabled={!hasSvg}
            title="Download high-resolution PNG image"
            aria-label="Download PNG image"
          >
            <ImageDown size={13} aria-hidden="true" />
            <span className="btn-label">PNG</span>
          </button>
        </div>

        {/* Mobile Single Theme Toggle Button (<= 768px) */}
        <button
          type="button"
          className="icon-button mobile-theme-btn"
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
        >
          {theme === 'light' ? <Moon size={15} aria-hidden="true" /> : <Sun size={15} aria-hidden="true" />}
        </button>

        {/* Mobile Export Dropdown Menu (<= 768px) */}
        <div className="dropdown-wrapper mobile-export-dropdown" ref={exportMenuRef}>
          <button
            type="button"
            className={`icon-button mobile-export-btn ${exportMenuOpen ? 'is-active' : ''}`}
            onClick={() => setExportMenuOpen((prev) => !prev)}
            disabled={!hasSvg}
            aria-haspopup="menu"
            aria-expanded={exportMenuOpen}
            aria-label="Export diagram files"
            title="Download diagram files (SVG, PNG)"
          >
            <Download size={14} aria-hidden="true" />
            <ChevronDown
              size={11}
              aria-hidden="true"
              style={{
                transition: 'transform 0.15s ease',
                transform: exportMenuOpen ? 'rotate(180deg)' : 'none',
              }}
            />
          </button>
          {exportMenuOpen && (
            <div className="custom-dropdown-menu mobile-export-menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="dropdown-menu-item"
                onClick={() => {
                  onExportSvg()
                  setExportMenuOpen(false)
                }}
              >
                <Download size={13} aria-hidden="true" />
                <span className="menu-item-label">Export SVG (Vector)</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="dropdown-menu-item"
                onClick={() => {
                  onExportPng()
                  setExportMenuOpen(false)
                }}
              >
                <ImageDown size={13} aria-hidden="true" />
                <span className="menu-item-label">Export PNG (Image)</span>
              </button>
            </div>
          )}
        </div>

        {/* Primary Flagship Action (34px) */}
        <button
          type="button"
          className={copied ? 'export-button is-copied' : 'export-button'}
          onClick={onCopyToFigma}
          disabled={!hasSvg}
          title={primaryActionTooltip || 'Paste into Figma (Cmd/Ctrl+V) for editable vectors. For native Auto Layout, use the Mermapix Figma Plugin!'}
          aria-label={copied ? (primaryActionCopiedLabel || 'Copied to clipboard! Ready to paste into Figma') : (primaryActionLabel || 'Copy to Figma')}
        >
          {copied ? <Check size={15} aria-hidden="true" /> : (primaryActionIcon || <Copy size={15} aria-hidden="true" />)}
          <span className="export-text-full">{copied ? (primaryActionCopiedLabel || 'Copied! Paste in Figma') : (primaryActionLabel || 'Copy to Figma')}</span>
          <span className="export-text-short">{copied ? (primaryActionShortCopiedLabel || 'Copied') : (primaryActionShortLabel || 'Figma')}</span>
        </button>
        <div className="sr-only" role="status" aria-live="polite">
          {copied ? (primaryActionCopiedLabel || 'Diagram copied to clipboard as editable SVG! Paste in Figma with Command V') : ''}
        </div>
      </div>
    </header>
  )
}
