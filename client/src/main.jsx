import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { LanguageProvider } from './context/LanguageContext.jsx'

(function bootTheme() {
  try {
    const THEME_MAP = {
      'vscode-dark-plus': ['theme-dark', 'dark'],
      'vscode-light-plus': ['theme-light'],
      'vscode-high-contrast': ['theme-hc', 'dark'],
    }
    const theme = localStorage.getItem('oc_theme') || 'vscode-dark-plus'
    const root = document.documentElement
    root.classList.remove('theme-light', 'theme-dark', 'theme-hc', 'dark')
    ;(THEME_MAP[theme] || THEME_MAP['vscode-dark-plus']).forEach(c => root.classList.add(c))
  } catch {}
})()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </StrictMode>,
)
