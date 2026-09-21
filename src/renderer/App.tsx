import { useMemo } from 'react'

import type { BootstrapPayload } from '@shared/types'

import { OnboardingShell } from './components/onboarding/OnboardingShell'
import { ErrorToastHost } from './components/ui/ErrorToast'
import { OverlayShell } from './components/overlay/OverlayShell'
import { SettingsShell } from './components/settings/SettingsShell'
import { AppStore, AppStoreProvider, useStoreSnapshot } from './store/appStore'
import { cn } from './utils/cn'

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
  const state = useStoreSnapshot(store)

  /**
   * Click-through makes the whole *window* transparent to input: the OS hands every click to whatever
   * is underneath and forwards only mouse-move messages to us, so nothing rendered in here can ever be
   * clicked. Nothing rendered in here may look clickable either — a control that highlights under the
   * cursor and then does nothing reads as a broken button, which is how this gets reported.
   *
   * It sits at the window's root rather than inside the shell because the error toast is a sibling of
   * the shell, and it covers whatever else the overlay view grows later. The settings and onboarding
   * windows ship in the same bundle but are never click-through, so the mode is scoped to the overlay.
   */
  const clickThrough = view === 'overlay' && state.bootstrap.config.overlay.clickThrough

  return (
    <AppStoreProvider store={store}>
      <div
        data-overlay-window={view === 'overlay' ? '' : undefined}
        className={cn(clickThrough && 'pointer-events-none')}
      >
        {view === 'settings' ? <SettingsShell /> : view === 'onboarding' ? <OnboardingShell /> : <OverlayShell />}
        <ErrorToastHost store={store} />
      </div>
    </AppStoreProvider>
  )
}
