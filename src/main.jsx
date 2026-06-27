import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

if (import.meta.env.DEV && typeof window !== 'undefined') {
  // Prevent stale localhost SW/cache from other projects from breaking rendering.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        registration.unregister()
      })
    })
  }

  if ('caches' in window) {
    caches.keys().then((keys) => {
      keys.forEach((key) => {
        caches.delete(key)
      })
    })
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
