import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import {
  Code2,
  Network,
  Sparkles,
  ChevronDown,
  Wand2,
  FolderInput,
  PlusCircle,
  Check,
} from 'lucide-react'
import { DEFAULT_EXAMPLE, EXAMPLES } from '../examples/index.ts'
import { initMermaid, THEME_PRESETS } from '../themes/presets.ts'
import { exportSvg, exportPng, buildExportSvg, copyToFigma } from '../export/svg.ts'
import { useCanvasZoom } from '../hooks/useCanvasZoom.ts'
import { sanitizeMermaidCode } from '../utils/sanitize.ts'
import Toolbar from '../components/Toolbar.tsx'
import EditorPanel from '../components/EditorPanel.tsx'
import Canvas from '../components/Canvas.tsx'
import ImportModal from '../components/ImportModal.tsx'
import AboutModal from '../components/AboutModal.tsx'
import type { Theme } from '../types/index.ts'

const DEFAULT_DIAGRAM = DEFAULT_EXAMPLE.code
const STORAGE_KEY = 'mermapix:code'
const LEGACY_STORAGE_KEY = 'mermaid-code'
const THEME_STORAGE_KEY = 'mermapix:theme'

initMermaid('dark')

export default function AppPlugin() {
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
  const [activeTab, setActiveTab] = useState<'code' | 'diagram'>('code')
  const [inserted, setInserted] = useState(false)
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
  const [examplesOpen, setExamplesOpen] = useState(false)
  const examplesRef = useRef<HTMLDivElement>(null)

  const renderId = useRef(0)

  useEffect(() => {
    if (!examplesOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (examplesRef.current && !examplesRef.current.contains(e.target as Node)) {
        setExamplesOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExamplesOpen(false)
    }
    window.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [examplesOpen])

  // Canvas pan & zoom math
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

  // Live render Mermaid whenever code or theme changes
  useEffect(() => {
    let active = true
    const timer = window.setTimeout(async () => {
      const trimmed = code.trim()
      if (!trimmed) {
        setSvg('')
        setError(null)
        return
      }
      const source = /```/i.test(trimmed) ? sanitizeMermaidCode(trimmed) : trimmed
      try {
        initMermaid(theme)
        await mermaid.parse(source)
        const id = `mermaid-plugin-svg-${renderId.current++}`
        const { svg: rendered } = await mermaid.render(id, source)
        if (!active) return
        setSvg(rendered)
        setError(null)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err))
      }
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [code, theme])

  // Persist code across plugin sessions
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, code)
    } catch {
      // Storage unavailable
    }
  }, [code])

  // Persist theme selection across plugin sessions
  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    } catch {
      // Storage unavailable
    }
  }, [theme])

  // Insert editable layers into Figma Canvas
  const handleInsertIntoCanvas = () => {
    const built = buildExportSvg(diagramRef.current)
    if (!built) return

    try {
      // Post message to Figma Plugin Sandbox (code.js)
      parent.postMessage(
        {
          pluginMessage: {
            type: 'create-svg',
            svg: built.serialized,
            name: 'Mermapix Diagram',
            theme,
            themeVariables: THEME_PRESETS[theme],
          },
        },
        '*',
      )

      setInserted(true)
      window.setTimeout(() => setInserted(false), 2000)
    } catch {
      // Fallback: Copy to clipboard if postMessage unavailable
      copyToFigma(diagramRef.current)
    }
  }

  const handleExportSvg = () => {
    exportSvg(diagramRef.current)
  }

  const handleExportPng = () => {
    exportPng(diagramRef.current, theme === 'dark' ? '#090d16' : '#ffffff')
  }

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
    <main
      className="mpx-app mpx-plugin-app"
      data-theme={theme}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
      }}
    >
      <Toolbar
        theme={theme}
        onToggleTheme={() => setTheme((val) => (val === 'light' ? 'dark' : 'light'))}
        hasSvg={Boolean(svg)}
        copied={inserted}
        onCopyToFigma={handleInsertIntoCanvas}
        onExportSvg={handleExportSvg}
        onExportPng={handleExportPng}
        primaryActionLabel="Insert to Canvas"
        primaryActionShortLabel="Insert"
        primaryActionCopiedLabel="Added to Canvas!"
        primaryActionShortCopiedLabel="Added!"
        primaryActionTooltip="Insert editable vector shapes & text directly into your Figma canvas"
        primaryActionIcon={<PlusCircle size={15} aria-hidden="true" />}
      />

      <div
        className="mpx-body plugin-workspace-body"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* Plugin Navigation & Tools Bar */}
        <nav
          className="mobile-workspace-bar plugin-view-bar"
          aria-label="Plugin views"
          style={{ display: 'flex' }}
        >
          <div className="control-group mobile-view-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'code'}
              className={`segmented-btn ${activeTab === 'code' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('code')}
            >
              <Code2 size={14} aria-hidden="true" />
              <span>Code</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'diagram'}
              className={`segmented-btn ${activeTab === 'diagram' ? 'is-active' : ''}`}
              onClick={() => {
                setActiveTab('diagram')
                setTimeout(() => resetZoom(), 50)
              }}
            >
              <Network size={15} aria-hidden="true" />
              <span>Diagram</span>
            </button>
          </div>

          <div className="mobile-code-tools">
            <div className="dropdown-wrapper" ref={examplesRef}>
              <button
                type="button"
                className={`text-button mobile-examples-btn ${examplesOpen ? 'is-active' : ''}`}
                onClick={() => setExamplesOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={examplesOpen}
                title="Choose an example diagram"
              >
                <Sparkles size={12} aria-hidden="true" />
                <span>Examples</span>
                <ChevronDown
                  size={11}
                  aria-hidden="true"
                  style={{
                    transition: 'transform 0.15s ease',
                    transform: examplesOpen ? 'rotate(180deg)' : 'none',
                  }}
                />
              </button>
              {examplesOpen && (
                <div className="custom-dropdown-menu mobile-examples-menu" role="menu">
                  {EXAMPLES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      className="dropdown-menu-item"
                      onClick={() => {
                        setCode(item.code)
                        setExamplesOpen(false)
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
        </nav>

        {/* View Content: Code Editor or Live Diagram Canvas */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              opacity: activeTab === 'code' ? 1 : 0,
              pointerEvents: activeTab === 'code' ? 'auto' : 'none',
              zIndex: activeTab === 'code' ? 2 : 1,
            }}
          >
            <EditorPanel
              sidebarOpen={true}
              onToggleSidebar={() => {}}
              code={code}
              onCodeChange={setCode}
              error={error}
              onFormatCode={formatCode}
              onOpenImport={() => setImportOpen(true)}
              onSelectExample={setCode}
              onOpenAbout={() => setAboutOpen(true)}
            />
          </div>

          <div
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 1,
              pointerEvents: activeTab === 'diagram' ? 'auto' : 'none',
              zIndex: activeTab === 'diagram' ? 2 : 1,
            }}
          >
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
        </div>
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
