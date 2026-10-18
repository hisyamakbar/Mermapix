import { useState, useRef, useEffect, type KeyboardEvent } from 'react'
import { X, AlertCircle, ArrowRight, ChevronDown } from 'lucide-react'
import { convertDbmlToMermaid, convertSqlToMermaid } from '../converters/index.ts'
import type { TableNaming } from '../types/index.ts'

export const SAMPLE_DBML = `Table users {
  id integer [pk]
  username varchar [unique, note: 'user handle']
  created_at timestamp
}

Table posts {
  id integer [pk]
  user_id integer [ref: > users.id]
  title varchar
  body text
}`

export const SAMPLE_SQL = `CREATE TABLE customers (
  id INT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  full_name VARCHAR(100)
);

CREATE TABLE orders (
  id INT PRIMARY KEY,
  customer_id INT REFERENCES customers(id),
  total DECIMAL(10,2),
  status VARCHAR(50)
);`

export interface ImportModalProps {
  isOpen: boolean
  onClose: () => void
  onImportConverted: (mermaidCode: string) => void
}

export default function ImportModal({ isOpen, onClose, onImportConverted }: ImportModalProps) {
  const [importFormat, setImportFormat] = useState<'auto' | 'dbml' | 'sql'>('auto')
  const [importNaming, setImportNaming] = useState<TableNaming>('preserve')
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)

  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // Manage focus trap, initial focus, and Escape key dismissal
  useEffect(() => {
    if (!isOpen) return

    previousFocusRef.current = document.activeElement as HTMLElement | null

    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        if (focusableElements.length === 0) return

        const firstElement = focusableElements[0]
        const lastElement = focusableElements[focusableElements.length - 1]

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault()
            lastElement.focus()
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault()
            firstElement.focus()
          }
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    // Move initial focus into the dialog's textarea after mount
    const timer = window.setTimeout(() => {
      const textarea = dialogRef.current?.querySelector<HTMLTextAreaElement>('#import-schema-textarea')
      textarea?.focus()
    }, 50)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.clearTimeout(timer)
      previousFocusRef.current?.focus()
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleConvert = () => {
    setImportError(null)
    const trimmed = importText.trim()
    if (!trimmed) {
      setImportError('Please paste some DBML or SQL code first.')
      return
    }
    try {
      let fmt = importFormat
      if (fmt === 'auto') {
        if (/^\s*Table\s+[A-Za-z0-9_."]+/i.test(trimmed) || /\[\s*(pk|ref)/i.test(trimmed)) {
          fmt = 'dbml'
        } else {
          fmt = 'sql'
        }
      }
      const converted =
        fmt === 'dbml'
          ? convertDbmlToMermaid(trimmed, importNaming)
          : convertSqlToMermaid(trimmed, importNaming)
      onImportConverted(converted)
      setImportText('')
      setImportError(null)
      onClose()
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to convert schema.')
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="modal-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-header">
          <div>
            <h3 id="modal-title">Import DBML / SQL</h3>
            <p className="modal-desc">
              Paste DBML or SQL schema definitions to convert into Mermaid ERD.
            </p>
          </div>
          <button
            type="button"
            className="icon-button modal-close"
            onClick={onClose}
            aria-label="Close dialog"
            title="Close dialog (Escape)"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Clean, single-row toolbar: Format selector on the left, Sample chips on the right */}
        <div className="modal-toolbar">
          <div className="modal-field">
            <span className="modal-field-label">Format:</span>
            <div
              className="segmented-group"
              role="radiogroup"
              aria-label="Schema input format"
              onKeyDown={(e) => {
                const formats = ['auto', 'dbml', 'sql'] as const
                const cur = formats.indexOf(importFormat)
                if (cur === -1) return
                let next = cur
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                  e.preventDefault()
                  next = (cur + 1) % formats.length
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  next = (cur - 1 + formats.length) % formats.length
                } else return
                setImportFormat(formats[next])
                const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]')
                buttons[next]?.focus()
              }}
            >
              {(['auto', 'dbml', 'sql'] as const).map((fmt) => {
                const isActive = importFormat === fmt
                return (
                  <button
                    key={fmt}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    tabIndex={isActive ? 0 : -1}
                    className={`segmented-pill ${isActive ? 'is-active' : ''}`}
                    onClick={() => setImportFormat(fmt)}
                  >
                    {fmt === 'auto' ? 'Auto' : fmt.toUpperCase()}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="modal-samples">
            <span className="modal-samples-label">Sample:</span>
            <button
              type="button"
              className="sample-chip"
              onClick={() => {
                setImportFormat('dbml')
                setImportText(SAMPLE_DBML)
                setImportError(null)
              }}
              title="Load sample DBML code"
            >
              DBML
            </button>
            <button
              type="button"
              className="sample-chip"
              onClick={() => {
                setImportFormat('sql')
                setImportText(SAMPLE_SQL)
                setImportError(null)
              }}
              title="Load sample SQL code"
            >
              SQL
            </button>
          </div>
        </div>

        <label htmlFor="import-schema-textarea" className="sr-only">
          Database schema code (DBML or SQL)
        </label>
        <textarea
          id="import-schema-textarea"
          className="editor-input modal-textarea"
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder="Paste DBML (Table users { ... }) or SQL (CREATE TABLE users (...);)..."
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={Boolean(importError)}
          aria-describedby={importError ? 'import-error-msg' : undefined}
        />

        {importError && (
          <p id="import-error-msg" className="editor-error" role="alert" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertCircle size={14} aria-hidden="true" style={{ flex: 'none' }} />
            {importError}
          </p>
        )}

        {/* Subtle, collapsible secondary option for table naming */}
        <details className="modal-naming-details">
          <summary className="modal-naming-summary">
            <span>Naming: <strong style={{ color: 'var(--header-text)' }}>{importNaming === 'preserve' ? 'Preserve' : importNaming}</strong></span>
            <ChevronDown size={12} className="summary-chevron" aria-hidden="true" />
          </summary>
          <div className="modal-naming-body">
            <span className="modal-field-label">Table names:</span>
            <div
              className="segmented-group"
              role="radiogroup"
              aria-label="Table naming convention"
              onKeyDown={(e) => {
                const namings = ['preserve', 'snake_case', 'PascalCase'] as const
                const cur = namings.indexOf(importNaming)
                if (cur === -1) return
                let next = cur
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                  e.preventDefault()
                  next = (cur + 1) % namings.length
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                  e.preventDefault()
                  next = (cur - 1 + namings.length) % namings.length
                } else return
                setImportNaming(namings[next])
                const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="radio"]')
                buttons[next]?.focus()
              }}
            >
              {(['preserve', 'snake_case', 'PascalCase'] as const).map((naming) => {
                const isActive = importNaming === naming
                return (
                  <button
                    key={naming}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    tabIndex={isActive ? 0 : -1}
                    className={`segmented-pill ${isActive ? 'is-active' : ''}`}
                    onClick={() => setImportNaming(naming)}
                  >
                    {naming === 'preserve' ? 'Preserve' : naming}
                  </button>
                )
              })}
            </div>
          </div>
        </details>

        <div className="modal-actions">
          <button type="button" className="text-button modal-cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="export-button" onClick={handleConvert}>
            Convert to Mermaid ERD
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  )
}
