import { useRef, useEffect } from 'react'
import { X, ExternalLink, ShieldCheck, Heart, Sparkles } from 'lucide-react'

export interface AboutModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function AboutModal({ isOpen, onClose }: AboutModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isOpen) return

    previousFocusRef.current = document.activeElement as HTMLElement | null

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        if (focusable.length === 0) return

        const first = focusable[0]
        const last = focusable[focusable.length - 1]

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.setTimeout(() => closeBtnRef.current?.focus(), 50)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      previousFocusRef.current?.focus()
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="presentation"
    >
      <div
        className="modal-dialog about-modal-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-dialog-title"
      >
        <div className="modal-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 id="about-dialog-title">About Mermapix</h3>
              <span className="badge-offline" style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: 'var(--brand-glow)', color: 'var(--brand-top)', fontWeight: 600 }}>
                v1.0.0
              </span>
            </div>
            <p className="modal-desc">
              Mermaid to Editable Figma layers. Generates clean Auto Layout frames, vector shapes, and editable text.
            </p>
          </div>
          <button
            type="button"
            className="icon-button modal-close"
            ref={closeBtnRef}
            onClick={onClose}
            aria-label="Close about dialog"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '4px 0' }}>
          <span style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 8px', borderRadius: '4px', background: 'var(--chip-bg)', color: 'var(--chip-text)' }}>
            <ShieldCheck size={12} color="#10b981" /> 100% Offline & Private
          </span>
          <span style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 8px', borderRadius: '4px', background: 'var(--chip-bg)', color: 'var(--chip-text)' }}>
            <Sparkles size={12} color="#06b6d4" /> Native Auto Layout
          </span>
          <span style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 8px', borderRadius: '4px', background: 'var(--chip-bg)', color: 'var(--chip-text)' }}>
            ⚖️ MIT Open Source
          </span>
        </div>

        <div style={{ fontSize: '12px', lineHeight: 1.6, color: 'var(--code-text)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <p style={{ margin: 0 }}>
            Created by{' '}
            <a
              href="https://hisyamakbar.com"
              target="_blank"
              rel="noreferrer noopener"
              style={{ color: 'var(--btn-text)', fontWeight: 600, textDecoration: 'underline' }}
            >
              Hisyam Akbar
            </a>
            . Licensed under the permissive <strong>MIT License</strong>.
          </p>

          <div style={{ padding: '10px 12px', borderRadius: 'var(--radius)', background: 'var(--surface-sunken)', border: '1px solid var(--panel-border)' }}>
            <strong style={{ display: 'block', fontSize: '11px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
              Open-Source Acknowledgments
            </strong>
            <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '11px', color: 'var(--muted)' }}>
              <li>
                <strong style={{ color: 'var(--code-text)' }}>Mermaid.js</strong> &copy; Knut Sveidqvist & contributors (MIT)
              </li>
              <li>
                <strong style={{ color: 'var(--code-text)' }}>Lucide Icons</strong> &copy; Lucide Contributors (ISC)
              </li>
              <li>
                <strong style={{ color: 'var(--code-text)' }}>React</strong> &copy; Meta Platforms, Inc. (MIT)
              </li>
            </ul>
          </div>

          <div style={{ padding: '10px 12px', borderRadius: 'var(--radius)', background: 'var(--surface-sunken)', border: '1px solid var(--panel-border)', fontSize: '11px', color: 'var(--muted)', lineHeight: 1.5 }}>
            <strong style={{ display: 'block', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
              Legal & Trademark Disclaimers
            </strong>
            <p style={{ margin: '0 0 6px' }}>
              • <strong>Figma</strong> is a registered trademark of Figma, Inc. Mermapix is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Figma, Inc.
            </p>
            <p style={{ margin: '0 0 6px' }}>
              • <strong>Mermaid</strong> is an open-source diagramming project maintained by the Mermaid community. Mermapix is an independent tool.
            </p>
            <p style={{ margin: 0 }}>
              • This software is provided &ldquo;as is&rdquo;, without warranty of any kind, express or implied.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '8px', borderTop: '1px solid var(--panel-border)' }}>
          <button
            type="button"
            className="action-btn action-btn-secondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
