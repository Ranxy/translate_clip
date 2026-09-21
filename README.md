# TranslateClip (剪译)

**English** · [中文](README.zh.md)

Copy text in any application — the translation appears in a small window that stays on top of
everything else. No tab switching, no pasting into a chat window, no re-typing.

```
You press Ctrl+C in some app   →   ┌───────────────────────────┐
                                   │ TranslateClip  ⏸ Watching│
                                   │ Original       EN → 中文  │
                                   │ The quick brown fox …     │
                                   │ Translation               │
                                   │ 敏捷的棕色狐狸…           │
                                   │ [Translate now][Copy] [🗑]│
                                   └───────────────────────────┘
```

## What it does

- **Copy anywhere, it translates itself.** A watcher polls the clipboard; your text is translated
  and shown in the overlay, usually within a second.
- **It works out the direction for you.** Language detection decides whether to translate into your
  target language or back into your fallback — Chinese → English, everything else → Chinese by
  default — and the overlay shows the direction it settled on.
- **Copying the same text again is free.** A finished translation is reused for 24 hours instead of
  asking the model again; the overlay marks it *Cached*.
- **It can hand the translation back to you.** Switch on *auto-replace* and each finished
  translation is written straight to the clipboard, ready to paste where the original was going.
  Off by default.
- **Your own provider.** OpenAI, DeepSeek, OpenRouter, Ollama running on your machine, or any
  OpenAI-compatible endpoint.
- **History, glossary and prompt are yours to shape** — searchable history, forced terminology, an
  editable prompt template with a live preview.
- **No shortcut required.** Nothing is bound to a global key unless you record one; every action is
  reachable from the overlay and the tray menu.

## Install

Windows 10/11 (x64) is the primary target. Linux (AppImage / deb) is also built.

1. **Download the installer** from the repository's *Actions* tab: open the newest `build-windows`
   run and download the `TranslateClip-*-x64.exe` artifact, then run it.
2. **Or build it yourself** — see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

The installer lets you choose the folder and does not need administrator rights. Later versions
install over the previous one; your settings and history are kept.

## First run

A four-step wizard opens the first time:

1. **Language and direction** — the wizard opens in your system language; the picker at the top
   switches it straight away. Below it, choose which language to translate into and what to do when
   the text is already in that language. The direction is required; everything else has sensible
   defaults.
2. **Provider** — pick a service, paste an API key, fetch its model list, press *Test connection*.
   This step can be skipped and set up later.
3. **Clipboard and privacy** — what gets sent where, plus length limits, ignore rules and the option
   to skip single words or numbers.
4. **System integration** — launch at login, whether closing the overlay keeps the app in the tray,
   and optional keyboard shortcuts.

Closing the wizard early is fine: the overlay then shows a *Set up* card that takes you to the
provider page.

## Using it

### The overlay

| Where | What it does |
| --- | --- |
| `⏸ Watching` in the header | The state of the clipboard watcher, and the control for it: click to pause, click again to resume. While paused, copied text is ignored — and nothing is translated afterwards either |
| Header buttons | `─` collapse the overlay to a bar · `⚙` settings · `✕` hide it (the app keeps running in the tray) |
| `Translate now` | Translate whatever is on the clipboard right now, without waiting for it to change. Asking for the same text again is answered from the cache |
| `Copy translation` | Put the translation back on the clipboard |
| `🗑` / `Clear` | Empty the current view — the original, the translation, and any request in flight |
| `Current` / `History` | Switch between the translation you are looking at and the searchable history |
| Status bar | Phase, provider and model, why the last copy was **not** translated, the auto-replace chip, and `Pause` / `Resume` |
| The bar (after `─`) | One line of the translation, growing taller when the translation is long (up to six lines, the rest on hover). Pause, clear and expand sit beside it, and stack into a column once the text wraps so the preview keeps its width |

### The tray menu

*Show / Hide overlay* — the entry follows the overlay's state — *Translate clipboard now*,
*Watch clipboard*, *Collapse*, *Click-through*, *Settings*, *Launch at login* (installed builds
only), *Open log folder*, *Quit*. Left-clicking the tray icon toggles the overlay, double-clicking
opens settings.

### Auto-replacing the clipboard

Switch on the clipboard chip in the overlay's status bar, or **Settings → Clipboard → Replace the
clipboard**. From then on the clipboard holds the translation of what you copied instead of the
original. It is off by default because it takes the clipboard out of your hands; the app recognises
its own write, so it never translates the translation back and forth.

### Keyboard shortcuts

None are registered by default. In **Settings → Shortcuts**, click a recorder and press the
combination you want (`Ctrl+Alt+T`, for example). The row says *Registered* once it takes, or warns
you when the combination belongs to another program. Clear it with `✕`.

### History

`History` in the overlay searches originals and translations and lets you copy a translation, pin an
entry, delete one, or clear the list while keeping the pinned ones. History holds up to 500 entries.

## Setting up a provider

**Settings → Providers** lists OpenAI, DeepSeek, OpenRouter, Ollama and a custom OpenAI-compatible
endpoint. Pick one, fill in the model (or press *Fetch models* to pull the list from the service),
paste the API key, then press *Test connection* — that request only checks the address and the key
and spends no tokens. Saving the first profile makes it the active one.

Ollama needs no key: it defaults to `http://127.0.0.1:11434/v1`.

API keys are encrypted with the operating system's own facility (DPAPI on Windows) and never reach
the interface — the settings page reads one only when you explicitly reveal it. On a Linux system
without a keyring, the settings page says so plainly instead of pretending the key is safe.

## Settings, one line each

**General** — interface language, theme, the overlay's opacity (a slider that changes the overlay
as you drag it) and text size, launch at login, close to tray, history limit, and buttons that open
the data and log folders. **Clipboard** — watching, poll interval, length limits, ignore
rules, single-token skipping, the reuse cache, auto-replace, request logging. **Providers** — as
above. **Prompt** — the system prompt template, its variables, and a live preview. **Glossary** —
forced translations, with JSON import and export. **Shortcuts** — the recorder. **About** — version,
platform diagnostics, and *Run the first-run wizard again*.

## Privacy

- **What you copy is sent to the service you configured.** That is the point of the app, and the
  settings page says so. Nothing else goes anywhere: no telemetry, no accounts, no cloud sync.
- You stay in control of it: pause watching, add ignore patterns (URLs and pure numbers are
  ready-made suggestions), set a minimum and maximum length, skip single words or numbers.
- Everything else stays on your machine — history, glossary, window position.

## Where your data lives

| Windows | Linux | Contents |
| --- | --- | --- |
| `%APPDATA%\translate-clip\config.json` | `~/.config/translate-clip/config.json` | All settings and the glossary |
| `…\data.sqlite` | `…/data.sqlite` | Provider profiles and translation history |
| `…\window-state.json` | `…/window-state.json` | Window position and size |
| `…\logs\main.log` | `…/logs/main.log` | Application log, rotated at 2 MB |

*Settings → About* shows the exact path and opens the folder. Deleting the whole folder resets the
app to a first run, wizard and all.

## Known limitations

- **A game running in exclusive fullscreen hides the overlay.** That is a Windows/DWM rule rather
  than something the app can work around; set the game to borderless windowed mode instead.
- **Transparency costs a little.** A transparent always-on-top window has no drop shadow, and on
  some graphics drivers the frosted-glass look is slow — *Settings → General → Opaque background*
  trades the blur for a solid colour.
- **Click-through makes the overlay unclickable.** That is what it is for; turn it off from the tray
  menu, and the overlay says so the moment you enable it.
- **On Linux**, a Wayland session only lets a focused client read the clipboard, global shortcuts
  reach X11 applications only, and the tray needs a StatusNotifier host. Window transparency is not
  available either, so the overlay's opacity slider is disabled there. Windows is the primary
  target.

## Documentation

| | |
| --- | --- |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Building, running, testing and packaging |
| [docs/DESIGN.md](docs/DESIGN.md) | Why the app is built the way it is, and what was rejected |
| [docs/WINDOWS-VERIFICATION.md](docs/WINDOWS-VERIFICATION.md) | The manual test checklist, with an expected result for every step |
