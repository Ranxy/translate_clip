/// <reference types="vite/client" />

import type { TranslateClipApi } from '@shared/types'

declare global {
  interface Window {
    translateClip: TranslateClipApi
  }
}

export {}
