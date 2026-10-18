import { useState, useRef, useEffect } from 'react'
import { Wand2, FolderInput, ChevronDown, ExternalLink, PanelLeftClose, Sparkles } from 'lucide-react'
import { EXAMPLES } from '../examples/index.ts'
import CodeEditor from './CodeEditor.tsx'
import GithubIcon from './GithubIcon.tsx'

export interface EditorPanelProps {
  sidebarOpen: boolean
  onToggleSidebar: () => void
  code: string
  onCodeChange: (value: string) => void
  error: string | null
  onFormatCode: () => void
  onOpenImport: () => void
  onSelectExample: (code: string) => void
  onOpenAbout?: () => void
}

export default function EditorPanel({
  sidebarOpen,
  onToggleSidebar,
  code,
  onCodeChange,
  error,
  onFormatCode,
  onOpenImport,
  onSelectExample,
  onOpenAbout,
}: EditorPanelProps) {
  const [examplesOpen, setExamplesOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!examplesOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setExamplesOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExamplesOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [examplesOpen])

  const lineMatch = error ? error.match(/line\s+(\d+)/i) : null

  return (
    <aside
      className="editor-panel"
      aria-label="Mermaid code editor"
      aria-hidden={!sidebarOpen}
      inert={!sidebarOpen || undefined}
    >
      <div className="editor-head">
        <div className="editor-head-actions">
          <div className="dropdown-wrapper" ref={dropdownRef}>
            <button
              type="button"
              className={`text-button ${examplesOpen ? 'is-active' : ''}`}
              onClick={() => setExamplesOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={examplesOpen}
              title="Choose an example diagram"
            >
              <Sparkles size={13} aria-hidden="true" />
              Examples
              <ChevronDown
                size={13}
                aria-hidden="true"
                style={{
                  transition: 'transform 0.15s ease',
                  transform: examplesOpen ? 'rotate(180deg)' : 'none',
                }}
              />
            </button>
            {examplesOpen && (
              <div className="custom-dropdown-menu" role="menu">
                {EXAMPLES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className="dropdown-menu-item"
                    onClick={() => {
                      onSelectExample(item.code)
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
            className="text-button"
            onClick={onFormatCode}
            title="Auto-format indentation"
          >
            <Wand2 size={13} aria-hidden="true" />
            Format
          </button>
          <button
            type="button"
            className="text-button"
            onClick={onOpenImport}
            title="Import DBML or SQL schema into ERD"
          >
            <FolderInput size={13} aria-hidden="true" />
            Import
          </button>
        </div>

        <button
          type="button"
          className="icon-button sidebar-collapse-btn"
          onClick={onToggleSidebar}
          aria-label="Hide editor panel"
          title="Hide editor panel (⌘B)"
        >
          <PanelLeftClose size={15} aria-hidden="true" />
        </button>
      </div>

      <CodeEditor
        value={code}
        onChange={onCodeChange}
        error={error}
        placeholder={'erDiagram\n  USER ||--o{ ORDER : places'}
      />

      {error ? (
        <div id="editor-error-msg" className="editor-error" role="alert">
          {lineMatch && <span className="error-line-badge">Line {lineMatch[1]}</span>}
          <p className="error-text">{error}</p>
        </div>
      ) : (
        <p className="editor-hint">Diagram updates automatically as you type.</p>
      )}

      <footer className="editor-footer">
        <p className="editor-author">
          Mermapix by{' '}
          <a href="https://hisyamakbar.com" target="_blank" rel="noreferrer noopener">
            Hisyam Akbar
          </a>
        </p>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <a
            className="editor-docs"
            href="https://github.com/hisyamakbar/Mermapix"
            target="_blank"
            rel="noreferrer noopener"
            title="View source code on GitHub"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
          >
            <GithubIcon size={12} />
            GitHub
          </a>
          <span style={{ color: 'var(--panel-border)', fontSize: '10px' }}>•</span>
          {onOpenAbout && (
            <>
              <button
                type="button"
                onClick={onOpenAbout}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  fontSize: '11px',
                  color: 'var(--muted)',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  textUnderlineOffset: '2px',
                }}
                title="About Mermapix, open source licenses, and trademark disclaimers"
              >
                Legal &amp; About
              </button>
              <span style={{ color: 'var(--panel-border)', fontSize: '10px' }}>•</span>
            </>
          )}
          <a
            className="editor-docs"
            href="https://mermaid.js.org/intro/syntax-reference.html"
            target="_blank"
            rel="noreferrer noopener"
          >
            Docs
            <ExternalLink size={11} aria-hidden="true" style={{ display: 'inline', verticalAlign: 'middle', marginLeft: 3 }} />
          </a>
        </div>
      </footer>
    </aside>
  )
}
