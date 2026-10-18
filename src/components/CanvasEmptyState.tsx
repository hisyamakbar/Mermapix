import { Code2, Eye, Layers, Sparkles } from 'lucide-react'
import MermapixLogo from './MermapixLogo.tsx'

export interface CanvasEmptyStateProps {
  onLoadSample: () => void
}

export default function CanvasEmptyState({ onLoadSample }: CanvasEmptyStateProps) {
  return (
    <div className="canvas-empty-state">
      <div className="empty-state-logo">
        <MermapixLogo theme="auto" height={30} />
      </div>
      <h2>Mermaid to Editable Figma Layers</h2>
      <p className="empty-state-subtitle">
        Paste code, see live preview, and paste directly into Figma as real vector shapes and text
        layers.
      </p>
      <ol className="empty-state-steps">
        <li className="step-card">
          <span className="step-num" aria-hidden="true">
            <Code2 size={12} />
          </span>
          <div>
            <h4>Paste Code</h4>
            <p>Write or paste your Mermaid ERD or flowchart in the editor.</p>
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
            <Layers size={12} />
          </span>
          <div>
            <h4>Copy to Figma</h4>
            <p>Click "Copy to Figma" and paste (Cmd/Ctrl+V) for editable layers.</p>
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
