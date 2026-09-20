import { useTranslation } from 'react-i18next'

import { APP_LIMITS, LANGUAGE_OPTIONS } from '@shared/constants'

import { useAppState, useAppStore } from '../../store/appStore'
import { Button } from '../ui/Button'
import { Card, CardHeader, Divider } from '../ui/Card'
import { Field } from '../ui/Field'
import { Select } from '../ui/Input'
import { NumberInput } from '../ui/NumberInput'
import { Switch } from '../ui/Switch'

export function GeneralPage() {
  const { t } = useTranslation()
  const store = useAppStore()
  const { config, capabilities } = useAppState().bootstrap
  const diagnostics = useAppState().bootstrap.diagnostics

  const languageOptions = [
    { value: 'system', label: t('settings.general.uiLanguageSystem') },
    ...LANGUAGE_OPTIONS.map((option) => ({ value: option.value, label: `${option.nativeLabel} — ${option.label}` }))
  ]

  return (
    <>
      <Card>
        <CardHeader title={t('settings.general.appearance')} />
        <Field label={t('settings.general.theme')}>
          <Select
            className="w-44"
            value={config.theme}
            onValueChange={(value) => void store.updateConfig({ theme: value as typeof config.theme })}
            options={[
              { value: 'system', label: t('settings.general.themeSystem') },
              { value: 'light', label: t('settings.general.themeLight') },
              { value: 'dark', label: t('settings.general.themeDark') }
            ]}
          />
        </Field>
        <Divider />
        <Field label={t('settings.general.uiLanguage')}>
          <Select
            className="w-56"
            value={config.uiLanguage}
            onValueChange={(value) => void store.updateConfig({ uiLanguage: value as typeof config.uiLanguage })}
            options={languageOptions}
          />
        </Field>
      </Card>

      <Card data-settings-section="overlay">
        <CardHeader title={t('settings.general.overlaySection')} />

        <Field label={t('settings.general.overlayOpacity')} hint={t('settings.general.overlayOpacityHint')}>
          <NumberInput
            value={config.overlay.opacity}
            min={APP_LIMITS.overlayOpacity.min}
            max={APP_LIMITS.overlayOpacity.max}
            step={APP_LIMITS.overlayOpacity.step}
            onCommit={(value) => void store.updateConfig({ overlay: { ...config.overlay, opacity: value } })}
          />
        </Field>

        <Divider />

        <Field label={t('settings.general.overlayFontSize')} hint={t('settings.general.overlayFontSizeHint')}>
          <NumberInput
            value={config.overlay.fontSize}
            min={APP_LIMITS.overlayFontSize.min}
            max={APP_LIMITS.overlayFontSize.max}
            onCommit={(value) => void store.updateConfig({ overlay: { ...config.overlay, fontSize: value } })}
          />
        </Field>

        <Divider />

        <Field label={t('settings.general.overlayOpaque')} hint={t('settings.general.overlayOpaqueHint')}>
          <Switch
            label={t('settings.general.overlayOpaque')}
            checked={config.overlay.opaque}
            onChange={(checked) => void store.updateConfig({ overlay: { ...config.overlay, opaque: checked } })}
          />
        </Field>
      </Card>

      <Card>
        <CardHeader title={t('settings.general.behavior')} />

        <Field
          label={t('settings.general.closeToTray')}
          hint={capabilities.tray ? t('settings.general.closeToTrayHint') : t('settings.about.trayMissingHint')}
        >
          <Switch
            label={t('settings.general.closeToTray')}
            checked={config.closeToTray}
            disabled={!capabilities.tray}
            onChange={(checked) => void store.updateConfig({ closeToTray: checked })}
          />
        </Field>

        <Divider />

        <Field
          label={t('settings.general.launchAtLogin')}
          hint={capabilities.launchAtLogin ? t('settings.general.launchAtLoginHint') : t('settings.general.launchAtLoginUnsupported')}
        >
          <Switch
            label={t('settings.general.launchAtLogin')}
            checked={config.launchAtLogin}
            disabled={!capabilities.launchAtLogin}
            onChange={(checked) => void store.updateConfig({ launchAtLogin: checked })}
          />
        </Field>

        <Divider />

        <Field label={t('settings.general.notifications')} hint={t('settings.general.notificationsHint')}>
          <Switch
            label={t('settings.general.notifications')}
            checked={config.notificationsEnabled}
            onChange={(checked) => void store.updateConfig({ notificationsEnabled: checked })}
          />
        </Field>

        <Divider />

        <Field label={t('settings.general.historyLimit')} hint={t('settings.general.historyLimitHint')}>
          <NumberInput
            value={config.historyLimit}
            min={APP_LIMITS.historyLimit.min}
            max={APP_LIMITS.historyLimit.max}
            step={APP_LIMITS.historyLimit.step}
            onCommit={(value) => void store.updateConfig({ historyLimit: value })}
          />
        </Field>
      </Card>

      <Card>
        <CardHeader title={t('settings.general.rerunOnboarding')} description={t('settings.general.rerunOnboardingHint')} />
        <Button size="sm" onClick={() => void window.translateClip.restartOnboarding()}>
          {t('settings.general.rerunOnboarding')}
        </Button>
      </Card>

      {!capabilities.keyring ? (
        <p className="text-[12px] leading-relaxed text-warn">{t('settings.about.keyringMissingHint')}</p>
      ) : null}
      {capabilities.globalShortcut === 'limited' ? (
        <p className="text-[12px] leading-relaxed text-warn">{t('settings.about.shortcutLimitedHint')}</p>
      ) : null}
      <p className="selectable text-[11px] text-faint">{diagnostics.userDataPath}</p>
    </>
  )
}
