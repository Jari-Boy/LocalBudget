import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design/fonts'
import './design/tokens.css'
import './index.css'
import './infrastructure/i18n/i18n'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
