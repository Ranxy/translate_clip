# TranslateClip (剪译)

Clipboard-monitoring LLM translator with an always-on-top overlay.
Copy text anywhere; the translation appears in a small floating window.

**Status:** phase 0 (skeleton) — the overlay, settings window, first-run wizard shell,
configuration layer, tray, shortcuts and lifecycle are in place. Clipboard watching
and translation land in phase 1.

Primary target: **Windows**. Linux (X11/WSLg) is the development and verification
environment; macOS support is planned but not implemented.

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
| `npm run self-check` | Builds and runs an end-to-end smoke test of all three views |
| `npm run icons` | Regenerates icons in `resources/` (dependency-free generator) |
| `npm run dist:win` | Windows NSIS installer (`dist/`) |
| `npm run dist:linux` | Linux AppImage + deb |

## Where data lives

| Path | Contents |
| --- | --- |
| `<userData>/config.json` | All settings (see `src/shared/types.ts`) |
| `<userData>/window-state.json` | Overlay and window geometry |
| `<userData>/logs/main.log` | Main-process log, rotated at 2 MB |

`userData` is `%APPDATA%\translate-clip` on Windows, `~/.config/translate-clip` on Linux.
The settings window's **About** tab shows the exact path and can open it.

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
