# TranslateClip (剪译)

Clipboard-monitoring LLM translator with an always-on-top overlay.
Copy text anywhere; the translation appears in a small floating window.

**Status:** feature-complete for phase 1/2 on Windows and Linux.

- Configuration layer, overlay/settings/first-run wizard, tray, global shortcuts,
  launch-at-login, lifecycle and the icon pipeline.
- Clipboard pipeline: polling watcher with self-write suppression, filter chain,
  script-based language detection and direction resolution (中↔英 works automatically).
- Translation: provider profiles in sql.js with `safeStorage` credentials, an
  OpenAI-compatible client with retries and three-layer response parsing, a latest-wins
  queue, history with a reuse cache, and a glossary that is injected into the prompt.
- UI: overlay with collapse/click-through/opacity and a history panel, provider setup,
  prompt and parameter editor with a live preview, glossary editor, shortcut recorder.
- Packaging: NSIS for Windows, AppImage + deb for Linux, and CI for both.

Not done yet: macOS support, streaming responses (`streamEnabled` exists but is unused),
and OCR/selection capture.

Primary target: **Windows**. Linux (X11/WSLg) is the development and verification
environment; macOS support is planned but not implemented.

## Verifying on Windows

**The full checklist — with the expected result for every step — is
[`docs/WINDOWS-VERIFICATION.md`](docs/WINDOWS-VERIFICATION.md).** It covers the parts
that no automated test can reach from Linux: the real clipboard, overlay stacking,
the tray, global shortcuts, autostart and the installer.

1. `npm install`
2. `npm run dev` — the first run opens the setup wizard. Step 1 sets the translation
   direction (required), step 2 connects a provider (DeepSeek, OpenAI, OpenRouter,
   Ollama or any OpenAI-compatible endpoint) and can be skipped.
3. Copy text in any application. The overlay shows the source, the resolved direction
   and — once a provider is configured — the translation.
4. `npm run self-check` for the automated pass: shipped assets, icon decoding, a
   writable `userData`, all views and settings tabs, the clipboard pipeline, a real
   translation through a loopback stub provider, and the wizard.
5. `npm run dist:win` for the installer, or download it from the Actions tab.

On Windows `safeStorage` uses DPAPI, so API keys are encrypted at rest. The
"no keyring" warning only appears on Linux installs without a keyring, and the
launch-at-login switch is disabled in development runs (it needs an installed build).

## Requirements

- Node.js 22+ (developed on 24)
- npm

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Electron + Vite dev server with HMR |
| `npm run dev:gpu-off` | Same, with GPU acceleration disabled (WSLg or driver trouble) |
| `npm run build` | Builds `out/main`, `out/preload`, `out/renderer` |
| `npm run typecheck` | `tsc --noEmit` across main, preload and renderer |
| `npm test` | Unit tests (vitest) |
| `npm run self-check` | Builds and runs an end-to-end smoke test: shipped assets, writable `userData`, all three views, the clipboard pipeline and a real translation against a local stub provider |
| `npm run icons` | Regenerates icons in `resources/` (dependency-free generator) |
| `npm run dist:win` | Windows NSIS installer (`dist/`) |
| `npm run dist:linux` | Linux AppImage + deb |

## Where data lives

| Path | Contents |
| --- | --- |
| `<userData>/config.json` | All settings (see `src/shared/types.ts`) |
| `<userData>/data.sqlite` | Provider profiles and translation history (sql.js) |
| `<userData>/window-state.json` | Overlay and window geometry |
| `<userData>/logs/main.log` | Main-process log, rotated at 2 MB |

`userData` is `%APPDATA%\translate-clip` on Windows, `~/.config/translate-clip` on Linux.
The settings window's **About** tab shows the exact path and can open it.

`--self-check` temporarily saves a provider profile pointing at a loopback stub server,
deletes it (with the sample translation) when it finishes, walks the first-run wizard
(which re-saves the direction settings unchanged) and briefly sets the overlay text
size to its maximum to measure the layout before restoring it. It never uses or modifies
a real provider profile, and it does not start clipboard watching.

## Notes for development on WSL

- WSLg provides a display, so `npm run dev` opens real windows on the Windows desktop.
  If compositing looks wrong, use `npm run dev:gpu-off`.
- There is no StatusNotifier host, so the tray icon is created but not visible; the
  capability registry reports `tray: false` and the UI says so instead of pretending.
- Global shortcuts only reach WSL-internal X11 windows. They are **not registered by
  default** anyway: every action is reachable from the overlay buttons and the tray menu.
- Clipboard sync between the host and WSLg is not deterministic. Use
  `window.translateClip.debugInjectClipboard(text)` (available unpackaged) to drive the
  clipboard pipeline deterministically from the devtools console.
- `electron-builder` downloads the Electron distribution from GitHub, which may be
  blocked. To package from a checkout that already has `node_modules`, point it at the
  installed distribution instead:
  `npx electron-builder --linux dir -c.electronDist=node_modules/electron/dist`.
  The produced `dist/linux-unpacked/translate-clip --self-check` is the closest local
  equivalent of the Windows install, and is what verifies the asar layout.

## Packaging

| Command | Output |
| --- | --- |
| `npm run dist:win` | `dist/TranslateClip-<version>-x64.exe` (NSIS installer) |
| `npm run dist:linux` | AppImage + deb in `dist/` |
| `npm run pack` | Unpacked build, useful for inspecting the asar layout |

Two things about the packaging are worth knowing, because both are easy to get wrong:

- `resources/` is mapped **per directory** in `electron-builder.yml` (`resources/icons`
  → `icons`) so the packaged paths match `resolveResourcePath()`. A plain
  `from: resources, to: resources` would nest them one level deeper and the tray icon
  would silently come out blank.
- `sql.js` loads its `.wasm` at runtime, so it is listed under `asarUnpack`; without it
  the database cannot open in a packaged build.

CI: `.github/workflows/build-windows.yml` builds the installer on `windows-latest`
(and runs type check, tests and the self-check), and `build-linux.yml` does the same on
`ubuntu-latest` under `xvfb`. Both are also runnable from the Actions tab.

## Architecture

```
src/
  shared/     types, constants, locale resources shared by both processes
  main/       lifecycle, IPC router, services (config, windows, tray, shortcuts, ...)
  renderer/   React + Tailwind UI: overlay, settings, onboarding views in one entry
```

- One renderer entry, three views selected by `?view=overlay|settings|onboarding`.
- All provider traffic, clipboard access and persistence happen in the main process.
  The renderer is sandboxed and only talks through the whitelisted preload bridge.
- Design decisions, IPC contract and the phased plan: [`docs/DESIGN.md`](docs/DESIGN.md).
