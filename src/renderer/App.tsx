import { useMemo } from 'react'

import type { BootstrapPayload } from '@shared/types'

import { OnboardingShell } from './components/onboarding/OnboardingShell'
import { OverlayShell } from './components/overlay/OverlayShell'
import { SettingsShell } from './components/settings/SettingsShell'
import { AppStore, AppStoreProvider } from './store/appStore'

export type AppView = 'overlay' | 'settings' | 'onboarding'

export function resolveView(): AppView {
  const view = new URLSearchParams(window.location.search).get('view')

  if (view === 'settings' || view === 'onboarding') {
    return view
  }

  return 'overlay'
}

interface AppProps {
  bootstrap: BootstrapPayload
}

export function App({ bootstrap }: AppProps) {
  const store = useMemo(() => new AppStore(bootstrap), [bootstrap])
  const view = useMemo(resolveView, [])

  return (
    <AppStoreProvider store={store}>
      {view === 'settings' ? <SettingsShell /> : view === 'onboarding' ? <OnboardingShell /> : <OverlayShell />}
    </AppStoreProvider>
  )
}
