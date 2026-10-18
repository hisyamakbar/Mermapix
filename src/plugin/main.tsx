import React from 'react'
import ReactDOM from 'react-dom/client'
import AppPlugin from './AppPlugin.tsx'
import '../index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppPlugin />
  </React.StrictMode>,
)
