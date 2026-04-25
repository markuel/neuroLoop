import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const PRELOAD_RELOAD_KEY = 'neuroLoop:preloadReloaded'
const PRELOAD_RELOAD_WINDOW_MS = 60_000

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  const lastReload = Number(window.sessionStorage.getItem(PRELOAD_RELOAD_KEY) || 0)
  if (Date.now() - lastReload < PRELOAD_RELOAD_WINDOW_MS) {
    console.error('Application chunk failed after reload', event.payload)
    return
  }
  window.sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(Date.now()))
  console.warn('Application chunk failed to load; reloading', event.payload)
  window.location.reload()
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
