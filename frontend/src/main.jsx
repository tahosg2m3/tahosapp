import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { APP_THEME_OPTIONS } from './utils/profileAppearance'
import { applyAccessibilityPreferences, readAccessibilityPreferences } from './utils/accessibilityPreferences.js'
import { I18nProvider } from './i18n/I18nContext.jsx'

const supportedThemes = new Set(APP_THEME_OPTIONS.map(option => option.value))
const requestedTheme = localStorage.getItem('chat:theme') || 'dark'
const savedTheme = supportedThemes.has(requestedTheme) ? requestedTheme : 'dark'
document.documentElement.dataset.theme = savedTheme
applyAccessibilityPreferences(readAccessibilityPreferences())

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(error => {
      console.warn('Background notifications could not be initialized:', error.message)
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
)
