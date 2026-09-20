# 开发文档

面向开发者的内容:环境、脚本、测试、打包与项目结构。**面向用户的使用说明在
[README](../README.md)**;设计取舍与"为什么这样做"在 [DESIGN.md](DESIGN.md);人工验证清单在
[WINDOWS-VERIFICATION.md](WINDOWS-VERIFICATION.md)。

开发与验证**都在 Windows 上进行**(Windows 11 + PowerShell 7)。Linux(AppImage / deb)仍是支持
目标,由 CI 出包,但不再作为开发环境。

---

## 1. 环境要求

| 项 | 值 |
| --- | --- |
| 操作系统 | Windows 10/11 x64(开发机为 2560×1440 @150% 缩放) |
| Node.js | 22+(开发使用 24) |
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
| `npm test` | vitest 单元测试(当前 162 条) |
| `npm run test:watch` | vitest watch |
| `npm run self-check` | 构建后以 `--self-check` 启动,跑一遍端到端自检(见 §4) |
| `npm run icons` | 重新生成 `resources/` 里的图标(无第三方依赖的生成脚本) |
| `npm run pack` | `electron-builder --dir`,产出未打包目录,便于检查 asar 布局 |
| `npm run dist:win` | Windows NSIS 安装包 |
| `npm run dist:linux` | Linux AppImage + deb |

> **注意**:`electron-vite dev` 默认不带 `-w`,**不会**监听主进程/preload 的改动并重启。改了
> `src/main/**` 或 `src/preload/**` 需要手动重启 dev;渲染进程有 HMR。

## 3. 项目结构

```
src/
  shared/   types / constants / languages / locales —— 两个进程共用
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
| 单元 | `npm test`(vitest,162 条) | 过滤链、语言检测、提示词组装、响应三层解析、配置夹取、仓储与缓存、队列 latest-wins 与重试、快捷键管理器、i18n key 审计 |
| 自检 | `npm run self-check`(28 项) | 真实 Electron 内跑:资源与图标解码、userData 可写、三个视图挂载、剪贴板管线、真实(桩)翻译、浮层缩放、错误浮层、配置抖动、各设置页、暂停控件、清空当前、向导四步 |
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

`electron-builder.yml` 一次配置两端:Windows 为 NSIS(可选目录、无需管理员),Linux 为
AppImage + deb。`files` 只收 `out/**` 与 `package.json`,`resources/` 通过 `extraResources` 随包
发出。

两个容易踩的点,改动时请保留:

1. **`resources/` 是逐目录映射的**(`resources/icons → icons`),不是 `from: resources, to:
   resources`。后者会多套一层,打包后代码按 `<resources>/icons/…` 找图会落空,托盘图标静默变白。
2. **`sql.js` 的 `.wasm` 在 `asarUnpack` 白名单里**——它是运行时加载的,不进白名单数据库在安装版
   里打不开。

CI 侧 `.github/workflows/build-windows.yml` 在 `windows-latest` 上跑
`typecheck + test + self-check + dist:win` 并上传产物;`build-linux.yml` 在 `ubuntu-latest`(xvfb)
做同样的事。两者都可从 Actions 页手动触发。

## 7. 数据与状态(开发时)

| 路径 | 内容 |
| --- | --- |
| `%APPDATA%\translate-clip\config.json` | 全部设置 + 术语表 |
| `%APPDATA%\translate-clip\data.sqlite` | provider profile 与翻译历史(sql.js) |
| `%APPDATA%\translate-clip\window-state.json` | 窗口位置与尺寸 |
| `%APPDATA%\translate-clip\logs\main.log` | 主进程日志,2 MB 滚动 |

写库只改内存,再以「debounce 1.5s + 最多 5s 强制落盘 + 原子写」持久化;`--self-check` 与正常退出
都会 `flushNow`。历史按 `historyLimit`(默认 500)裁剪,避免每次导出整库的体积线性增长。
