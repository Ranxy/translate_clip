# TranslateClip 设计方案

> 剪贴板监听 → LLM 翻译 → 常驻置顶浮层
> 第一期交付平台:**Windows + Linux**;架构预留 macOS(第三期)
> 开发环境:WSL2 (Arch) + WSLg;Windows 侧由用户自行验证

---

## 0. 命名与已确认决策

| 项 | 取值 | 状态 |
| --- | --- | --- |
| 项目目录 | `translate_clip` | 已定 |
| 产品名 (productName) | `TranslateClip` | ✅ 已确认 |
| 中文显示名 | `剪译` | ✅ 已确认 |
| appId | `com.ranxy.translateclip` | ✅ 已确认 |
| 包管理器 | `npm`(与 eve-babel 一致,规避 pnpm 11 的 build script 审批) | 已定 |
| 首次运行 | **引导向导**:先让用户配置翻译方向(必做)+ Provider(可跳过),再进入常规使用(§6.3) | ✅ 已确认 |
| 默认快捷键 | **默认不注册任何全局快捷键**(`shortcuts` 两项均为 `null`),由用户在设置页/向导里录制 | ✅ 已确认 |
| 历史上限 / 缓存 | 500 条 / 24h | ✅ 已确认 |
| CI | 附加 GitHub Actions `windows-latest` 出包 workflow | ✅ 已确认 |

其余所有"可调但不确定"的点都不做成硬编码:一律落进配置模型(§5.8),给保守默认值 + 设置页可改。

> **"默认不注册快捷键"带来的架构约束(重要)**
> 快捷键不再是兜底触发手段,因此触发入口必须是"不依赖快捷键也永远可达"的三条路径:
> 1. **复制即自动翻译**(主路径,默认开);
> 2. **浮层内按钮**——空态给出「立即翻译剪贴板」,完成态给出「重译」;
> 3. **托盘菜单**——「显隐浮层 / 立即翻译剪贴板 / 暂停监听」。
>
> 另外,鼠标穿透(`clickThrough`)开启后浮层不可点,只能靠托盘关闭 —— 所以托盘不可用的环境(WSLg)下**默认不自动开启穿透**,并且开启穿越时必须发一次系统通知告知关闭方式。

---

## 1. 需求与范围

### 1.1 已确认需求

| # | 需求 | 确认结果 |
| --- | --- | --- |
| 1 | 多平台 | 一期 Windows + Linux;macOS 架构预留 |
| 2 | 核心功能 | 监听剪贴板并翻译 |
| 3 | 浮层 | 屏上最上层浮层 |
| 4 | 观感 | 美观、现代、样式尽量精简 |
| 5 | 翻译 | LLM 翻译,provider 可配置(参考 eve-babel) |
| 6 | 一期平台 | Windows + Linux |

### 1.2 你补充确认的决策

- **触发方式**:复制即自动翻译(可整体开关监听)。
- **浮层形态**:**常驻置顶小窗**(非"按需弹出后自动隐藏")。
- **技术栈**:沿用 eve-babel 方案 —— Electron + electron-vite + React + TS + Tailwind v4,组件手写(不引入 shadcn/Radix)。
- **持久化**:要历史记录,用 **sql.js**(纯 wasm,免原生编译)。
- **语言方向**:自动检测源语言 + 智能互译(源文已是目标语言则反向翻)。
- **一期功能集**:一键复制译文/回写剪贴板、设置窗口(Provider/语言/快捷键/开机自启)、术语表、托盘图标 + 主窗口隐藏、深浅色跟随系统、i18n(中/英)。
- **Provider**:OpenAI / DeepSeek / OpenRouter / 自定义 OpenAI 兼容 + **Ollama(本地)**。
- **产品命名**:`TranslateClip` / 中文 `剪译`,appId `com.ranxy.translateclip`。
- **快捷键**:默认**不注册**任何全局快捷键,由用户自行录制(托盘 + 浮层按钮必须覆盖全部核心操作)。
- **首次运行**:弹出引导向导,让用户配置翻译方向(必做)、Provider(可跳过)、系统集成项。
- **历史上限 / 缓存**:500 条 / 24h。
- **CI**:附加 GitHub Actions workflow,在 `windows-latest` 出 Windows 包(本地 `dist:win` 同样保留)。
- **构建**:Linux 侧我负责开发验证,Windows 安装包你在 Windows 上自行验证(因此不以 wine 交叉构建为前提,提供 `dist:win` 脚本)。

### 1.3 非目标(一期不做)

- OCR、划词/取词、TTS 朗读、PDF/文档批量翻译。
- 云同步、多用户、账号体系。
- macOS 与 Linux Wayland 原生(非 XWayland)的完整适配。
- 插件/扩展系统。

---

## 2. 关键技术决策与取舍

| 决策点 | 选择 | 理由 / 被否方案 |
| --- | --- | --- |
| 剪贴板变更检测 | **主进程轮询 `clipboard.readText()`**(默认 400ms) | Electron 无剪贴板变更事件。原生方案(`AddClipboardFormatListener` / X11 selection owner)必须编译 native addon,破坏跨平台与"免 rebuild"打包。轮询 400ms 的开销实际可忽略(一次系统调用 + 一次哈希)。 |
| 剪贴板读写落点 | 全部在**主进程**,渲染进程不直接碰剪贴板 | 渲染进程读剪贴板在窗口失焦时有平台限制;主进程统一处理才能做去重/自写抑制。 |
| 浮层实现 | `transparent + frame:false + alwaysOnTop + skipTaskbar`,CSS 圆角玻璃拟态 | Windows 上 `transparent:true` 会禁用 DWM 阴影与最大化,这对小浮层无影响。 |
| 置顶层级 | Windows:`setAlwaysOnTop(true,'screen-saver')`;mac:`setVisibleOnAllWorkspaces` | 独占全屏的 DirectX 游戏无法被任何窗口覆盖 —— 需用户把游戏设为"无边框窗口",文档中明示。 |
| 数据库 | **sql.js**(wasm) | 用户选定。取舍:写操作需要导出整个 DB → 用**写回延迟合并**(§5.7)缓解。备选 better-sqlite3 需各平台 rebuild。 |
| 配置存储 | `config.json`(设置 + 术语表),`data.sqlite`(Provider profile + 历史) | 与 eve-babel 的职责划分完全一致,便于复用其 `ConfigStore` / `LlmConfigStore` 与迁移逻辑。 |
| API Key | `safeStorage` 加密;Linux 无密钥环时退化为 base64 并**在设置页显式告警** | 沿用 eve-babel 实现。绝不静默假装安全。 |
| 请求策略 | **latest-wins**:新剪贴板内容到达即 abort 上一个在途请求 | 剪贴板场景不存在"排队"语义,串行队列只会让用户看到过期译文。 |
| 流式输出 | 一期**非流式**,`streamEnabled` 预留开关(二期) | 非流式实现简单、错误路径清晰;单条文本的流式改造只在 `llmClient` 内,不扩散。 |
| 翻译结果格式 | 让 LLM 返回 `{detectedLanguage, translatedText}` JSON,解析失败则**整体回落为纯文本** | 一次调用同时完成"检测 + 翻译",省一次请求;宽松解析保证模型不听话时仍可用。 |
| i18n | 渲染进程 `i18next` + `react-i18next`;主进程用共享 locale 模块 + 30 行 `translate()` | 不把 i18next 拉进主进程 bundle,托盘菜单文案仍可中英切换。 |
| 进程安全 | `contextIsolation:true`、`nodeIntegration:false`、`sandbox:true`,渲染进程只经 preload 白名单 IPC | preload 仅用 `ipcRenderer`,可安全开启 sandbox。 |
| 单实例 | `requestSingleInstanceLock()`,第二实例聚焦浮层 | 避免重复监听剪贴板、重复托盘图标。 |

---

## 3. 架构总览

### 3.1 进程与模块

```
┌──────────────────────────────── Main Process (Node) ────────────────────────────────┐
│                                                                                     │
│  main.ts ──┬─→ windowManager ──────→ overlayWindow / settingsWindow                  │
│            ├─→ trayController ─────→ 托盘菜单(显隐/暂停/设置/退出)                 │
│            ├─→ shortcutManager ────→ globalShortcut(显隐浮层 / 立即翻译)            │
│            ├─→ autoLaunch ─────────→ setLoginItemSettings / ~/.config/autostart      │
│            └─→ ipcRouter ──────────→ 全部 IPC handler                                │
│                                                                                     │
│  ┌── 采集层 ──────────────┐   ┌── 决策层 ───────────────┐   ┌── 执行层 ──────────┐ │
│  │ clipboardWatcher       │   │ languageDetector        │   │ llmClient          │ │
│  │  · 轮询 + 签名比对     │──→│  · 脚本判定 + 方向决策  │──→│  · provider 调用   │ │
│  │  · 自写抑制            │   │ promptBuilder           │   │  · 超时/重试/abort │ │
│  │ clipboardFilter        │   │  · 模板 + 术语表注入    │   │ translationQueue   │ │
│  │  · 空/超长/正则/单token│   └─────────────────────────┘   │  · latest-wins     │ │
│  └────────────────────────┘                                 └────────┬───────────┘ │
│                                                                      ↓             │
│  ┌── 持久化 ───────────────────────────────────────────────────────────────────────┐ │
│  │ configStore (config.json)   llmConfigStore (data.sqlite: profiles)              │ │
│  │ historyRepository (data.sqlite: translations)   glossary (config.json)          │ │
│  │ credentialStore (safeStorage)   windowStateStore (window-state.json)            │ │
│  └─────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬──────────────────────────────────────────────────────┘
                               │ IPC (contextBridge, 白名单)
┌──────────────────────────────┴──────────────── Renderer (React + Tailwind) ─────────┐
│  overlay view(浮层:当前 / 历史)        settings view(设置:通用/剪贴板/Provider/     │
│  · 原文 · 译文 · 状态 · 操作按钮        提示词/术语表/快捷键)                        │
│  · 折叠态 · 鼠标穿透 · 透明度 · 拖动                                                │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 核心数据流(一次翻译)

```
用户在其他应用里 Ctrl+C
   │
   ├─ clipboardWatcher(≤400ms 内) 读取文本
   │     ├─ 签名与上次相同? ────────────────→ 丢弃
   │     ├─ 命中自写抑制窗口? ──────────────→ 丢弃(我们刚写回的译文)
   │     └─ clipboardFilter:空/超长/正则/单 token → 丢弃(记录 skip 原因,可选日志)
   │
   ├─ languageDetector:脚本判定源语言 → 解析方向(目标 or 反向回落语言)
   ├─ historyRepository.findCached(sourceHash, direction) 命中 → 直接出结果(0 token)
   │
   ├─ 立即向浮层广播 {status:'translating', sourceText, direction}
   │
   ├─ translationQueue.submit(job):abort 在途请求 → llmClient.translate()
   │     └─ POST {baseUrl}/chat/completions(model, temperature, system=prompt+glossary, user=源文)
   │
   ├─ 解析 {detectedLanguage, translatedText}
   ├─ historyRepository.insert/update(含耗时、provider、model、token 用量若有)
   └─ 广播 {status:'done', translatedText} → 浮层渲染;复制按钮可回写剪贴板
```

### 3.3 目录结构

```
translate_clip/
├─ package.json / package-lock.json
├─ tsconfig.json                     # 单 tsconfig(含 main+renderer+config,与 eve-babel 同款)
├─ electron.vite.config.ts           # main / preload(cjs) / renderer 三段
├─ electron-builder.yml
├─ .gitignore
├─ .github/workflows/build-windows.yml   # 可选(mirror eve-babel)
├─ docs/DESIGN.md                    # 本文档
├─ resources/
│  ├─ icons/{icon.png,icon.ico,icon.icns}
│  └─ tray/{tray.png,tray.ico,trayTemplate.png}
└─ src/
   ├─ shared/
   │  ├─ types.ts                    # 全部跨进程类型 + IPC 契约
   │  ├─ constants.ts                # 默认配置、限制值
   │  ├─ languages.ts                # 语言目录(BCP-47)+ 脚本区间表
   │  └─ locales/{zh-CN.ts,en.ts}    # 主/渲染进程共用文案
   ├─ main/
   │  ├─ main.ts                     # 生命周期 + App 编排 + IPC 注册
   │  ├─ preload.ts                  # contextBridge 暴露 window.translateClip
   │  ├─ i18n.ts                     # 主进程轻量 t()
   │  ├─ ipc/ipcRouter.ts            # channel → handler 映射
   │  ├─ services/
   │  │  ├─ configStore.ts           # config.json(含 sanitize)
   │  │  ├─ credentialStore.ts       # safeStorage 封装
   │  │  ├─ llmProviderCatalog.ts    # openai/deepseek/openrouter/ollama/custom
   │  │  ├─ llmConfigStore.ts        # data.sqlite: llm_provider_profiles
   │  │  ├─ llmClient.ts             # chat/completions 调用 + 解析
   │  │  ├─ llmDebugLogger.ts        # 可选请求/响应落盘
   │  │  ├─ clipboardWatcher.ts      # 轮询 + 签名字典
   │  │  ├─ clipboardFilter.ts       # 纯函数过滤链
   │  │  ├─ languageDetector.ts      # 纯函数脚本判定
   │  │  ├─ promptBuilder.ts         # 纯函数 prompt 组装
   │  │  ├─ translationQueue.ts      # latest-wins 调度
   │  │  ├─ historyRepository.ts     # data.sqlite: translations + 缓存
   │  │  ├─ glossaryStore.ts         # 术语表 CRUD(落 config.json)
   │  │  ├─ windowManager.ts         # 浮层/设置窗创建、几何、置顶、穿透
   │  │  ├─ windowStateStore.ts      # 窗口位置持久化
   │  │  ├─ trayController.ts        # 托盘(带 try/catch 降级)
   │  │  ├─ shortcutManager.ts       # globalShortcut + 冲突检测
   │  │  ├─ autoLaunch.ts            # 开机自启(Win/mac API + Linux .desktop)
   │  │  └─ logStore.ts              # 运行日志(滚动文件)
   │  └─ utils/{hash.ts,paths.ts,atomicWrite.ts}
   └─ renderer/
      ├─ index.html                  # 单入口,按 ?view= 分流
      ├─ main.tsx
      ├─ App.tsx                     # 读 ?view → 渲染 OverlayView / SettingsView
      ├─ tailwind.css                # design tokens + @theme 映射
      ├─ i18n/index.ts
      ├─ hooks/{useBootstrap.ts,useTranslationStream.ts,...}
      ├─ store/appStore.ts
      └─ components/
         ├─ overlay/{OverlayShell,TranslationCard,HistoryPanel,StatusBar,CollapsedBar}.tsx
         ├─ settings/{SettingsShell,GeneralPage,ClipboardPage,ProvidersPage,PromptPage,GlossaryPage,ShortcutPage}.tsx
         └─ ui/{Button,Field,Switch,Tabs,Toast,ScrollArea,Modal}.tsx   # 手写,~8 个基础件
```

---

## 4. 单入口多视图(沿用 eve-babel 骨架)

`index.html` 只有一个;`main.tsx` 由 URL query 决定渲染哪个视图:

```ts
// main.ts → windowManager.loadRendererView(win, 'overlay')
// dev : `${ELECTRON_RENDERER_URL}?view=overlay`
// prod: loadFile('out/renderer/index.html', { query: { view: 'overlay' } })
```

`App.tsx` 依据 `new URLSearchParams(location.search).get('view')` 分流为 `overlay` / `settings`。
好处:一份 Tailwind 产物、一份 preload、一套 i18n;三个窗口不重复打包。

---

## 5. 核心模块设计

### 5.1 clipboardWatcher(采集层核心)

```ts
interface ClipboardAdapter {           // 依赖注入,便于单测
  readText(): string
  writeText(text: string): void
}

class ClipboardWatcher {
  constructor(
    private readonly adapter: ClipboardAdapter,     // 生产:electron.clipboard
    private readonly options: {
      pollIntervalMs: number
      selfWriteWindowMs: number                     // 默认 1500
      enabled: () => boolean                        // 读实时配置
    },
    private readonly onCandidate: (text: string) => void
  ) {}

  start(): void
  stop(): void
  flushNow(): string | null              // 快捷键"立即翻译"用:跳过节流
  writeSuppressed(text: string): void    // 我们主动写剪贴板前登记签名
}
```

**算法**

1. `setInterval(pollIntervalMs)`,每次 `const text = adapter.readText()`。
2. `sig = fnv1a64(text)` + `text.length`;与 `lastSig` 相同 → 直接返回(绝不做全串比较)。
3. 自写抑制:若 `sig` 在 `recentSelfWrites` 中且 `now - at < selfWriteWindowMs` → 更新 `lastSig` 并丢弃。`recentSelfWrites` 为最多 8 条的 LRU。
4. 通过则更新 `lastSig`,回调 `onCandidate(text)`。
5. `stop()` 清 interval;`enabled()` 为 false 时不读剪贴板(暂停监听,托盘可切)。

**边界与平台差异**

- 轮询间隔由配置控制(200–2000ms,默认 400ms)。间隔越短延迟越低、越耗电;文档给出默认即够用。
- 图片/文件/HTML 一律**忽略**(只 `readText()`),不做富文本处理。
- **Wayland 原生**:部分合成器只允许聚焦的客户端读剪贴板 → 浮层失焦时可能读不到。一期以 X11/XWayland 为准(WSLg 走的正是这条),文档明示;二期再评估 `wl-paste` 辅助进程。
- **Linux 空选择**:X11 下剪贴板所有者退出后 `readText()` 可能返回空 → 空串直接跳过,不清空 `lastSig`。
- 应用自身退出/暂停时不写回,不影响系统剪贴板。

### 5.2 clipboardFilter(纯函数过滤链)

```ts
type FilterVerdict =
  | { accept: true; normalized: string }
  | { accept: false; reason: 'empty' | 'too-short' | 'too-long' | 'single-token' | 'ignored-pattern' | 'same-as-last' }

function filterClipboardText(raw: string, ctx: FilterContext): FilterVerdict
```

按序执行:

1. **归一化**:统一 `\r\n`→`\n`、去首尾空白、折叠 3+ 连续空行为 1 个空行、去行尾空白。
2. `empty`:归一化后为空 / 纯空白。
3. `too-short`:`length < minSourceChars`(默认 2)。
4. `too-long`:`length > maxSourceChars`(默认 5000) → 丢弃并在浮层状态条提示"内容过长已跳过"(不截断翻译,截断会产出错误译文)。
5. `single-token`:`skipSingleToken` 开启(默认**关**)且文本无空白、无 CJK、长度 < 3 → 丢弃(典型是复制数字/短 ID)。
6. `ignored-pattern`:逐条 `new RegExp(pattern)`(编译失败的正则在保存时已拒绝),命中即丢弃。默认给 2 条示例但**不默认启用**。
7. `same-as-last`:与上一次**已接受**文本的哈希相同 → 丢弃。

正则编译结果缓存在 `Map<string, RegExp>`,配置变更时重建。

### 5.3 languageDetector(检测 + 方向决策)

```ts
function detectLanguage(text: string): { code: string; confidence: number; script: ScriptFamily }
function resolveDirection(
  detected: string,
  cfg: { directionMode: 'auto' | 'fixed'; targetLanguage: string; fallbackLanguage: string }
): { source: string; target: string; reversed: boolean }
```

**检测规则**(按 Unicode 脚本占比,纯本地、零成本):

| 条件 | 判定 |
| --- | --- |
| 含平假名/片假名 (`\u3040-\u30ff`) | `ja` |
| 含谚文 (`\uac00-\ud7af`) | `ko` |
| 汉字 (`\u4e00-\u9fff`) 占比 ≥ 20% 且无假名 | `zh`(简体/繁体:用一个小型繁简特征字表区分 `zh-TW` / `zh-CN`,置信度低时归 `zh-CN`) |
| 西里尔 (`\u0400-\u04ff`) | `ru` |
| 阿拉伯 (`\u0600-\u06ff`) | `ar` |
| 天城文 / 泰文 / 希伯来文 | `hi` / `th` / `he` |
| 其余(拉丁为主) | `latin`(具体语种交由 LLM 判定) |

**方向决策**

- `directionMode: 'fixed'` → 永远 `targetLanguage`。
- `directionMode: 'auto'`(默认):若 `baseLang(detected) === baseLang(targetLanguage)` → 目标改为 `fallbackLanguage`(`reversed: true`);否则目标为 `targetLanguage`。
  - 默认 `targetLanguage = zh-CN`、`fallbackLanguage = en-US` ⇒ 天然实现"中文→英文、其它→中文"。
- 检测不确定(`latin` / 低置信度)时**仍按 `targetLanguage` 走**,并把判断权交给 LLM(响应里的 `detectedLanguage` 会回填,用于 UI 显示与历史记录)。
- UI 展示 `EN → 中文` 的徽标,并提供"对调方向"快捷键(仅本次生效,不改配置)。

### 5.4 promptBuilder

```ts
function buildSystemPrompt(cfg: AppConfig, direction: Direction, terms: MatchedTerm[]): string
function buildUserMessage(text: string): string   // 纯文本,不再 JSON 打包(单条翻译无需批量协议)
```

- 模板 `translationPrompt` 支持变量:`{{targetLanguage}}`、`{{sourceLanguage}}`。
- 默认模板(可被用户覆盖):

  > You are a professional translator. Translate the user's text into {{targetLanguage}}.
  > Preserve names, numbers, units, code identifiers, URLs and markdown structure.
  > Keep the original line breaks and paragraph structure. Do not add explanations.
  > Respond with JSON only: {"detectedLanguage":"<BCP-47>","translatedText":"<translation>"}

- **术语表注入**:只注入与 `targetLanguage` 相关且源文实际命中的条目(子串匹配,`toLowerCase` 归一),按源词长度降序、上限 `glossaryMaxTerms`(默认 30),格式 `` `source` → target ``;明确"必须使用给定译法"。
- **不用 JSON 打包源文**:单条翻译把源文直接作为 user message,减少 token 与转义风险。

### 5.5 llmClient

```ts
interface TranslateRequest {
  text: string
  direction: Direction
  profile: { providerId: LlmProviderId; apiBaseUrl: string; modelName: string }
  apiKey: string | null
  prompt: string
  signal: AbortSignal
}
interface TranslateResult {
  translatedText: string
  detectedLanguage: string | null
  usage: { promptTokens?: number; completionTokens?: number } | null
  latencyMs: number
}
```

- 端点:`POST {baseUrl 去尾斜杠}/chat/completions`,Header `Authorization: Bearer <key>`(**Ollama 无 key 时不发送该 Header**)。
- Body:`{ model, temperature: cfg.temperature (默认 0.2), stream: false, messages: [system, user] }`。
- **响应解析(关键路径,必须宽容)**:
  1. `choices[0].message.content` 兼容 `string` 与 `Array<{type,text}>` 两种形态(部分网关返回数组)。
  2. 去 ```json 围栏 → `JSON.parse`;失败则取首 `{` 到末 `}` 再 parse;再失败则**把整段文本当作译文**(`detectedLanguage: null`)。三层回落,保证任何不听话的模型都能出结果。
  3. `translatedText` 为空 → 视为失败并抛错。
- **错误分类**(决定 UI 文案,均带可操作提示):
  `unconfigured`(无激活 profile / 缺 key)、`auth`(401/403)、`rate-limit`(429)、`timeout`、`server`(5xx)、`network`、`bad-response`。
- **超时**:`AbortSignal.any([外部 signal, AbortSignal.timeout(cfg.requestTimeoutMs)])`。
- **重试**:仅对 `rate-limit`/`server`/`network`/`timeout` 重试,最多 `retryCount`(默认 2),退避 600ms → 1800ms;被 abort 不重试。
- **可观测**:`llmDebugEnabled` 时把 request/response/error 写 `userData/logs/llm/*.json`(Authorization 打码),设置页可一键打开目录。

### 5.6 translationQueue(latest-wins)

```ts
type TranslationState =
  | { kind: 'idle' }
  | { kind: 'translating'; jobId: string; sourceText: string; direction: Direction; startedAt: number }
  | { kind: 'done'; jobId: string; result: TranslateResult; historyId: string }
  | { kind: 'error'; jobId: string; error: LlmError; retryable: boolean }
```

- `submit(job)`:若已有在途请求 → `controller.abort()`(状态标 `canceled`,**不写错误历史**) → 发起新请求。任何时刻最多 1 个在途 + 0 个排队。
- `retranslateLast()`:用同一个 `sourceText`/`direction` 重跑(绕过缓存,`forceRefresh`)。
- `cancel()`:托盘/设置里"停止当前翻译"。
- 每次状态变化向所有窗口广播 `translation:state`;`done` 时附带 `historyId`。
- **缓存命中**发生在 `submit` 之前(§5.7),命中则状态直接 `done`,并标记 `cached: true`(UI 显示"缓存")。

### 5.7 historyRepository(sql.js)

**表结构**

```sql
CREATE TABLE IF NOT EXISTS llm_provider_profiles (      -- 与 eve-babel 同构
  profile_id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, api_base_url TEXT NOT NULL,
  model_name TEXT NOT NULL, custom_label TEXT, encrypted_api_key TEXT,
  is_active INTEGER NOT NULL DEFAULT 0, is_selected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS translations (
  id TEXT PRIMARY KEY,
  source_text TEXT NOT NULL,
  source_hash TEXT NOT NULL,          -- fnv1a64,用于去重/缓存
  translated_text TEXT,
  detected_language TEXT,
  source_language TEXT NOT NULL,
  target_language TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  status TEXT NOT NULL,               -- translating | done | error
  error_code TEXT,
  error_message TEXT,
  cached INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  char_count INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_created ON translations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tx_hash    ON translations(source_hash, target_language);
```

术语表沿用 eve-babel 的形态(`{id, notes, terms: Record<lang, string[]>}`)存在 `config.json` 里 —— 条目量小、需要人肉可读/可导入导出,不值得进 DB。

**API**

```ts
insertPending(input): string                       // 先落 status='translating',让浮层立刻可见
complete(id, result): void
fail(id, error): void
findCached(sourceHash, targetLanguage, maxAgeMs): TranslationRecord | null
list({ query?, cursor?, limit, onlyPinned? }): { items: TranslationRecord[]; hasMore: boolean }
togglePin(id): void
remove(id): void
clear({ keepPinned: true }): number
prune(): number                                    // 超出 historyLimit 删最旧的非 pinned
```

- 搜索用 `LIKE '%q%'`(对 `source_text` / `translated_text`)。**不引入 FTS5**:sql.js 构建是否含 FTS5 不稳定,LIKE 在 ≤5000 条量级下毫秒级返回。
- 缓存策略:`translationCacheEnabled`(默认开)且 `maxAgeMs` 默认 24h 且同一 `(sourceHash, targetLanguage)` → 命中后直接复用译文,`cached=1`。剪贴板场景重复复制同一段文本非常常见,这一步省掉大量 token。

**持久化策略(sql.js 的关键取舍)**

- 所有写操作只改内存 DB,然后 `schedulePersist()`:debounce **1500ms** + 最多 5s 强制落一次(`maxWait`)。
- 落盘用 **原子写**:`data.sqlite.tmp` → `rename()`;失败重试一次,再失败写入 `data.sqlite.corrupt.<ts>` 并重建空库 + 记日志(不静默丢数据)。
- `before-quit` / 设置类写操作(profile、pin、clear)走 `flushNow()` 立即落盘。
- `prune()` 在每次 `insertPending` 后按 `historyLimit`(默认 500)裁剪,防止 DB 无界增长导致每次导出的体积线性变大。
- `sql.js` 的 wasm 定位沿用 eve-babel 的 `createRequire` + `require.resolve('sql.js/dist/sql-wasm.wasm')`;若打包后 asar 内加载异常,追加 `asarUnpack: ["**/node_modules/sql.js/dist/*.wasm"]` 作为兜底(实现时验证)。

### 5.8 configStore(config.json)

```ts
interface AppConfig {
  // 外观 / 界面 / 首次运行
  uiLanguage: 'system' | 'zh-CN' | 'en'          // 默认 system
  theme: 'system' | 'light' | 'dark'             // 默认 system
  onboardingCompleted: boolean                   // 默认 false → 首次启动弹引导向导(§6.3)

  // 剪贴板
  clipboardWatchEnabled: boolean                 // 默认 true
  pollIntervalMs: number                         // 默认 400,范围 200–2000
  minSourceChars: number                         // 默认 2
  maxSourceChars: number                         // 默认 5000,范围 10–50000
  skipSingleToken: boolean                        // 默认 false
  ignorePatterns: string[]                       // 默认 []

  // 翻译
  directionMode: 'auto' | 'fixed'                // 默认 auto
  targetLanguage: string                         // 默认 zh-CN
  fallbackLanguage: string                       // 默认 en-US
  translationPrompt: string                      // 默认见 §5.4
  temperature: number                            // 默认 0.2
  requestTimeoutMs: number                       // 默认 30000
  retryCount: number                             // 默认 2
  streamEnabled: boolean                         // 默认 false(二期)
  translationCacheEnabled: boolean               // 默认 true
  cacheTtlHours: number                          // 默认 24
  glossaryEnabled: boolean                       // 默认 true
  glossaryMaxTerms: number                       // 默认 30
  glossary: GlossaryEntry[]

  // 浮层
  overlay: {
    width: number                                // 默认 380
    height: number                               // 默认 520
    opacity: number                              // 默认 0.96,范围 0.6–1
    opaque: boolean                              // 默认 false(false=透明玻璃态;true=不透明纯色,规避 §12-6 的驱动问题)
    fontSize: number                             // 默认 14(11–20)
    collapsed: boolean                           // 默认 false
    clickThrough: boolean                        // 默认 false(鼠标穿透)
    autoCollapseOnIdle: boolean                  // 默认 false
  }

  // 系统集成
  shortcuts: {
    toggleOverlay: string | null                 // 默认 null(不注册)
    translateClipboard: string | null            // 默认 null(不注册)
  }
  launchAtLogin: boolean                         // 默认 false
  closeToTray: boolean                           // 默认 true
  notificationsEnabled: boolean                  // 默认 false(错误时系统通知)
  historyLimit: number                           // 默认 500
  llmDebugEnabled: boolean                       // 默认 false
  logLevel: 'error' | 'warn' | 'info' | 'debug'  // 默认 info
}
```

- 加载时 `sanitizeConfig()` 逐字段校验 + 夹取范围(非法值回默认,eve-babel 同款做法),损坏文件回默认并在日志中告警。
- 变更后主进程 `config:update` 广播 → 渲染进程即时更新;`clipboardWatcher` / `shortcutManager` / `windowManager` / `nativeTheme.themeSource` 都订阅同一事件做热应用,无需重启。
- `sanitizeConfig` 对 `shortcuts.*` 接受 `null` 为合法值(表示"不注册"),不强制回填默认加速键。
- `overlay.clickThrough` 在 `app:getPlatformCapabilities().tray === false` 的环境下不允许被设为 `true`(否则用户将失去唯一的关闭入口),设置页对应开关置灰并说明原因。

### 5.9 windowManager(浮层是该产品的门面)

**浮层窗口参数**

```ts
{
  width: 380, height: 520, minWidth: 300, minHeight: 200, maxHeight: 900,
  transparent: true, frame: false, resizable: true, maximizable: false,
  alwaysOnTop: true, skipTaskbar: true, show: false, hasShadow: false,
  backgroundColor: '#00000000',
  webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
}
```

- 置顶:`setAlwaysOnTop(true, 'screen-saver')`(Windows 上可压住大多数窗口);`setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`(mac)。
- **不抢焦点**:首次显示用 `showInactive()`;托盘/快捷键显隐时也优先 `showInactive()`(除非用户显式点"聚焦")。
- 位置:默认右下角(主显示器 `workArea` 内边距 24px),之后由 `windowStateStore` 记忆;恢复时用 `isVisibleOnAnyDisplay()` 夹回可见区域(处理显示器拔插)。
- 几何持久化:沿用 eve-babel 的 `move`/`resize` 180ms debounce 落盘。
- 高度:**默认固定**,内容内部滚动;渲染进程可经 `overlay:resizeBy(deltaY)` 请求微调(历史面板展开等场景复用 eve-babel 的 `resizeOverlayBody`)。
- **鼠标穿透**:`setIgnoreMouseEvents(true, { forward: true })`;开启后浮层不可交互,必须能从托盘/快捷键关掉 —— 因此穿透状态下快捷键显隐仍然有效,并且启用时用系统通知提示一次(避免"点不到又不知道怎么关")。
- 设置窗口:普通窗口(`frame: true`,720×760),`parent` 不设为浮层(浮层 `skipTaskbar` 且置顶,设为 parent 会有奇怪的 z-order 关系),模态性用 `show()` + `focus()` + 单实例复用实现。
- **引导窗口(onboarding)**:`?view=onboarding`,640×560、`resizable: false`、居中、`alwaysOnTop: false`、`skipTaskbar: false`、无边框(自带标题栏与关闭按钮)。首启自动打开;关闭窗口等价于"稍后再说"(`onboardingCompleted` 置 true,但 Provider 未配置 → 浮层进入 `unconfigured` 引导态)。可从设置页「通用 → 重新运行初始向导」再次打开。

### 5.10 trayController / shortcutManager / autoLaunch

**托盘**

- 菜单:显隐浮层 / 暂停监听(勾选) / 翻译当前剪贴板 / 折叠浮层(勾选) / 鼠标穿透(勾选) / 打开设置 / 打开数据目录 / 开机自启(勾选) / 关于 / 退出。
- 左键单击 → 显隐浮层;双击 → 打开设置。
- 图标:`process.platform === 'win32' ? tray.ico : tray.png`;mac 用 `trayTemplate.png`(第三期)。
- **必须 `try/catch`**:WSLg 无 StatusNotifier host,`new Tray()` 可能抛错或无图标 → 捕获后降级为"无托盘模式"(浮层+快捷键仍可用),并在设置页提示。这是 WSL 开发期的现实情况,不能让它阻塞启动。
- `closeToTray` 开启时,浮层的 ✕ 是"隐藏"而非销毁;真正退出只走托盘"退出"/`app.quit()`;`window-all-closed` 在 win/linux 下**不**退出(因为浮层可能只是隐藏了)。

**快捷键**

- `globalShortcut.register`;注册失败(被占用 / Wayland 不支持)返回原因 → 设置页红色提示"该组合键被占用"。
- 设置页的按键录制输入:捕获 `keydown` → 组装 accelerator → 调用 `shortcut:test` 做一次试注册校验。
- **默认两项都是 `null`**:启动时**不注册**任何全局加速键(你已确认)。用户录制成功后即时 `register`,录制为空则 `unregister`。
- 无快捷键时的等价入口:托盘「显隐浮层 / 立即翻译剪贴板」+ 浮层内按钮(§6.1 空态)。两者必须始终可用,这是默认配置下的唯一触发面。
- **Wayland/WSLg 限制**:Linux 上 `globalShortcut` 依赖 X11;WSLg 下仅对 WSL 内 X 应用生效,对 Windows 宿主应用无效 —— 一期以 Windows 为主战场,Linux 用户可退回"点浮层按钮/托盘菜单"触发。文档明示。

**开机自启**

- Windows/macOS:`app.setLoginItemSettings({ openAtLogin, args: ['--hidden'] })`。
- Linux:写/删 `~/.config/autostart/translate-clip.desktop`(`Exec=<AppImage 或可执行路径> --hidden`,`X-GNOME-Autostart-enabled=true`);AppImage 路径从 `process.env.APPIMAGE` 取。
- 带 `--hidden` 启动时不显示设置窗,只挂浮层 + 托盘。

---

## 6. UI / UX 设计

### 6.1 浮层(常驻置顶小窗,默认 380×520)

```
╭───────────────────────────────────────────────╮
│ ⣿ 剪译          [EN → 中]      ⚙  ⤢  ─  ✕   │  ← header:拖动区 / 方向徽标 / 按钮
├───────────────────────────────────────────────┤
│ 原文                                    3 行 ▾│  ← 可折叠,最多 3 行 + 渐隐
│ The quick brown fox jumps over the lazy dog…  │
├───────────────────────────────────────────────┤
│ 译文                                          │
│ 敏捷的棕色狐狸跳过了懒狗。                    │  ← 主体,可选中/滚动,字号可调
│                                               │
│                                               │
├───────────────────────────────────────────────┤
│ [复制译文] [重译] [收藏] [对调方向]  当前│历史 │  ← 操作区 + 视图切换
├───────────────────────────────────────────────┤
│ ● 已翻译 · deepseek / deepseek-chat · 0.8s    │  ← 状态条(可点击展开详情/错误)
╰───────────────────────────────────────────────╯
```

**状态机(浮层主体随翻译状态切换)**

| 状态 | 主体内容 |
| --- | --- |
| `idle` | 空态 + **「立即翻译剪贴板」按钮**(默认无快捷键时这是主要手动入口) |
| `translating` | 译文区骨架/微光动画 + 已显示原文 |
| `done` | 译文 + 耗时/provider/是否缓存徽标 |
| `cached` | 译文 + "缓存"徽标(无网络消耗) |
| `error` | 错误卡片:分类文案 + 可操作建议(如"去配置 API Key")+ 重试按钮 |
| `skipped` | "内容过长已跳过" / "命中忽略规则",不占主体,状态条轻提示 |
| `unconfigured` | 引导卡片 → 一键打开设置页的 Provider 页 |

**折叠态**:仅一行 —— `⣿ 剪译 | 译文首行… | ⌄`,双击 header 或点 `─` 切换;折叠态仍随翻译更新,是最不打扰的常驻形态。

**历史视图**:搜索框 + 列表(源文摘要 / 译文摘要 / 时间 / provider)+ 置顶筛选;条目操作:复制译文、重新翻译、置顶、删除;底部"清空历史(保留置顶)"。

**视觉语言(手写、精简,控制在 ~8 个基础组件)**

- 圆角 16px,1px 半透明描边,`backdrop-blur-xl`,浅色 `bg-white/70`、深色 `bg-neutral-900/70`。
- 单一强调色(Tailwind `sky`/`teal` 之一,定稿时选一个),其余全靠中性灰阶;不用渐变与阴影堆叠(eve-babel 的 token 体系里有一批很重的渐变,我们**只保留** `--panel-surface` / `--border` / `--text` / `--muted` / `--accent` 等必要 token)。
- 字号层级只用三档:12 / 14 / 16;间距用 4 的倍数。
- 动效:仅 `opacity` + `transform`,120–180ms `ease-out`;尊重 `prefers-reduced-motion`。
- 全站 `user-select: none`,但译文/原文/输入框 `user-select: text`。

### 6.2 设置窗口(720×760,左侧竖排 tab)

1. **通用** — UI 语言、主题、开机自启、关闭到托盘、历史上限、数据目录/日志目录入口。
2. **剪贴板** — 监听开关(暂停/恢复)、轮询间隔(滑块 + 说明延迟/CPU 取舍)、最小/最大长度、忽略正则(可增删 + 即时校验)、单 token 跳过、缓存开关 + TTL、LLM 调试日志。
3. **Providers** — 复用 eve-babel 的交互骨架:左侧 provider 列表(OpenAI / DeepSeek / OpenRouter / Ollama / 自定义),右侧 profile 表单(API Key 掩码显示 + 显示/隐藏切换、Base URL、模型下拉 + 搜索、`拉取模型`、`测试连接`、设为当前)。Ollama 分支不显示 Key 字段,默认 `http://localhost:11434/v1`。
4. **提示词** — 模板 textarea + 可用变量说明 + 右侧实时预览(用一段示例文本渲染最终 system prompt)。
5. **术语表** — 条目 CRUD(多语言 variants 逗号分隔 + notes)、搜索、JSON 导入/导出。
6. **快捷键** — 录制式输入 + 占用冲突提示 + 清除(不注册)+ 恢复默认(= 全部清空,因默认不注册)。
7. **关于** — 版本、开源许可、诊断信息(平台/Electron 版本/数据目录一键复制)、**重新运行初始向导**。

### 6.3 首次运行引导(onboarding,你已确认的入口体验)

**触发**:`config.onboardingCompleted === false` 时,首启流程为 —— 先创建浮层(让用户看到产品本体),随后打开引导窗口;引导完成后关闭引导,浮层进入正常可用状态。

**四步向导**(顶部步骤条,可「上一步」,每步可即时预览效果):

| 步骤 | 内容 | 是否必填 |
| --- | --- | --- |
| 1. 欢迎 + 翻译方向 | 选 `targetLanguage`(默认 zh-CN)、`fallbackLanguage`(默认 en-US)、`directionMode`(默认 auto);右侧实时预览规则,例如"非中文 → 中文;中文 → English" | **必填(你要求的方向配置在此完成)** |
| 2. 接入 LLM | Provider 五选一(OpenAI / DeepSeek / OpenRouter / Ollama / 自定义)+ API Key + Base URL + 模型(`拉取模型` 下拉 + 搜索)+ `测试连接`(就地显示延迟或错误) | 可「稍后配置」跳过 |
| 3. 剪贴板与隐私 | 说明"复制即翻译、内容会发送到你所配置的 LLM 服务";提供 `clipboardWatchEnabled`、`skipSingleToken`、忽略正则的快速编辑 | 可跳过(默认值已合理) |
| 4. 系统集成 | 开机自启、关闭到托盘、快捷键录制(默认留空,并解释"不设快捷键也完全可用") | 可跳过 |

**完成**:写 `onboardingCompleted = true` → 立即 `flushNow()` 落盘 → 关闭引导窗口 → 浮层弹出一次"已就绪,复制任意文本试试"的轻提示。

**边界**

- 第 1 步未选方向不允许「下一步」(方向是本产品的核心语义,不能悬空)。
- 第 2 步「测试连接」失败**不阻塞**:允许带着失败配置继续,浮层会以 `error` 态给出可操作提示。
- 直接关闭引导窗口 = 跳过全部,`onboardingCompleted = true`,浮层显示 `unconfigured` 引导卡(一键跳到设置页 Provider 页)。
- 已配置用户不会被引导打扰;只有 `onboardingCompleted === false` 才触发。
- 引导期间 `clipboardWatcher` 已启动(用户在第 2 步测完就能立刻复制验证),但第 2 步未配置完成前若剪贴板有变更,不发起请求、只在浮层记一条 `unconfigured` 状态,避免无意义报错刷屏。

### 6.4 安全提示(必要的老实话)

- Linux 无可用密钥环时,设置页 Provider 顶部显示黄色横幅:"当前系统无可用密钥环,API Key 以 base64 明文存储于 <路径>"。
- 剪贴板监听默认开,但设置页明确写出"任何复制的文本都会发送到你所配置的 LLM 服务";`ignorePatterns` 与暂停开关给用户退路。

---

## 7. IPC 契约(全量)

`preload.ts` 暴露 `window.translateClip`,全部经 `ipcRenderer.invoke`;事件用 `on*` 并返回取消订阅函数(eve-babel 同款写法)。

**调用(invoke)**

```
app:getBootstrapData        -> BootstrapPayload            // 配置 + provider 状态 + 最近历史 + 状态 + 平台能力
app:updateConfig(patch)     -> BootstrapPayload
app:setClipboardWatch(enabled) -> BootstrapPayload
app:translateClipboardNow() -> void                        // 立即读剪贴板并翻译
app:retranslateLast()       -> void
app:cancelTranslation()     -> void

history:list({query,cursor,limit,onlyPinned}) -> HistoryPage
history:togglePin(id) / history:remove(id) / history:clear(keepPinned) -> HistoryPage
history:copyTranslation(id) -> void                        // 写回剪贴板(带自写抑制)

llm:saveProviderProfile(input) -> BootstrapPayload
llm:deleteProviderProfile(id)  -> BootstrapPayload
llm:setActiveProviderProfile(id) -> BootstrapPayload
llm:fetchModels(input)      -> LlmProviderModel[]
llm:getApiKey(profileId)    -> string | null
llm:testConnection(input)   -> { ok: boolean; latencyMs: number | null; error: LlmError | null }

glossary:save(entry) / glossary:delete(id) -> BootstrapPayload
glossary:import(json) / glossary:export() -> string

shortcut:set(action, accelerator) -> { ok: boolean; error: string | null }
shortcut:test(accelerator)         -> { ok: boolean; error: string | null }

overlay:setCollapsed(bool) / overlay:setClickThrough(bool) / overlay:setOpacity(n) / overlay:resizeBy(deltaY)
overlay:hide() / overlay:show()

onboarding:complete() -> BootstrapPayload                  // 置 onboardingCompleted=true 并 flush 落盘
onboarding:skip()     -> BootstrapPayload                  // 关闭向导窗口的等价语义
window:openOnboarding()                                    // 首启自动调用;设置页「重新运行初始向导」也走它

window:openSettings() / window:closeSettings() / window:openDataFolder() / window:openLlmDebugFolder()
app:getPlatformCapabilities() -> { tray: boolean; globalShortcut: 'full'|'limited'; keyring: boolean; platform: NodeJS.Platform }
app:quit()
```

> 引导向导的每一步**复用既有 IPC**(方向→`app:updateConfig`;Provider→`llm:saveProviderProfile` / `llm:fetchModels` / `llm:testConnection`;剪贴板与集成→`app:updateConfig`;快捷键→`shortcut:set`),只有"完成/跳过"是新增通道。这样向导不引入第二套写配置的路径,`sanitizeConfig` 仍是唯一校验点。

**事件(main → renderer)**

```
translation:state   // idle | translating | done | error | skipped | canceled | unconfigured
history:update      // 新增/更新后的条目(局部刷新,不整表重拉)
config:update       // 配置变更(多窗口同步)
llm:status          // 队列/错误摘要(状态条)
clipboard:activity  // { accepted: boolean; reason?: string; preview?: string }  仅诊断用
```

**仅开发期**

```
debug:injectClipboard(text)   // 模拟一次剪贴板变更
debug:writeClipboard(text)
```

---

## 8. 安全设计

- `contextIsolation: true` + `nodeIntegration: false` + `sandbox: true`;渲染进程零 Node 能力,只走白名单 IPC。
- 主进程 handler 侧对**每个**入参做形状校验(不信任渲染进程),特别是 `apiBaseUrl`、正则字符串、accelerator。
- `webContents.setWindowOpenHandler` → 一律 `shell.openExternal`(仅 http/https),`will-navigate` 阻止一切内部跳转。
- `index.html` 加 CSP meta:`default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'`(Tailwind 注入需要 inline style;不引入 `unsafe-eval`)。
- 渲染进程无任何外网请求:所有 LLM 调用都在主进程 `fetch`,`apiKey` 永不过渲染进程(设置页读取时经 `llm:getApiKey` 显式、逐次取用,且不写入前端状态持久层)。
- 日志/调试文件对 `Authorization` 打码。

---

## 9. 构建与打包

**`electron-builder.yml`(一期 win + linux)**

```yaml
appId: com.ranxy.translateclip
productName: TranslateClip
directories: { output: dist }
files: [ "out/**/*", "package.json" ]
extraResources: [ { from: resources, to: resources, filter: ["**/*"] } ]
asar: true
artifactName: ${productName}-${version}-${arch}.${ext}
win:
  target: [ { target: nsis, arch: [x64] } ]
  icon: resources/icons/icon.ico
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
linux:
  target: [ AppImage, deb ]
  category: Utility
  icon: resources/icons
```

**脚本**

```json
"dev": "electron-vite dev",
"dev:gpu-off": "TRANSLATE_CLIP_DISABLE_GPU=1 electron-vite dev",
"build": "electron-vite build",
"typecheck": "tsc --noEmit",
"test": "vitest run",
"test:watch": "vitest",
"pack": "npm run build && electron-builder --dir",
"dist:win": "npm run build && electron-builder --win nsis",
"dist:linux": "npm run build && electron-builder --linux AppImage deb"
```

- Windows 包在你本机 `npm run dist:win` 产出(我不在 Linux 上做 wine 交叉构建);同时按你确认的意见附带 CI 出包。
- **`.github/workflows/build-windows.yml`(已确认要做)** —— 复刻 eve-babel 模板:`windows-latest` + `npm ci` + `node node_modules/electron/install.js`(确保 Electron 二进制)+ `typecheck` + `test` + `npm run dist:win` + `upload-artifact`。触发条件:`workflow_dispatch` / push `main` / push tag `v*` / PR 到 `main`。
- 另加 `.github/workflows/build-linux.yml`(ubuntu-latest,`dist:linux`,顺手在 CI 上验证 Linux 侧 `typecheck + test`,这两步在 WSL 本地也会跑,CI 只是双保险)。
- `.gitignore`:`node_modules`、`out`、`dist`、`*.log`、`docs/spec`(如后续加 spec)。

---

## 10. WSL 开发与测试策略

### 10.1 环境事实(已探测)

| 项 | 结果 |
| --- | --- |
| WSL 发行版 | Arch,WSL2,`6.18` 内核 |
| GUI | ✅ WSLg(`/mnt/wslg`、`DISPLAY=:0`、`WAYLAND_DISPLAY=wayland-0`、PulseServer) |
| Node / npm / pnpm | v24.12.0 / 11.6.2 / 11.10.0 |
| wine | ❌ 未安装(故不在 WSL 交叉构建 Windows 包) |
| xclip / wl-clipboard | ❌ 未安装(我们用 Electron 自带 `clipboard`,不需要) |
| docker | ✅ 可用(备用:容器内跑 Linux 发行验证) |

### 10.2 在 WSLg 里怎么跑、怎么验

1. `npm install && npm run dev` → electron-vite 起 dev server,Electron 窗口经 WSLg 显示在 Windows 桌面上。
2. 如遇 GPU/渲染异常:`npm run dev:gpu-off`(即 `TRANSLATE_CLIP_DISABLE_GPU=1`,代码里 `app.commandLine.appendSwitch('disable-gpu')`)。
3. 若以 root 运行报 sandbox 错(本机用户是 `ran`,预计不会):主进程在 Linux 下检测到 `process.getuid?.() === 0` 时追加 `--no-sandbox` 并打印警告。
4. 托盘:WSLg 无 tray host → `trayController` 走降级分支,启动日志里应出现 `tray unavailable, running tray-less`。
5. 全局快捷键:WSLg 下仅对 WSL 内窗口有效;验证改用浮层按钮 / 设置页里的"立即翻译"。
6. **剪贴板联调的关键手段**:WSLg 与 Windows 之间有文本剪贴板同步,但同步时机不完全可控。因此实现 `debug:injectClipboard(text)` 与设置页(仅 dev 显示)的"模拟剪贴板内容"输入框 —— 这样 Linux 侧可端到端验证"过滤 → 检测 → 翻译 → 入库 → 浮层渲染"整条链路,不依赖宿主剪贴板。**这是本期能在一期平台之外完成验证的核心保障。**

### 10.3 测试分层

| 层 | 手段 | 覆盖 |
| --- | --- | --- |
| 单元(vitest) | 纯函数 / 依赖注入 | `clipboardFilter`(各 reason 分支)、`languageDetector`(中/英/日/韩/俄/混合/空)、`promptBuilder`(变量替换 + 术语注入上限)、响应解析(正常 JSON / 围栏 / 前后噪声 / 非 JSON 回落 / 数组 content)、`configStore.sanitize`(越界夹取)、`historyRepository`(内存 sql.js:insert→complete→list→prune→cache 命中)、`translationQueue`(latest-wins abort、重试、不重试 auth) |
| 集成(mock fetch) | `llmClient` + 队列 + 仓储 | 401/429/500/超时/中断路径 → 状态与历史落库正确 |
| 手工(Linux/WSLg) | `npm run dev` | 浮层视觉/交互/折叠/穿透、**首启引导四步(含用全新 userData 复现首启)**、设置页各表单、dev 注入剪贴板的端到端链路、重启后配置与窗口位置恢复 |
| 手工(Windows,你) | `npm run dev` + `npm run dist:win` | 真实剪贴板监听(前台/后台/多应用)、置顶层级、NSIS 安装、开机自启、托盘、快捷键 |
| 静态 | `npm run typecheck` | 全量类型 |

### 10.4 一期验收标准

1. WSLg 下 `npm run dev` 可启动,浮层常驻置顶、可拖动、可折叠、可调透明度。
2. 通过 dev 注入/真实剪贴板触发,400ms 内浮层进入 `translating`,成功后在浮层显示译文、耗时、provider/model。
3. 连续复制两段不同文本:第一段请求被 abort,最终只显示第二段结果(无过期覆盖)。
4. 未配置 provider 时给出引导而非报错崩溃;401/429/超时各有可区分的文案与重试入口。
5. 复制译文回写剪贴板后**不会**触发新一轮翻译(自写抑制有效)。
6. 重复复制同一段文本命中缓存,0 token 出结果并显示"缓存"徽标。
7. 重启应用后:配置、Provider、历史、浮层位置全部恢复。
8. 术语表命中时,强制译法生效,且注入条目数不超过上限。
9. 中→英、英→中双向在 `auto` 模式下自动正确;`fixed` 模式严格单向。
10. `npm run typecheck` 与 `npm run test` 全绿;`npm run dist:linux` 产出可运行的 AppImage。
11. Windows 侧由你验证:NSIS 安装、真实剪贴板监听、置顶、托盘、开机自启。
12. **首启引导**:全新 `userData` 下首次启动先弹引导;第 1 步不选方向无法继续;第 2 步可跳过;"完成"后 `onboardingCompleted=true` 且重启不再弹;直接关窗等价跳过并让浮层显示 `unconfigured` 引导卡;设置页可重新运行向导。
13. **无快捷键也能全流程可用**:默认配置下,靠"复制自动翻译 + 浮层按钮 + 托盘菜单"能完成翻译、查看历史、复制译文、暂停监听,不依赖任何全局加速键。

---

## 11. 分期计划

| 阶段 | 内容 | 产出/验证 |
| --- | --- | --- |
| **P0 骨架** | 仓库脚手架 + `git init`、electron-vite + React + Tailwind v4 token、单实例、`configStore`(含 `onboardingCompleted`)、`windowManager`(浮层空壳 + 设置空壳)、单入口多视图、i18n 骨架、主题跟随、托盘降级、`app:getPlatformCapabilities` | WSLg 里能看到浮层与设置窗,`typecheck` 通过 |
| **P1 核心闭环 + 首启引导** | `clipboardWatcher` + `clipboardFilter` + `languageDetector` + `promptBuilder` + `llmClient` + `translationQueue` + `llmProviderCatalog/ConfigStore`(4 + Ollama)+ `historyRepository` + 浮层"当前/历史" + copy-back + 错误态 + dev 注入;**引导向导第 1、2 步(方向必填 + Provider 可跳过)** | 验收标准 1–7、12 达成 |
| **P2 完整度** | Providers 设置页(模型拉取/测试连接)、提示词页 + 预览、术语表 CRUD + 导入导出、快捷键录制(默认空)、开机自启、缓存策略细化、调试日志、鼠标穿透、折叠态、忽略正则、i18n 补全;**引导向导第 3、4 步 + 重新运行向导入口** | 验收标准 8–9 达成 |
| **P3 打包与跨平台** | electron-builder win/linux、图标资源、两个 CI workflow、README、macOS 适配设计(dock 隐藏、vibrancy、`LSUIElement`)、Wayland 原生剪贴板评估 | `dist:linux` 出包;Windows 交你验证 |

每个阶段结束我都会跑 `npm run typecheck` + `npm run test`,并在 WSLg 里实际启动确认,再交给你确认。

---

## 12. 已知风险与平台限制(提前说清,不做事后解释)

1. **独占全屏游戏无法覆盖**:DirectX 独占全屏绕过 DWM,任何置顶窗口都盖不住。需目标应用使用"无边框窗口"模式。浮层文档与设置页都会写明。
2. **Wayland 原生剪贴板读取受限**:部分合成器要求客户端聚焦才能读剪贴板 → 一期以 X11/XWayland 为准(WSLg 即此路径);原生 Wayland 支持列 P3。
3. **Linux `globalShortcut` 依赖 X11**:Wayland/WSLg 下宿主级快捷键不可用,托盘/浮层按钮兜底。
4. **WSLg 无托盘宿主**:托盘功能在 WSL 开发期不可见,靠 `try/catch` 降级保证不阻塞;Windows 上验证。
5. **sql.js 每次写需导出整库**:用"debounce 1.5s + maxWait 5s + 原子写 + historyLimit 裁剪"控制成本;若历史规模被拉到数万条,再评估迁移 better-sqlite3(仓储接口已隔离,替换只影响一个文件)。
6. **`transparent: true` 在 Windows 上的代价**:无 DWM 阴影、不能最大化、个别显卡驱动下 `backdrop-filter` 性能一般 → 提供"不透明模式"开关(设置页),一键退回不透明纯色背景。
7. **LLM 输出不稳定**:三层解析回落 + 结构化 prompt 已覆盖;仍有模型返回垃圾的可能 → 状态条给出"重译"与"查看原始响应(调试日志)"入口。
8. **隐私**:剪贴板内容默认全量上云。设置页显著说明 + 忽略正则 + 暂停开关 + 单 token 跳过,给用户明确控制权。
9. **多显示器 / DPI**:位置记忆 + 可见性夹取已处理;Windows 混合 DPI 下浮层高度按 CSS 像素计算,可能需要 `screen.getDisplayNearestPoint` 校正(实现时验证)。

---

## 13. 实现顺序(文件级,给下一步用)

1. `package.json` / `tsconfig.json` / `electron.vite.config.ts` / `electron-builder.yml` / `.gitignore` / `git init`
2. `src/shared/{types,constants,languages,locales/*}.ts`
3. `src/main/{main.ts,preload.ts,i18n.ts,ipc/ipcRouter.ts}`
4. `src/main/services/{configStore,credentialStore,llmProviderCatalog,llmConfigStore,windowStateStore}.ts`
5. `src/main/services/{clipboardWatcher,clipboardFilter,languageDetector,promptBuilder,llmClient,translationQueue,historyRepository}.ts` + 对应 `*.test.ts`
6. `src/main/services/{windowManager,trayController,shortcutManager,autoLaunch,glossaryStore,llmDebugLogger,logStore}.ts`
7. `src/renderer/{index.html,main.tsx,App.tsx,tailwind.css,i18n/*,store/appStore.ts}`
8. `src/renderer/components/ui/*`(8 个基础件)→ `overlay/*` → `onboarding/*`(4 步向导)→ `settings/*`
9. `resources/` 图标 → `.github/workflows/{build-windows,build-linux}.yml` → `npm run dist:linux` 验证

---

## 14. 决策已闭环

你已确认(§0 / §1.2):命名 `TranslateClip` / `剪译`、appId `com.ranxy.translateclip`、**默认不注册全局快捷键**、**首启引导配置翻译方向**、历史上限 500 + 缓存 24h、附加 Windows CI 出包、Linux 侧归我验证 / Windows 侧归你验证。

以下是我按上面默认值自行拍板、**不阻塞开工**的细项(实现中或验收时可随时让我改):

1. **浮层强调色**:先取 Tailwind `sky`,配中性灰阶;视觉定稿时若你觉得偏冷可换 `teal`。全站只用**一个**强调色。
2. **浮层默认几何**:右下角、380×520、距 `workArea` 边 24px、透明度 0.96;首启后即可拖动并记忆。
3. **设置窗口尺寸**:720×760,左竖排 tab。
4. **忽略正则默认值**:内置两条示例(纯 URL、纯数字)但**不启用**,避免新用户莫名漏翻。
5. **`skipSingleToken` 默认关**:宁可多翻一次,也不要静默跳过用户想翻的东西。
6. **引导第 3、4 步落在 P2**:P1 先交付第 1、2 步(方向 + Provider),因为这已覆盖"首启必须配置"的核心诉求;后两步纯设置项,引导中跳过也不影响可用性。

如果以上没有异议,我按 §11 的 **P0 骨架**开工。
