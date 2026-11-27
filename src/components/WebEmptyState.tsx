// Web app onboarding card (src/App.tsx). CanvasEmptyState.tsx stays the plugin's card: the plugin UI bundle
// must not change when only the web app does (AGENTS.md rule 8). It reuses the same CSS classes, so it looks
// identical. Fold it back into CanvasEmptyState (variant "web") at the next plugin release.
//
// App renders it through a portal into the canvas <section>, so it sits where the shared card sits;
// src/web.css hides the shared card, which Canvas.tsx still renders.
import { Code2, Download, Eye, Sparkles } from 'lucide-react'
import MermapixLogo from './MermapixLogo.tsx'
import { FIGMA_PLUGIN_URL } from '../links.ts'

export interface WebEmptyStateProps {
  onLoadSample: () => void
}

export default function WebEmptyState({ onLoadSample }: WebEmptyStateProps) {
  return (
    <div className="canvas-empty-state web-empty-state">
      <div className="empty-state-logo">
        <MermapixLogo theme="auto" height={30} />
      </div>
      <h2>Mermaid to Editable Pixel</h2>
      <p className="empty-state-subtitle">
        Write Mermaid, DBML or SQL, preview it live, and export it as SVG or PNG, or as editable layers in
        Figma.
      </p>
      <ol className="empty-state-steps">
        <li className="step-card">
          <span className="step-num" aria-hidden="true">
            <Code2 size={12} />
          </span>
          <div>
            <h4>Paste Code</h4>
            <p>Write or paste a Mermaid ERD or flowchart, or import DBML / SQL.</p>
          </div>
        </li>
        <li className="step-card">
          <span className="step-num" aria-hidden="true">
            <Eye size={12} />
          </span>
          <div>
            <h4>Live Preview</h4>
            <p>Inspect the diagram, pan, and zoom interactively on the canvas.</p>
          </div>
        </li>
        <li className="step-card">
          <span className="step-num" aria-hidden="true">
            <Download size={12} />
          </span>
          <div>
            <h4>Export</h4>
            <p>
              Download it as SVG or PNG. For editable Figma layers, use the{' '}
              <a
                href={FIGMA_PLUGIN_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="empty-state-link"
                aria-label="Mermapix plugin on Figma Community (opens in a new tab)"
              >
                Mermapix plugin
              </a>
              .
            </p>
          </div>
        </li>
      </ol>
      <button type="button" className="text-button empty-load-btn" onClick={onLoadSample}>
        <Sparkles size={14} aria-hidden="true" />
        Load Sample ERD Schema
      </button>
    </div>
  )
}
