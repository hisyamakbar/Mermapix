import { Code2, Eye, Layers, Sparkles } from 'lucide-react'
import MermapixLogo from './MermapixLogo.tsx'
import FigmaIcon from './FigmaIcon.tsx'
import { FIGMA_PLUGIN_URL } from '../links.ts'

export interface CanvasEmptyStateProps {
  onLoadSample: () => void
  /** "web": step 3 points to the Community plugin. "plugin": step 3 describes Insert (already inside Figma). */
  variant: 'web' | 'plugin'
}

export default function CanvasEmptyState({ onLoadSample, variant }: CanvasEmptyStateProps) {
  const isWeb = variant === 'web'
  return (
    <div className="canvas-empty-state">
      <div className="empty-state-logo">
        <MermapixLogo theme="auto" height={30} />
      </div>
      <h2>Mermaid to Editable Figma Layers</h2>
      <p className="empty-state-subtitle">
        {isWeb
          ? 'Write Mermaid, DBML or SQL, preview it live, and bring it into Figma as editable layers with Auto Layout.'
          : 'Write Mermaid, DBML or SQL, preview it live, and insert it as editable layers with Auto Layout.'}
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
        {isWeb ? (
          <li className="step-card">
            <span className="step-num" aria-hidden="true">
              <FigmaIcon size={12} />
            </span>
            <div>
              <h4>Open in Figma</h4>
              <p>
                Get the{' '}
                <a
                  href={FIGMA_PLUGIN_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="empty-state-link"
                  aria-label="Mermapix plugin on Figma Community (opens in a new tab)"
                >
                  Mermapix plugin
                </a>
                , paste your code and click Insert.
              </p>
            </div>
          </li>
        ) : (
          <li className="step-card">
            <span className="step-num" aria-hidden="true">
              <Layers size={12} />
            </span>
            <div>
              <h4>Insert into Figma</h4>
              <p>Click Insert to add the diagram as editable layers. Select it later to edit its code.</p>
            </div>
          </li>
        )}
      </ol>
      <button type="button" className="text-button empty-load-btn" onClick={onLoadSample}>
        <Sparkles size={14} aria-hidden="true" />
        Load Sample ERD Schema
      </button>
    </div>
  )
}
