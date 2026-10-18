import { useState, useRef, useEffect, type WheelEvent, type PointerEvent, type KeyboardEvent } from 'react'
import type { ZoomState } from '../types/index.ts'

const MIN_SCALE = 0.1
const MAX_SCALE = 40
const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

export function useCanvasZoom(svg: string) {
  const [zoom, setZoom] = useState<ZoomState>({ scale: 1, x: 0, y: 0 })
  const [zoomText, setZoomText] = useState('100')
  const [dragging, setDragging] = useState(false)
  const [interacting, setInteracting] = useState(false)

  const canvasRef = useRef<HTMLElement>(null)
  const diagramRef = useRef<HTMLDivElement>(null)
  const zoomFieldRef = useRef<HTMLInputElement>(null)
  const idleTimer = useRef<number | null>(null)
  const dragStart = useRef<{ mx: number; my: number; tx: number; ty: number } | null>(null)
  const fitScaleRef = useRef(1)
  const hasFitRef = useRef(false)

  // Compute the scale that makes the whole diagram fit the canvas (with padding).
  const computeFitScale = () => {
    const svgEl = diagramRef.current?.querySelector('svg') as SVGSVGElement | null
    const canvas = canvasRef.current
    if (!svgEl || !canvas) return null
    const rect = svgEl.getBoundingClientRect()
    const current = zoom.scale || 1
    let w = rect.width / current
    let h = rect.height / current
    if (!w || !h) {
      const vb = svgEl.viewBox?.baseVal
      if (vb && vb.width > 0 && vb.height > 0) {
        w = vb.width
        h = vb.height
      } else {
        return null
      }
    }
    const pad = Math.min(48, Math.max(16, canvas.clientWidth * 0.08))
    if (canvas.clientWidth <= pad * 2 || canvas.clientHeight <= pad * 2) return null
    const scale = Math.min((canvas.clientWidth - pad * 2) / w, (canvas.clientHeight - pad * 2) / h)
    return clampScale(scale)
  }

  const fitToContent = () => {
    const scale = computeFitScale()
    if (scale == null) return
    hasFitRef.current = true
    fitScaleRef.current = scale
    setZoom({ scale, x: 0, y: 0 })
  }

  const prevSvgRef = useRef<string>('')

  // Automatically fit diagram whenever a new SVG is rendered
  useEffect(() => {
    if (!svg) return
    if (svg === prevSvgRef.current) return
    prevSvgRef.current = svg

    let cancelled = false
    let attempts = 0

    const tryFit = () => {
      if (cancelled) return
      const scale = computeFitScale()
      if (scale != null) {
        hasFitRef.current = true
        fitScaleRef.current = scale
        setZoom({ scale, x: 0, y: 0 })
      } else if (attempts < 5) {
        attempts++
        requestAnimationFrame(tryFit)
      }
    }

    requestAnimationFrame(tryFit)

    return () => {
      cancelled = true
    }
  }, [svg])

  // When canvas transitions from hidden to visible or resizes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 60 && entry.contentRect.height > 60) {
          if (!hasFitRef.current && svg) {
            const scale = computeFitScale()
            if (scale != null) {
              hasFitRef.current = true
              fitScaleRef.current = scale
              setZoom({ scale, x: 0, y: 0 })
            }
          }
        }
      }
    })

    observer.observe(canvas)
    return () => observer.disconnect()
  }, [svg])

  const markActivity = () => {
    setInteracting(true)
    if (idleTimer.current) window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setInteracting(false), 900)
  }

  const clampZoom = (scale: number) => {
    const floor = Math.max(MIN_SCALE, fitScaleRef.current * 0.5)
    return Math.min(MAX_SCALE, Math.max(floor, scale))
  }

  const resetZoom = () => fitToContent()
  const zoomIn = () => setZoom((z) => ({ ...z, scale: clampZoom(z.scale * 1.25) }))
  const zoomOut = () => setZoom((z) => ({ ...z, scale: clampZoom(z.scale * 0.8) }))

  useEffect(() => {
    if (document.activeElement !== zoomFieldRef.current) {
      setZoomText(String(Math.round(zoom.scale * 100)))
    }
  }, [zoom.scale])

  const commitZoomText = () => {
    const value = parseInt(zoomText.replace(/[^0-9]/g, ''), 10)
    if (!isNaN(value) && value > 0) {
      setZoom((z) => ({ ...z, scale: clampZoom(value / 100) }))
    }
    setZoomText(String(Math.round(zoom.scale * 100)))
  }

  const handleZoomKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitZoomText()
      e.currentTarget.blur()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1)
      setZoom((z) => {
        const next = clampZoom(Math.round(z.scale * 100 + step) / 100)
        setZoomText(String(Math.round(next * 100)))
        return { ...z, scale: next }
      })
    }
  }

  // Attach non-passive wheel listener directly to canvas DOM to prevent window/menu elastic pull
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return

    const onWheelNative = (e: globalThis.WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      markActivity()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      const rect = el.getBoundingClientRect()
      const px = e.clientX - rect.left - rect.width / 2
      const py = e.clientY - rect.top - rect.height / 2
      setZoom((z) => {
        const scale = clampZoom(z.scale * delta)
        const f = scale / z.scale
        return { scale, x: px - f * (px - z.x), y: py - f * (py - z.y) }
      })
    }

    el.addEventListener('wheel', onWheelNative, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheelNative)
    }
  }, [])

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault()
  }

  const handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    setDragging(true)
    dragStart.current = { mx: e.clientX, my: e.clientY, tx: zoom.x, ty: zoom.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: PointerEvent) => {
    if (!dragging || !dragStart.current) return
    markActivity()
    const dx = e.clientX - dragStart.current.mx
    const dy = e.clientY - dragStart.current.my
    setZoom((z) => ({ ...z, x: dragStart.current!.tx + dx, y: dragStart.current!.ty + dy }))
  }

  const handlePointerUp = () => {
    setDragging(false)
    dragStart.current = null
  }

  return {
    zoom,
    setZoom,
    zoomText,
    setZoomText,
    dragging,
    interacting,
    canvasRef,
    diagramRef,
    zoomFieldRef,
    zoomIn,
    zoomOut,
    resetZoom,
    commitZoomText,
    handleZoomKey,
    handleWheel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  }
}
