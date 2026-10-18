import { useRef, useEffect } from 'react'
import { X, ExternalLink, ShieldCheck, Heart, Sparkles } from 'lucide-react'
import GithubIcon from './GithubIcon.tsx'

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
        style={{ maxWidth: '440px' }}
      >
        <div className="modal-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h3 id="about-dialog-title">About Mermapix</h3>
              <span
                className="badge-offline"
                style={{
                  fontSize: '10px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: 'var(--brand-glow)',
                  color: 'var(--brand-top)',
                  fontWeight: 600,
                }}
              >
                v1.0.2
              </span>
            </div>
            <p className="modal-desc">
              Mermaid to Editable Figma layers. 100% offline, free, and open-source.
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

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '2px 0' }}>
          <span
            style={{
              fontSize: '11px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              borderRadius: '4px',
              background: 'var(--chip-bg)',
              color: 'var(--chip-text)',
            }}
          >
            <ShieldCheck size={12} color="#10b981" /> 100% Offline &amp; Private
          </span>
          <span
            style={{
              fontSize: '11px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              borderRadius: '4px',
              background: 'var(--chip-bg)',
              color: 'var(--chip-text)',
            }}
          >
            <Sparkles size={12} color="#06b6d4" /> Native Auto Layout
          </span>
          <span
            style={{
              fontSize: '11px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '4px 8px',
              borderRadius: '4px',
              background: 'var(--chip-bg)',
              color: 'var(--chip-text)',
            }}
          >
            <Heart size={12} color="#f43f5e" /> Free &amp; Open Source
          </span>
        </div>

        <div
          style={{
            padding: '14px 16px',
            borderRadius: 'var(--radius)',
            background: 'var(--surface-sunken)',
            border: '1px solid var(--panel-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <p style={{ margin: 0, fontSize: '12px', lineHeight: 1.5, color: 'var(--code-text)' }}>
            Created by{' '}
            <a
              href="https://hisyamakbar.com"
              target="_blank"
              rel="noreferrer noopener"
              style={{ color: 'var(--btn-text)', fontWeight: 600, textDecoration: 'underline' }}
            >
              Hisyam Akbar
            </a>
            . Released under the permissive <strong>MIT License</strong>.
          </p>

          <a
            href="https://github.com/hisyamakbar/Mermapix"
            target="_blank"
            rel="noreferrer noopener"
            className="action-btn action-btn-secondary"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              width: '100%',
              padding: '8px 14px',
              borderRadius: 'var(--radius-sm)',
              textDecoration: 'none',
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--btn-text)',
            }}
          >
            <GithubIcon size={15} />
            <span>Star &amp; View on GitHub</span>
            <ExternalLink size={12} style={{ opacity: 0.6 }} />
          </a>
        </div>

        <p
          style={{
            margin: '2px 0 0',
            fontSize: '11px',
            color: 'var(--muted)',
            textAlign: 'center',
            lineHeight: 1.4,
          }}
        >
          Mermapix is an independent open-source tool, not affiliated with Figma, Inc.
        </p>
      </div>
    </div>
  )
}
