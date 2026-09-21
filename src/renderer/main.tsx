import React from 'react'
import ReactDOM from 'react-dom/client'

import { App } from './App'
import { initI18n } from './i18n'
import './tailwind.css'

function renderFatalError(message: string): void {
  const root = document.getElementById('root')
  if (!root) {
    return
  }

  root.textContent = `TranslateClip failed to start: ${message}`
  root.setAttribute('style', 'padding:16px;font-family:system-ui;font-size:13px;color:#dc2626')
}

async function bootstrap(): Promise<void> {
  const api = window.translateClip

  if (!api) {
    renderFatalError('the preload bridge is unavailable')
    return
  }

  try {
    const data = await api.getBootstrapData()
    // The interface language must be applied before the first paint, or the
    // window flashes the fallback language for a frame.
    await initI18n(data.config.uiLanguage)

    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
      <React.StrictMode>
        <App bootstrap={data} />
      </React.StrictMode>
    )
  } catch (error) {
    renderFatalError(error instanceof Error ? error.message : String(error))
  }
}

void bootstrap()
