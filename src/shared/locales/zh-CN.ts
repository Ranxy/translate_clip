/**
 * Simplified Chinese strings. This file is the reference shape: `en.ts` is typed
 * as `typeof zhCN`, so adding a key here without translating it there is a type
 * error. Used by both the renderer (via i18next) and the main process (via the
 * tiny resolver in src/main/i18n.ts).
 */
export const zhCN = {
  app: {
    name: '剪译',
    productName: 'TranslateClip',
    tagline: '复制即翻译'
  },
  common: {
    on: '开启',
    off: '关闭',
    save: '保存',
    saved: '已保存',
    cancel: '取消',
    close: '关闭',
    copy: '复制',
    copied: '已复制',
    retry: '重试',
    loading: '加载中…',
    planned: '计划中',
    reset: '恢复默认'
  },
  overlay: {
    title: '剪译',
    emptyTitle: '复制任意文本即可翻译',
    emptyBody: '在其他应用里按 Ctrl+C,译文会自动出现在这里。',
    sourceLabel: '原文',
    translationLabel: '译文',
    tabCurrent: '当前',
    tabHistory: '历史',
    actionTranslateNow: '立即翻译剪贴板',
    actionRetranslate: '重译',
    actionCopy: '复制译文',
    actionSwapDirection: '对调方向',
    actionPin: '收藏',
    collapse: '折叠',
    expand: '展开',
    hide: '隐藏浮层',
    settings: '设置',
    providerMissing: '尚未配置翻译服务',
    providerMissingAction: '去配置',
    listening: '监听中',
    paused: '已暂停',
    clickThroughHint: '鼠标穿透已开启:请从托盘菜单关闭。',
    phasePlanned: '剪贴板监听已经生效,LLM 翻译将在下一步接入。',
    historyEmpty: '暂无历史记录',
    phase: {
      idle: '空闲',
      translating: '翻译中',
      done: '已完成',
      error: '出错',
      skipped: '已跳过',
      canceled: '已取消',
      unconfigured: '未配置'
    }
  },
  activity: {
    accepted: '已捕获 {{count}} 字符',
    skipped: '已跳过:{{reason}}',
    idle: '等待复制',
    reasons: {
      disabled: '监听已暂停',
      empty: '内容为空',
      'too-short': '内容过短',
      'too-long': '内容过长',
      'single-token': '单个词或数字',
      'ignored-pattern': '命中忽略规则',
      'same-as-last': '与上次内容相同',
      'self-write': '应用自身写入'
    }
  },
  tray: {
    showOverlay: '显示浮层',
    hideOverlay: '隐藏浮层',
    translateNow: '立即翻译剪贴板',
    watching: '监听剪贴板',
    clickThrough: '鼠标穿透',
    openLogFolder: '打开日志目录',
    quit: '退出'
  },
  settings: {
    title: '设置',
    tabs: {
      general: '通用',
      clipboard: '剪贴板',
      providers: '翻译服务',
      prompt: '提示词',
      glossary: '术语表',
      shortcuts: '快捷键',
      about: '关于'
    },
    general: {
      appearance: '外观',
      theme: '主题',
      themeSystem: '跟随系统',
      themeLight: '浅色',
      themeDark: '深色',
      uiLanguage: '界面语言',
      uiLanguageSystem: '跟随系统',
      behavior: '行为',
      closeToTray: '关闭浮层时保留在托盘',
      closeToTrayHint: '关闭后应用继续监听剪贴板,从托盘可重新打开浮层。',
      launchAtLogin: '开机自动启动',
      launchAtLoginHint: '开机后静默启动并监听剪贴板。',
      historyLimit: '历史记录上限',
      historyLimitHint: '超出后自动删除最旧的非收藏记录。',
      rerunOnboarding: '重新运行初始向导',
      rerunOnboardingHint: '重新配置翻译方向与翻译服务。'
    },
    clipboard: {
      watch: '监听剪贴板',
      watchHint: '暂停后复制的内容不会被翻译。',
      pollInterval: '检测间隔',
      pollIntervalHint: '越短越灵敏,越长越省电。Windows 上 400ms 足够。',
      minChars: '最短长度',
      minCharsHint: '短于此长度的内容会被忽略。',
      maxChars: '最长长度',
      maxCharsHint: '超长内容会被跳过(截断会产生错误译文)。',
      skipSingleToken: '跳过单个词/数字',
      skipSingleTokenHint: '开启后,复制单个短词或纯数字不会触发翻译。',
      ignorePatterns: '忽略规则(正则)',
      ignorePatternsHint: '匹配的内容不会发送给翻译服务。',
      addPattern: '添加规则',
      patternInvalid: '正则表达式无效',
      suggested: '常用规则',
      cache: '复用相同文本的译文',
      cacheHint: '24 小时内复制同一段文本直接使用上次译文,不消耗额度。',
      debugLog: '记录 LLM 请求日志',
      debugLogHint: '将请求与响应写入日志目录,便于排查问题。'
    },
    providers: {
      description: '选择翻译服务并填写凭据。API Key 只会保存在本机,不会经过界面进程。',
      active: '当前使用',
      none: '未配置',
      use: '设为当前',
      delete: '删除',
      deleteConfirm: '确定删除这个配置？',
      newProfile: '新增配置',
      editing: '正在编辑',
      label: '配置名称',
      labelPlaceholder: '例如:公司代理',
      labelHint: '仅用于区分同一服务的多个配置。',
      baseUrl: 'API 地址',
      baseUrlPlaceholder: '留空则使用默认地址',
      apiKey: 'API Key',
      apiKeyPlaceholder: '粘贴 API Key',
      apiKeyStored: '已保存密钥',
      apiKeyLocal: '本地服务不需要密钥',
      revealKey: '显示已保存的密钥',
      hideKey: '隐藏',
      model: '模型',
      modelPlaceholder: '例如 deepseek-chat',
      fetchModels: '拉取模型',
      fetching: '拉取中…',
      filterModels: '筛选模型',
      save: '保存配置',
      saving: '保存中…',
      test: '测试连接',
      testing: '测试中…',
      testOk: '连接正常（{{ms}} ms）',
      testFailed: '连接失败',
      testHint: '测试会请求模型列表，只验证地址与密钥，不消耗额度。',
      docs: '获取 API Key',
      noProfiles: '该服务还没有配置，填写下面的表单并保存即可开始使用。',
      errors: {
        unconfigured: '尚未选择翻译服务。',
        auth: 'API Key 被拒绝，请检查密钥。',
        'rate-limit': '请求过于频繁，请稍后再试。',
        timeout: '请求超时，请检查网络或代理。',
        server: '服务端返回错误，请稍后再试。',
        network: '无法连接到该地址，请检查 API 地址与网络。',
        'bad-response': '返回内容无法解析，请确认 API 地址与模型名称。',
        canceled: '请求已取消。',
        unknown: '发生未知错误。'
      }
    },
    prompt: {
      planned: '提示词编辑页计划在第二阶段实现。'
    },
    glossary: {
      planned: '术语表编辑页计划在第二阶段实现。'
    },
    shortcuts: {
      planned: '快捷键配置页计划在第二阶段实现。默认不注册任何全局快捷键。'
    },
    about: {
      version: '版本',
      platform: '平台',
      electron: 'Electron',
      arch: '架构',
      dataFolder: '数据目录',
      logFolder: '日志目录',
      openFolder: '打开',
      capabilities: '系统能力',
      tray: '系统托盘',
      keyring: '系统密钥环',
      globalShortcut: '全局快捷键',
      available: '可用',
      unavailable: '不可用',
      limited: '受限',
      keyringMissingHint: '当前系统没有可用的密钥环,API Key 将以 base64 明文存储。',
      trayMissingHint: '当前环境没有系统托盘,浮层与设置窗口仍然可用。',
      shortcutLimitedHint: '当前会话不支持可靠的全局快捷键(Wayland/WSLg),请用托盘或浮层按钮触发。'
    }
  },
  onboarding: {
    planned: '初始向导将在下一步实现。届时会在这里选择翻译方向与翻译服务。',
    title: '欢迎使用剪译',
    skip: '跳过',
    finish: '完成'
  }
}

export type LocaleResource = typeof zhCN
