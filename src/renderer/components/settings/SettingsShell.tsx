import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppState } from '../../store/appStore'
import { cn } from '../../utils/cn'
import { AboutPage } from './AboutPage'
import { ClipboardPage } from './ClipboardPage'
import { GeneralPage } from './GeneralPage'
import { GlossaryPage } from './GlossaryPage'
import { PromptPage } from './PromptPage'
import { ProvidersPage } from './ProvidersPage'
import { ShortcutsPage } from './ShortcutsPage'

type SettingsTab = 'general' | 'clipboard' | 'providers' | 'prompt' | 'glossary' | 'shortcuts' | 'about'

const TAB_ORDER: SettingsTab[] = ['general', 'clipboard', 'providers', 'prompt', 'glossary', 'shortcuts', 'about']

export function SettingsShell() {
  const { t } = useTranslation()
  const { bootstrap } = useAppState()
  const [tab, setTab] = useState<SettingsTab>('general')

  return (
    <div className="flex h-screen w-screen bg-surface-opaque text-text">
      <aside className="flex w-48 shrink-0 flex-col border-r border-border bg-surface-sunken px-2 py-3">
        <h1 className="px-2 pb-3 text-[13px] font-semibold tracking-wide">{t('settings.title')}</h1>

        <nav className="flex flex-col gap-0.5">
          {TAB_ORDER.map((value) => (
            <button
              key={value}
              type="button"
              data-settings-tab={value}
              onClick={() => setTab(value)}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
                tab === value ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-surface-hover hover:text-text'
              )}
            >
              {t(`settings.tabs.${value}`)}
            </button>
          ))}
        </nav>

        <span className="flex-1" />

        <p className="px-2.5 text-[11px] text-faint">
          {bootstrap.diagnostics.appVersion} · {bootstrap.diagnostics.platform}
        </p>
      </aside>

      <main className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {tab === 'general' ? <GeneralPage /> : null}
          {tab === 'clipboard' ? <ClipboardPage /> : null}
          {tab === 'providers' ? <ProvidersPage /> : null}
          {tab === 'prompt' ? <PromptPage /> : null}
          {tab === 'glossary' ? <GlossaryPage /> : null}
          {tab === 'shortcuts' ? <ShortcutsPage /> : null}
          {tab === 'about' ? <AboutPage /> : null}
        </div>
      </main>
    </div>
  )
}
