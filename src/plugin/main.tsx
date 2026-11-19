import React from 'react'
import ReactDOM from 'react-dom/client'
import AppPlugin from './AppPlugin.tsx'
import '../index.css'
import './plugin-window.css'

// Last line of defense: if anything outside our CSS ever makes the shell scrollable, put it back, so the
// app can never slide out of view. Scroll events do not bubble, hence the capture listener.
const root = document.getElementById('root')!
document.addEventListener(
  'scroll',
  (event) => {
    const target = event.target
    if (target === document) {
      window.scrollTo(0, 0)
      return
    }
    if (
      target === document.documentElement ||
      target === document.body ||
      target === root ||
      (target instanceof HTMLElement && target.classList.contains('mpx-plugin-app'))
    ) {
      ;(target as HTMLElement).scrollTo(0, 0)
    }
  },
  true,
)

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AppPlugin />
  </React.StrictMode>,
)
