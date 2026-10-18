import { MousePointer, Move, Minus, Plus, Maximize2 } from 'lucide-react'
import type { RefObject, WheelEvent, PointerEvent, KeyboardEvent } from 'react'
import type { ZoomState } from '../types/index.ts'
import CanvasEmptyState from './CanvasEmptyState.tsx'

export interface CanvasProps {
  canvasRef: RefObject<HTMLElement | null>
  diagramRef: RefObject<HTMLDivElement | null>
  zoom: ZoomState
  zoomText: string
  onZoomTextChange: (value: string) => void
  onZoomKey: (e: KeyboardEvent<HTMLInputElement>) => void
  onCommitZoomText: () => void
  zoomFieldRef: RefObject<HTMLInputElement | null>
  onZoomIn: () => void
  onZoomOut: () => void
  onResetZoom: () => void
  dragging: boolean
  interacting: boolean
  svg: string
  code: string
  error: string | null
  onWheel: (e: WheelEvent) => void
  onPointerDown: (e: PointerEvent) => void
  onPointerMove: (e: PointerEvent) => void
  onPointerUp: () => void
  onLoadSample: () => void
}

export default function Canvas({
  canvasRef,
  diagramRef,
  zoom,
  zoomText,
  onZoomTextChange,
  onZoomKey,
  onCommitZoomText,
  zoomFieldRef,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  dragging,
  interacting,
  svg,
  code,
  error,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onLoadSample,
}: CanvasProps) {
  const gridCell = zoom.scale
  const gridOpacity = Math.max(0, Math.min(0.35, (zoom.scale - 4) * 0.09))

  return (
    <section
      ref={canvasRef}
      className="mpx-canvas"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      aria-label="Interactive diagram canvas"
    >
      <div
        className="dot-grid"
        style={{
          backgroundSize: `${gridCell}px ${gridCell}px`,
          backgroundPosition: `calc(50% + ${zoom.x}px) calc(50% + ${zoom.y}px)`,
          opacity: gridOpacity,
          transition: dragging ? 'none' : 'background-size 0.08s ease-out, opacity 0.12s ease-out',
        }}
      />
      <div
        ref={diagramRef}
        className="diagram-stage"
        style={{
          transform: `translate(calc(-50% + ${zoom.x}px), calc(-50% + ${zoom.y}px)) scale(${zoom.scale})`,
          transition: dragging ? 'none' : 'transform 0.08s ease-out',
        }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {svg && (
        <p className={interacting ? 'canvas-hint is-hidden' : 'canvas-hint'}>
          <MousePointer size={11} aria-hidden="true" style={{ display: 'inline', verticalAlign: '-1px', marginRight: 5 }} />
          Scroll to zoom <b aria-hidden="true">·</b>
          <Move size={11} aria-hidden="true" style={{ display: 'inline', verticalAlign: '-1px', margin: '0 5px 0 6px' }} />
          Drag to pan
        </p>
      )}

      {/* Floating Canvas Viewport Controller (Bottom-Right) */}
      <div
        className="canvas-zoom-widget"
        role="group"
        aria-label="Canvas zoom controls"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="icon-button zoom-btn"
          onClick={onZoomOut}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <Minus size={13} aria-hidden="true" />
        </button>
        <label className="zoom-field">
          <input
            ref={zoomFieldRef}
            value={zoomText}
            onChange={(e) => onZoomTextChange(e.target.value)}
            onKeyDown={onZoomKey}
            onBlur={onCommitZoomText}
            onFocus={(e) => e.currentTarget.select()}
            inputMode="numeric"
            aria-label="Current zoom percentage"
          />
          <span aria-hidden="true">%</span>
        </label>
        <button
          type="button"
          className="icon-button zoom-btn"
          onClick={onZoomIn}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <Plus size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="text-button fit-btn"
          onClick={onResetZoom}
          title="Reset zoom to fit diagram"
          aria-label="Reset zoom to fit diagram"
        >
          <Maximize2 size={11} aria-hidden="true" />
          Fit
        </button>
      </div>

      {!svg && !code.trim() && <CanvasEmptyState onLoadSample={onLoadSample} />}
      {!svg && code.trim() && (
        <p className="loading">{error ? 'Fix the code to render' : 'Rendering diagram…'}</p>
      )}
    </section>
  )
}
