import type { LocaleResource } from './zh-CN'

/** English strings. Typed against the Chinese resource so the two stay in sync. */
export const en: LocaleResource = {
  app: {
    name: 'TranslateClip',
    productName: 'TranslateClip',
    tagline: 'Copy. Translate.'
  },
  common: {
    on: 'On',
    off: 'Off',
    save: 'Save',
    saved: 'Saved',
    cancel: 'Cancel',
    close: 'Close',
    copy: 'Copy',
    copied: 'Copied',
    retry: 'Retry',
    loading: 'Loading…',
    planned: 'Planned',
    reset: 'Reset to default'
  },
  overlay: {
    title: 'TranslateClip',
    emptyTitle: 'Copy any text to translate it',
    emptyBody: 'Press Ctrl+C in any application and the translation shows up here.',
    sourceLabel: 'Original',
    translationLabel: 'Translation',
    tabCurrent: 'Current',
    tabHistory: 'History',
    actionTranslateNow: 'Translate clipboard now',
    actionRetranslate: 'Translate again',
    actionCopy: 'Copy translation',
    actionSwapDirection: 'Swap direction',
    actionPin: 'Pin',
    collapse: 'Collapse',
    expand: 'Expand',
    hide: 'Hide overlay',
    settings: 'Settings',
    providerMissing: 'No translation service configured yet',
    providerMissingAction: 'Set up',
    listening: 'Watching',
    paused: 'Paused',
    clickThroughHint: 'Click-through is on: turn it off from the tray menu.',
    phasePlanned: 'Skeleton is ready: clipboard watching and translation land in the next step.',
    historyEmpty: 'No history yet',
    phase: {
      idle: 'Idle',
      translating: 'Translating',
      done: 'Done',
      error: 'Failed',
      skipped: 'Skipped',
      canceled: 'Cancelled',
      unconfigured: 'Not configured'
    }
  },
  activity: {
    accepted: 'Captured {{count}} characters',
    skipped: 'Skipped: {{reason}}',
    idle: 'Waiting for a copy',
    reasons: {
      disabled: 'watching is paused',
      empty: 'empty content',
      'too-short': 'too short',
      'too-long': 'too long',
      'single-token': 'single token',
      'ignored-pattern': 'matched an ignore rule',
      'same-as-last': 'same as before',
      'self-write': 'written by the app itself'
    }
  },
  tray: {
    showOverlay: 'Show overlay',
    hideOverlay: 'Hide overlay',
    translateNow: 'Translate clipboard now',
    watching: 'Watch clipboard',
    clickThrough: 'Click-through',
    openLogFolder: 'Open log folder',
    quit: 'Quit'
  },
  settings: {
    title: 'Settings',
    tabs: {
      general: 'General',
      clipboard: 'Clipboard',
      providers: 'Providers',
      prompt: 'Prompt',
      glossary: 'Glossary',
      shortcuts: 'Shortcuts',
      about: 'About'
    },
    general: {
      appearance: 'Appearance',
      theme: 'Theme',
      themeSystem: 'Follow system',
      themeLight: 'Light',
      themeDark: 'Dark',
      uiLanguage: 'Interface language',
      uiLanguageSystem: 'Follow system',
      behavior: 'Behaviour',
      closeToTray: 'Keep running in the tray when the overlay is closed',
      closeToTrayHint: 'Clipboard watching continues; reopen the overlay from the tray.',
      launchAtLogin: 'Launch at login',
      launchAtLoginHint: 'Starts silently in the background at login.',
      historyLimit: 'History limit',
      historyLimitHint: 'Oldest unpinned entries are removed beyond this limit.',
      rerunOnboarding: 'Run the setup wizard again',
      rerunOnboardingHint: 'Reconfigure the translation direction and provider.'
    },
    clipboard: {
      watch: 'Watch the clipboard',
      watchHint: 'While paused, copied text is ignored.',
      pollInterval: 'Check interval',
      pollIntervalHint: 'Shorter is snappier, longer is lighter. 400 ms is plenty on Windows.',
      minChars: 'Minimum length',
      minCharsHint: 'Shorter content is ignored.',
      maxChars: 'Maximum length',
      maxCharsHint: 'Longer content is skipped (truncating would produce wrong translations).',
      skipSingleToken: 'Skip single words and numbers',
      skipSingleTokenHint: 'When on, copying a short token or a bare number does not translate.',
      ignorePatterns: 'Ignore rules (regex)',
      ignorePatternsHint: 'Matching content is never sent to the provider.',
      addPattern: 'Add rule',
      patternInvalid: 'Invalid regular expression',
      suggested: 'Common rules',
      cache: 'Reuse translations of identical text',
      cacheHint: 'The same text copied within 24 hours reuses the previous translation for free.',
      debugLog: 'Log LLM requests',
      debugLogHint: 'Writes requests and responses to the log folder for troubleshooting.'
    },
    providers: {
      planned: 'The provider page lands in the next step: add API keys, fetch models and test connectivity here.',
      active: 'Active',
      none: 'Not configured'
    },
    prompt: {
      planned: 'The prompt editor is planned for phase 2.'
    },
    glossary: {
      planned: 'The glossary editor is planned for phase 2.'
    },
    shortcuts: {
      planned: 'The shortcut page is planned for phase 2. No global shortcut is registered by default.'
    },
    about: {
      version: 'Version',
      platform: 'Platform',
      electron: 'Electron',
      arch: 'Architecture',
      dataFolder: 'Data folder',
      logFolder: 'Log folder',
      openFolder: 'Open',
      capabilities: 'System capabilities',
      tray: 'System tray',
      keyring: 'System keyring',
      globalShortcut: 'Global shortcuts',
      available: 'Available',
      unavailable: 'Unavailable',
      limited: 'Limited',
      keyringMissingHint: 'No system keyring is available, so API keys are stored as base64 plain text.',
      trayMissingHint: 'No system tray host is available; the overlay and settings window still work.',
      shortcutLimitedHint: 'This session cannot deliver reliable global shortcuts (Wayland/WSLg); use the tray or the overlay buttons.'
    }
  },
  onboarding: {
    planned: 'The setup wizard lands in the next step. It will ask for the translation direction and a provider.',
    title: 'Welcome to TranslateClip',
    skip: 'Skip',
    finish: 'Finish'
  }
}
