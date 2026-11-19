// Web app onboarding card (src/App.tsx). CanvasEmptyState.tsx stays the plugin's card (the plugin UI bundle
// must not change when the web app does). It reuses the same CSS classes, so it looks identical.
//
// App renders it through a portal into the canvas <section>, so it sits where the shared card sits but is
// outside Canvas's React tree: Canvas's pan handlers (pointerdown -> setPointerCapture) never see presses on
// the buttons here. With pointer capture on the section, the browser retargets pointerup to the section and
// the button's click is lost (that is why "Load Sample ERD Schema" in the shared card does nothing).
import { Code2, Eye, Sparkles } from 'lucide-react'
import MermapixLogo from './MermapixLogo.tsx'
import FigmaIcon from './FigmaIcon.tsx'
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
      <h2>Mermaid to Editable Figma Layers</h2>
      <p className="empty-state-subtitle">
        Write Mermaid, DBML or SQL, preview it live, and bring it into Figma as editable layers
        with Auto Layout.
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
      </ol>
      <button type="button" className="text-button empty-load-btn" onClick={onLoadSample}>
        <Sparkles size={14} aria-hidden="true" />
        Load Sample ERD Schema
      </button>
    </div>
  )
}
