# 开发文档

面向开发者的内容:环境、脚本、测试、打包与项目结构。**面向用户的使用说明在
[README](../README.md)**;设计取舍与"为什么这样做"在 [DESIGN.md](DESIGN.md);人工验证清单在
[WINDOWS-VERIFICATION.md](WINDOWS-VERIFICATION.md)。

开发与验证**都在 Windows 上进行**(Windows 11 + PowerShell 7)。**只出 Windows 安装包**:Linux
曾计划随一期交付(AppImage / deb + Linux CI),该出包链路已移除(见 §6);代码里的 Linux 兼容分支
保留,但不再构建、不承诺支持。

---

## 1. 环境要求

| 项 | 值 |
| --- | --- |
| 操作系统 | Windows 10/11 x64(开发机为 2560×1440 @150% 缩放) |
| Node.js | 22.18+(开发使用 24)。低于 22.18 时 Node 无法直接导入 `.ts`,i18n 校验脚本会明确报错退出 |
| 包管理器 | npm(项目用 `package-lock.json`,不引入 pnpm) |
| Shell | PowerShell 7(脚本本身跨平台) |

不需要原生编译工具链:`sql.js` 是纯 wasm,凭据走系统能力(Windows 上是 DPAPI),托盘与快捷键
由 Electron 提供。

## 2. 常用脚本

| 命令 | 作用 |
| --- | --- |
| `npm install` | 安装依赖。Electron 二进制由 `postinstall` 下载 |
| `npm run dev` | electron-vite dev:构建主进程 + preload,起渲染进程 dev server,启动 Electron |
| `npm run dev:gpu-off` | 同上,但附加 `--disable-gpu`(驱动/合成异常时的逃生口;跨平台写法,Windows 可用) |
| `npm run build` | 产出 `out/main`、`out/preload`、`out/renderer` |
| `npm run typecheck` | `tsc --noEmit`,覆盖主进程、preload、渲染进程与共享层 |
| `npm test` | vitest 单元测试(当前 182 条) |
| `npm run test:watch` | vitest watch |
| `npm run i18n:check` | i18n 审计 + key 顺序检查(见 §8) |
| `npm run i18n:sort` | 按基准语言(zh-CN)重排各 locale 模块的 key 顺序 |
| `npm run self-check` | 构建后以 `--self-check` 启动,跑一遍端到端自检(见 §4) |
| `npm run icons` | 重新生成 `resources/` 里的图标(无第三方依赖的生成脚本) |
| `npm run pack` | `electron-builder --dir`,产出未打包目录,便于检查 asar 布局 |
| `npm run dist:win` | Windows NSIS 安装包(只出包,不发布) |
| `npm run release:win` | Windows NSIS 安装包并**发布到 GitHub Release**(只有 Release 事件下的 CI 会调用) |
| `node scripts/check-release-tag.mjs <tag>` | 校验 tag 是 `v<package.json version>`(CI 在出 Release 前先跑;本地可手动跑) |

> **注意**:`electron-vite dev` 默认不带 `-w`,**不会**监听主进程/preload 的改动并重启。改了
> `src/main/**` 或 `src/preload/**` 需要手动重启 dev;渲染进程有 HMR。

## 3. 项目结构

```
src/
  shared/   types / constants / languages / locales —— 两个进程共用
            locales/  界面语言目录(index.ts)+ 各语言文案(zh-CN 为类型基准)
  main/     生命周期、IPC 路由与服务
    services/  config、credential、database(sql.js)、llmClient、translationQueue、
               clipboardWatcher/Filter、languageDetector、promptBuilder、history、
               glossary、windowManager、tray、shortcut、autoLaunch、log、capabilityRegistry
    selfCheck.ts       --self-check 的全部断言
    testing/           单元测试用的假 logger 与桩服务器
  renderer/ React + Tailwind,一个入口按 ?view= 分流 overlay / settings / onboarding
```

**单入口多视图**:`index.html` 只有一个,`App.tsx` 读 `?view=` 决定渲染哪个视图;一份 Tailwind
产物、一份 preload、一套 i18n。

**进程边界**:所有网络、剪贴板与持久化都在主进程;渲染进程 `contextIsolation: true` +
`sandbox: true`,只能通过 preload 白名单 IPC 说话。IPC 契约见 [DESIGN.md](DESIGN.md) §7。

## 4. 测试

三层,互不替代:

| 层 | 手段 | 覆盖 |
| --- | --- | --- |
| 单元 | `npm test`(vitest,182 条) | 过滤链、语言检测、提示词组装、响应三层解析、配置夹取、仓储与缓存、队列 latest-wins 与重试、快捷键管理器、i18n key 审计与各语言的 key/占位符对齐 |
| 审计 | `npm run i18n:check` | 跨源码与文案的静态审计:目录注册、缺失、无用、各语言一致性与顺序、`{{}}` 占位符(见 §8) |
| 自检 | `npm run self-check`(30 项) | 真实 Electron 内跑:资源与图标解码、userData 可写、三个视图挂载、剪贴板管线、真实(桩)翻译、浮层缩放、错误浮层、配置抖动、各设置页、暂停控件、清空当前、向导四步、向导首屏的语言选择器,**四种界面语言 × 两个标签页 × 折叠条的浮层布局测量(默认宽度必须单行,最小宽度不得裁切)** |
| 手工 | [WINDOWS-VERIFICATION.md](WINDOWS-VERIFICATION.md) | 自动化到不了的部分:真实剪贴板、置顶层级、托盘、全局快捷键、开机自启、安装包 |

自检的约定值得知道:**它不读你的剪贴板**(`--self-check` 下不启动 watcher),也不会留下副作用
——临时 provider、快捷键、折叠状态都会恢复原样。安装版同样可以跑:
`"<安装目录>\TranslateClip.exe" --self-check`。

## 5. 调试手段

| 手段 | 用法 |
| --- | --- |
| 主进程日志 | `%APPDATA%\translate-clip\logs\main.log`;`logLevel` 设为 `debug` 可看到每条剪贴板候选的接受/跳过与方向决策 |
| LLM 请求日志 | 设置 → 剪贴板 → 「记录 LLM 请求日志」,把装配好的提示词写进主日志(响应体不入盘) |
| 剪贴板模拟器 | 设置 → 剪贴板 →「模拟剪贴板内容」(仅开发版),不读也不写系统剪贴板,直接走采集管线 |
| DevTools | 开发版可用;渲染进程的 console 警告会转发进主日志 |
| 重置首启 | 删掉 `%APPDATA%\translate-clip` 整个目录;或 设置 → 关于 →「重新运行初始向导」 |
| 跨端调试 | `electron-vite dev --remoteDebuggingPort <port>`,再用 CDP 读写渲染进程 |

托盘与全局快捷键在开发运行下也可用(Windows);**开机自启在开发运行下按设计置灰**——它需要安装版
才能写入启动项,这一点由 `capabilityRegistry.launchAtLogin` 上报,UI 据此禁用而不是假装成功。

## 6. 打包

`electron-builder.yml` 只配置 Windows(NSIS,可选目录、无需管理员)。`files` 只收 `out/**` 与
`package.json`,`resources/` 通过 `extraResources` 随包发出。Linux 的 `linux:` 段(AppImage / deb)
曾经存在,现已移除——只出 Windows 包,也就不需要 wine 交叉构建。

四个容易踩的点,改动时请保留:

1. **`resources/` 是逐目录映射的**(`resources/icons → icons`),不是 `from: resources, to:
   resources`。后者会多套一层,打包后代码按 `<resources>/icons/…` 找图会落空,托盘图标静默变白。
2. **`sql.js` 的 `.wasm` 在 `asarUnpack` 白名单里**——它是运行时加载的,不进白名单数据库在安装版
   里打不开。
3. **`--publish never` 不能删**。electron-builder 在 CI 里检测到 CI 环境后会"隐式发布"
   (`Implicit publishing triggered by CI detection`),然后去建 GitHub publisher 并要求
   `GH_TOKEN`,构建直接在打包完成后报错退出(本仓库只在出 Release 时发布)。显式写
   `--publish never` 是官方推荐的关法,v27 起隐式发布也会彻底移除。
4. **`publish.releaseType: release` 不能改成 `draft`**。electron-builder 的默认发布形态是草稿,
   而草稿形态的 publisher 会**拒绝**往一个已经公开的 Release 上传资产(日志里只有一行
   `GitHub release not created`,构建仍然成功)。本仓库的流程是"你先公开 Release,CI 再挂资产",
   所以这里必须是 `release`。

### 6.1 CI 与发版

CI 侧 `.github/workflows/build-windows.yml` 在 `windows-latest` 上跑
`typecheck + test + self-check + dist:win` 并上传产物,可从 Actions 页手动触发。`build-linux.yml`
(ubuntu-latest,曾负责 Linux 出包并把 `self-check` 当硬门禁)已随 Linux 出包链路一并删除。

**出包入口是 GitHub 上的 Release,不是 tag**:

1. 先把 `package.json` 的 `version` 改好并提交(例如 `0.2.0`)。
2. 在 GitHub 上创建 Release,选/建 tag **`v0.2.0`**,然后发布它。
3. `release: published` 触发 workflow:先跑 `node scripts/check-release-tag.mjs` 校验 tag,再跑
   `npm run release:win`(`--publish always`),把 exe 连同 `latest.yml` 与 blockmap 作为资产挂到
   **这个** Release 上。
4. 失败时重跑同一个 run 即可:资产会覆盖上传(`EP_GH_IGNORE_TIME=true` 绕开 electron-builder 对
   已发布 Release 的 2 小时上传限制)。

三个前提:

- **tag 必须是 `v<package.json version>`**。electron-builder 按 `v` + version 找 Release
  (`vPrefixedTagName` 默认 true),tag 与 version 不一致时它会把安装包挂到另一个 Release(甚至新建
  一个),所以 `scripts/check-release-tag.mjs` 会在构建前直接失败。
- **单纯的 `git push --tags` 不再触发构建**(workflow 的 push 触发只保留 `main`)。只想验证出包、
  不想发布时,用 Actions 页的 `workflow_dispatch`,或走 PR。草稿(draft)Release 也不会触发——
  点 Publish 才触发。
- **workflow 定义取自 `main`,代码取自 tag**(GitHub 对 `release` 这类事件的规则)。所以 tag 指向
  的那个 commit 里必须有 `release:win` 脚本,否则这一步会以 `Missing script: release:win` 失败。
  打 tag 前先确认这些提交已经在 tag 里。

## 7. 数据与状态(开发时)

| 路径 | 内容 |
| --- | --- |
| `%APPDATA%\translate-clip\config.json` | 全部设置 + 术语表 |
| `%APPDATA%\translate-clip\data.sqlite` | provider profile 与翻译历史(sql.js) |
| `%APPDATA%\translate-clip\window-state.json` | 窗口位置与尺寸 |
| `%APPDATA%\translate-clip\logs\main.log` | 主进程日志,2 MB 滚动 |

写库只改内存,再以「debounce 1.5s + 最多 5s 强制落盘 + 原子写」持久化;`--self-check` 与正常退出
都会 `flushNow`。历史按 `historyLimit`(默认 500)裁剪,避免每次导出整库的体积线性增长。

---

## 8. 多语言(i18n)

### 8.1 结构

| 位置 | 作用 |
| --- | --- |
| `src/shared/locales/index.ts` | 语言目录:`SUPPORTED_LOCALES`(也决定 key 顺序基准,第一条即基准)、`UI_LOCALE_OPTIONS`(下拉框)、`resolveLocale()`(任意 BCP-47 → 已发布语言,未知语言回落 `en`) |
| `src/shared/locales/zh-CN.ts` | **基准文案**。`export type LocaleResource = typeof zhCN`,其余语言都以它为类型 |
| `src/shared/locales/{en,ja,ru}.ts` | 各语言文案,结构与 key 必须与基准完全一致 |
| `src/renderer/i18n/index.ts` | 渲染进程 `i18next` 初始化、`changeLanguage()`、同步 `<html lang>` |
| `src/main/i18n.ts` | 主进程轻量 `translate()`(托盘、通知),复用同一份 locale 模块 |

界面语言存在 `config.uiLanguage`,取值 `'system' | SupportedLocale`。`'system'` 在主进程由
`app.getLocale()`、在渲染进程由 `navigator.language` 展开,两者都经 `resolveLocale()` 归一。用户可在
**引导向导第 1 屏**和 **设置 → 通用**两处修改,改完立即重渲染并持久化(不需要重启)。

### 8.2 加一门语言

1. 复制 `src/shared/locales/en.ts`,导出名改成该语言(如 `ko`),逐条翻译 —— key 一条都不要增删。
2. 在 `index.ts` 里:加入 `SupportedLocale` 联合类型、`SUPPORTED_LOCALES`(追加在末尾即可,基准不能换)、
   `LOCALE_RESOURCES`、`UI_LOCALE_OPTIONS`,并在 `resolveLocale()` 的 `switch` 里加一个 `case`。
3. `npm run i18n:sort` 把新文件的 key 顺序对齐基准,然后 `npm run typecheck && npm run i18n:check && npm test`。

`UiLanguage` 由 `SupportedLocale` 派生,`configStore` 的白名单也来自 `SUPPORTED_LOCALES`,所以除了上面
两处没有别的注册点。**漏翻或拼错 key 是编译错误**,不需要靠审计脚本兜底。

### 8.3 校验脚本

| 脚本 | 检查 |
| --- | --- |
| `npm run i18n:check` | `scripts/check-i18n.mjs`(审计)+ `scripts/sort-i18n-keys.mjs --check`(顺序) |
| `npm run i18n:sort` | 按基准顺序重排;写入后**重新导入并深比较**,不一致就回滚原文件 |

审计的六项:① 磁盘上的 locale 模块、`SUPPORTED_LOCALES`、`UI_LOCALE_OPTIONS` 三者一致;② 代码里
`t('key')` / `translate('key')` 用到的 key 都存在;③ 文案里有、代码里没人用的 key(**会报错** ——
无用文案会烂掉,要么删掉要么接上);④ 各语言 key 集合与基准完全一致;⑤ key 顺序与基准一致;
⑥ 各语言同一 key 的 `{{占位符}}` 完全一致,且不允许出现单个 `{name}`(react-i18next 会原样输出)。

用**计算出来的** key(模板字符串、查表)引用时,脚本看不见调用点,必须把前缀登记到
`scripts/check-i18n.mjs` 顶部的 `DYNAMIC_PREFIXES` 并注明调用处;这是唯一需要人工维护的地方。

脚本直接 `import` locale 模块(靠 Node ≥22.18 的类型擦除),所以文案是 TypeScript 而不是 JSON ——
换 JSON 会丢掉「漏 key 即编译错误」这条最强保障。因此 CI 的 `node-version` 是 24。
