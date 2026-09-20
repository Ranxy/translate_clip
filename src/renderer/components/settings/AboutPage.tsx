import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { useAppState } from '../../store/appStore'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card, CardHeader, Divider } from '../ui/Card'
import { IconExternal, IconFolder } from '../ui/Icon'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-[12.5px]">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 selectable truncate text-right text-text">{children}</span>
    </div>
  )
}

function CapabilityRow({ label, ok, okLabel, badLabel }: { label: string; ok: boolean; okLabel: string; badLabel: string }) {
  return (
    <Row label={label}>
      <Badge tone={ok ? 'ok' : 'warn'}>{ok ? okLabel : badLabel}</Badge>
    </Row>
  )
}

export function AboutPage() {
  const { t } = useTranslation()
  const { diagnostics } = useAppState().bootstrap
  const { capabilities } = diagnostics

  return (
    <>
      <Card>
        <CardHeader title={t('settings.about.version')} />
        <Row label={t('settings.about.version')}>{`${diagnostics.appVersion} (${t('app.productName')})`}</Row>
        <Row label={t('settings.about.electron')}>{diagnostics.electronVersion}</Row>
        <Row label={t('settings.about.platform')}>{`${diagnostics.platform} · ${diagnostics.arch}`}</Row>
        <Divider />
        <Row label={t('settings.about.dataFolder')}>
          <span className="font-mono text-[11.5px]">{diagnostics.userDataPath}</span>
        </Row>
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" onClick={() => void window.translateClip.openDataFolder()}>
            <IconFolder />
            {t('settings.about.openFolder')}
          </Button>
          <Button size="sm" onClick={() => void window.translateClip.openLogFolder()}>
            <IconFolder />
            {t('settings.about.logFolder')}
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title={t('settings.about.capabilities')} />
        <CapabilityRow
          label={t('settings.about.tray')}
          ok={capabilities.tray}
          okLabel={t('settings.about.available')}
          badLabel={t('settings.about.unavailable')}
        />
        <CapabilityRow
          label={t('settings.about.keyring')}
          ok={capabilities.keyring}
          okLabel={t('settings.about.available')}
          badLabel={t('settings.about.unavailable')}
        />
        <Row label={t('settings.about.globalShortcut')}>
          <Badge tone={capabilities.globalShortcut === 'full' ? 'ok' : 'warn'}>
            {capabilities.globalShortcut === 'full' ? t('settings.about.available') : t('settings.about.limited')}
          </Badge>
        </Row>

        {!capabilities.tray ? <p className="mt-2 text-[11.5px] leading-relaxed text-warn">{t('settings.about.trayMissingHint')}</p> : null}
        {!capabilities.keyring ? (
          <p className="mt-2 text-[11.5px] leading-relaxed text-warn">{t('settings.about.keyringMissingHint')}</p>
        ) : null}
        {capabilities.globalShortcut === 'limited' ? (
          <p className="mt-2 text-[11.5px] leading-relaxed text-warn">{t('settings.about.shortcutLimitedHint')}</p>
        ) : null}
      </Card>

      <Card>
        <CardHeader title={t('app.tagline')} description={t('overlay.phasePlanned')} />
        <Button
          size="sm"
          onClick={() => void window.translateClip.openExternal('https://github.com/Ranxy/translate_clip')}
        >
          <IconExternal />
          GitHub
        </Button>
      </Card>
    </>
  )
}
