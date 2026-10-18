import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { PanelLeft, Code2, Network, Sparkles, ChevronDown, Wand2, FolderInput } from 'lucide-react'
import { DEFAULT_EXAMPLE, EXAMPLES } from './examples/index.ts'
import { initMermaid } from './themes/presets.ts'
import { exportSvg, copyToFigma, exportPng } from './export/svg.ts'
import { useCanvasZoom } from './hooks/useCanvasZoom.ts'
import { sanitizeMermaidCode } from './utils/sanitize.ts'
import Toolbar from './components/Toolbar.tsx'
import EditorPanel from './components/EditorPanel.tsx'
import Canvas from './components/Canvas.tsx'
import ImportModal from './components/ImportModal.tsx'
import AboutModal from './components/AboutModal.tsx'
import type { Theme } from './types/index.ts'

const DEFAULT_DIAGRAM = DEFAULT_EXAMPLE.code
const STORAGE_KEY = 'mermapix:code'
const LEGACY_STORAGE_KEY = 'mermaid-code'
const THEME_STORAGE_KEY = 'mermapix:theme'

// Initial setup with dark baseline
initMermaid('dark')

export default function App() {
  const [svg, setSvg] = useState('')
  const [code, setCode] = useState<string>(() => {
    try {
      return (
        localStorage.getItem(STORAGE_KEY) ??
        localStorage.getItem(LEGACY_STORAGE_KEY) ??
        DEFAULT_DIAGRAM
      )
    } catch {
      return DEFAULT_DIAGRAM
    }
  })
  const [error, setError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [copied, setCopied] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY)
      if (stored === 'light' || stored === 'dark') return stored
      return 'dark'
    } catch {
      return 'dark'
    }
  })
  const [mobileExamplesOpen, setMobileExamplesOpen] = useState(false)
  const mobileExamplesRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!mobileExamplesOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (mobileExamplesRef.current && !mobileExamplesRef.current.contains(e.target as Node)) {
        setMobileExamplesOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileExamplesOpen(false)
    }
    window.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [mobileExamplesOpen])

  const renderId = useRef(0)

  // Keyboard shortcut: Cmd/Ctrl + B to toggle editor sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setSidebarOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Canvas pan, zoom, and auto-fit management
  const {
    zoom,
    zoomText,
    setZoomText,
    dragging,
    interacting,
    canvasRef,
    diagramRef,
    zoomFieldRef,
    zoomIn,
    zoomOut,
    resetZoom,
    commitZoomText,
    handleZoomKey,
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  } = useCanvasZoom(svg)

  // Live render: validate then render Mermaid whenever code or theme changes
  useEffect(() => {
    let active = true
    const timer = window.setTimeout(async () => {
      const trimmed = code.trim()
      if (!trimmed) {
        setSvg('')
        setError(null)
        return
      }
      // If code still contains markdown fences, strip them before parsing
      const source = /```/i.test(trimmed) ? sanitizeMermaidCode(trimmed) : trimmed
      try {
        initMermaid(theme)
        await mermaid.parse(source)
        const id = `mermaid-svg-${renderId.current++}`
        const { svg: rendered } = await mermaid.render(id, source)
        if (!active) return
        setSvg(rendered)
        setError(null)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err))
      }
    }, 300)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [code, theme])

  // Persist diagram code across sessions
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, code)
    } catch {
      // Ignore storage failures
    }
  }, [code])

  // Persist theme selection across sessions
  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Ignore storage failures
    }
  }, [theme])

  const handleCopyToFigma = async () => {
    const success = await copyToFigma(diagramRef.current)
    if (success) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  const handleExportSvg = () => {
    exportSvg(diagramRef.current)
  }

  const handleExportPng = () => {
    exportPng(diagramRef.current, theme === 'dark' ? '#090d16' : '#ffffff')
  }

  // Tidy Mermaid source code indentation and sanitize any markdown fences
  const formatCode = () => {
    const cleanSource = sanitizeMermaidCode(code)
    const lines = cleanSource.replace(/\r\n/g, '\n').split('\n')
    const out: string[] = []
    let depth = 0
    let blank = false
    for (const raw of lines) {
      const line = raw.trim()
      if (line === '') {
        if (!blank && out.length) out.push('')
        blank = true
        continue
      }
      blank = false
      if (/^end\b/.test(line)) depth = Math.max(0, depth - 1)
      const header = out.length === 0 && !blank
      out.push(header ? line : '  '.repeat(depth + 1) + line)
      if (/^subgraph\b/.test(line)) depth += 1
    }
    setCode(out.join('\n').replace(/\n+$/, ''))
  }

  return (
    <main className="mpx-app" data-theme={theme} data-sidebar={sidebarOpen ? 'open' : 'closed'}>
      <Toolbar
        theme={theme}
        onToggleTheme={() => setTheme((val) => (val === 'light' ? 'dark' : 'light'))}
        hasSvg={Boolean(svg)}
        copied={copied}
        onCopyToFigma={handleCopyToFigma}
        onExportSvg={handleExportSvg}
        onExportPng={handleExportPng}
      />

      <div className="mpx-body">
        {/* Mobile Workspace Bar (Visible only on mobile <= 768px) */}
        <nav className="mobile-workspace-bar" aria-label="Mobile workspace view">
          <div className="control-group mobile-view-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={sidebarOpen}
              className={`segmented-btn ${sidebarOpen ? 'is-active' : ''}`}
              onClick={() => setSidebarOpen(true)}
            >
              <Code2 size={14} aria-hidden="true" />
              <span>Code</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={!sidebarOpen}
              className={`segmented-btn ${!sidebarOpen ? 'is-active' : ''}`}
              onClick={() => {
                setSidebarOpen(false)
                setTimeout(() => resetZoom(), 50)
              }}
            >
              <Network size={15} aria-hidden="true" />
              <span>Diagram</span>
            </button>
          </div>

          {/* Contextual Code Tools (Visible in Code tab on mobile) */}
          {sidebarOpen && (
            <div className="mobile-code-tools">
              <div className="dropdown-wrapper" ref={mobileExamplesRef}>
                <button
                  type="button"
                  className={`text-button mobile-examples-btn ${mobileExamplesOpen ? 'is-active' : ''}`}
                  onClick={() => setMobileExamplesOpen((prev) => !prev)}
                  aria-haspopup="menu"
                  aria-expanded={mobileExamplesOpen}
                  title="Choose an example diagram"
                >
                  <Sparkles size={12} aria-hidden="true" />
                  <span>Examples</span>
                  <ChevronDown
                    size={11}
                    aria-hidden="true"
                    style={{
                      transition: 'transform 0.15s ease',
                      transform: mobileExamplesOpen ? 'rotate(180deg)' : 'none',
                    }}
                  />
                </button>
                {mobileExamplesOpen && (
                  <div className="custom-dropdown-menu mobile-examples-menu" role="menu">
                    {EXAMPLES.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="menuitem"
                        className="dropdown-menu-item"
                        onClick={() => {
                          setCode(item.code)
                          setMobileExamplesOpen(false)
                        }}
                      >
                        <span className="menu-item-tag">{item.id}</span>
                        <span className="menu-item-label">{item.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                className="icon-button mobile-tool-btn"
                onClick={formatCode}
                title="Auto-format indentation"
                aria-label="Format and indent Mermaid code"
              >
                <Wand2 size={13} aria-hidden="true" />
              </button>

              <button
                type="button"
                className="icon-button mobile-tool-btn"
                onClick={() => setImportOpen(true)}
                title="Import schema from DBML or SQL"
                aria-label="Import schema from DBML or SQL"
              >
                <FolderInput size={13} aria-hidden="true" />
              </button>
            </div>
          )}
        </nav>

        <EditorPanel
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          code={code}
          onCodeChange={setCode}
          error={error}
          onFormatCode={formatCode}
          onOpenImport={() => setImportOpen(true)}
          onSelectExample={setCode}
          onOpenAbout={() => setAboutOpen(true)}
        />

        {!sidebarOpen && (
          <button
            type="button"
            className="sidebar-expand-tab"
            onClick={() => setSidebarOpen(true)}
            aria-label="Show editor panel"
            title="Show editor panel (⌘B)"
          >
            <PanelLeft size={15} aria-hidden="true" />
            <span>Editor</span>
          </button>
        )}

        <Canvas
          canvasRef={canvasRef}
          diagramRef={diagramRef}
          zoom={zoom}
          zoomText={zoomText}
          onZoomTextChange={setZoomText}
          onZoomKey={handleZoomKey}
          onCommitZoomText={commitZoomText}
          zoomFieldRef={zoomFieldRef}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onResetZoom={resetZoom}
          dragging={dragging}
          interacting={interacting}
          svg={svg}
          code={code}
          error={error}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onLoadSample={() => setCode(DEFAULT_DIAGRAM)}
        />
      </div>

      <ImportModal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onImportConverted={setCode}
      />

      <AboutModal
        isOpen={aboutOpen}
        onClose={() => setAboutOpen(false)}
      />
    </main>
  )
}
