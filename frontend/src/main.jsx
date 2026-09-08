import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { APP_THEME_OPTIONS } from './utils/profileAppearance'
import { applyAccessibilityPreferences, readAccessibilityPreferences } from './utils/accessibilityPreferences.js'

const supportedThemes = new Set(APP_THEME_OPTIONS.map(option => option.value))
const requestedTheme = localStorage.getItem('chat:theme') || 'dark'
const savedTheme = supportedThemes.has(requestedTheme) ? requestedTheme : 'dark'
const savedLocale = localStorage.getItem('chat:locale') || 'tr'
document.documentElement.dataset.theme = savedTheme
document.documentElement.lang = savedLocale
applyAccessibilityPreferences(readAccessibilityPreferences())

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
