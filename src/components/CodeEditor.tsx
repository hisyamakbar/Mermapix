import { useState, useRef, useMemo, useEffect, type KeyboardEvent, type UIEvent, type ClipboardEvent } from 'react'
import { Check, Copy } from 'lucide-react'
import { highlightMermaid } from './mermaidHighlighter.ts'
import { sanitizeMermaidCode } from '../utils/sanitize.ts'

export interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  error: string | null
  placeholder?: string
}

export default function CodeEditor({
  value,
  onChange,
  error,
  placeholder,
}: CodeEditorProps) {
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 })
  const [copiedCode, setCopiedCode] = useState(false)
  const [tabTrapped, setTabTrapped] = useState(true)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  // Extract error line if any
  const errorLine = useMemo(() => {
    if (!error) return null
    const match = error.match(/line\s+(\d+)/i)
    return match ? parseInt(match[1], 10) : null
  }, [error])

  // Split code into lines for gutter
  const lines = useMemo(() => value.split('\n'), [value])
  const lineCount = Math.max(1, lines.length)

  // Syntax highlighted HTML
  const highlightedHtml = useMemo(() => highlightMermaid(value), [value])

  // Synchronize scroll between textarea, highlighter, and gutter
  const handleScroll = (e: UIEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget
    if (preRef.current) {
      preRef.current.scrollTop = target.scrollTop
      preRef.current.scrollLeft = target.scrollLeft
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = target.scrollTop
    }
  }

  // Track cursor position (Line, Column)
  const updateCursor = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    const selStart = textarea.selectionStart
    const textBefore = value.slice(0, selStart)
    const curLines = textBefore.split('\n')
    setCursorPos({
      line: curLines.length,
      col: curLines[curLines.length - 1].length + 1,
    })
  }

  // Handle Tab and Shift+Tab key for indentation, and Escape to release Tab navigation
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      setTabTrapped(false)
      return
    }

    if (e.key === 'Tab') {
      if (!tabTrapped) {
        // Allow native Tab navigation out of the editor
        return
      }
      e.preventDefault()
      const textarea = textareaRef.current
      if (!textarea) return

      const start = textarea.selectionStart
      const end = textarea.selectionEnd

      if (e.shiftKey) {
        // Shift+Tab: Outdent
        const lineStart = value.lastIndexOf('\n', start - 1) + 1
        if (value.startsWith('  ', lineStart)) {
          const next = value.slice(0, lineStart) + value.slice(lineStart + 2)
          onChange(next)
          requestAnimationFrame(() => {
            textarea.selectionStart = textarea.selectionEnd = Math.max(lineStart, start - 2)
          })
        }
      } else {
        // Tab: Indent with 2 spaces
        const next = value.substring(0, start) + '  ' + value.substring(end)
        onChange(next)
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2
          updateCursor()
        })
      }
    }
  }

  // Intercept paste: automatically strip markdown code fences (```mermaid ... ```)
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const rawText = e.clipboardData.getData('text')
    if (rawText && /```/i.test(rawText)) {
      e.preventDefault()
      const cleaned = sanitizeMermaidCode(rawText)
      const textarea = textareaRef.current
      if (!textarea) {
        onChange(cleaned)
        return
      }
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const next = value.substring(0, start) + cleaned + value.substring(end)
      onChange(next)
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + cleaned.length
        updateCursor()
      })
    }
  }

  // Copy raw Mermaid code to clipboard
  const handleCopyCode = async () => {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopiedCode(true)
      window.setTimeout(() => setCopiedCode(false), 1500)
    } catch {
      // fallback
    }
  }

  return (
    <div className="code-editor-container">
      <div className="code-editor-surface">
        {/* Line numbers gutter */}
        <div ref={gutterRef} className="code-gutter" aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => {
            const lineNum = i + 1
            const isError = errorLine === lineNum
            const isCurrent = cursorPos.line === lineNum
            return (
              <div
                key={lineNum}
                className={`gutter-line ${isError ? 'is-error' : ''} ${isCurrent ? 'is-current' : ''}`}
              >
                {lineNum}
              </div>
            )
          })}
        </div>

        {/* Editor Area with Highlight Layer and Textarea Layer */}
        <div className="code-stage">
          <pre
            ref={preRef}
            className="code-highlight"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: highlightedHtml + '\n' }}
          />
          <textarea
            ref={textareaRef}
            className="code-textarea"
            value={value}
            onChange={(e) => {
              onChange(e.target.value)
              updateCursor()
            }}
            onPaste={handlePaste}
            onScroll={handleScroll}
            onSelect={updateCursor}
            onClick={updateCursor}
            onKeyUp={updateCursor}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              setTabTrapped(true)
              updateCursor()
            }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder={placeholder}
            aria-label="Mermaid code editor"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'editor-error-msg' : undefined}
          />
        </div>
      </div>

      {/* Tactile Editor Status Bar */}
      <div className="code-editor-statusbar">
        <div className="statusbar-meta">
          <span className="statusbar-item">
            Ln {cursorPos.line}, Col {cursorPos.col}
          </span>
          <span className="statusbar-item">{lineCount} lines</span>
          {!tabTrapped && (
            <span className="statusbar-hint" aria-live="polite">
              Tab exits editor (click to indent)
            </span>
          )}
        </div>
        <button
          type="button"
          className="statusbar-action"
          onClick={handleCopyCode}
          title="Copy Mermaid code to clipboard"
        >
          {copiedCode ? (
            <>
              <Check size={12} aria-hidden="true" /> Copied
            </>
          ) : (
            <>
              <Copy size={12} aria-hidden="true" /> Copy Code
            </>
          )}
        </button>
      </div>
    </div>
  )
}
