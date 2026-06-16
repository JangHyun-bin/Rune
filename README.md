<div align="center">

<img src="docs/hero.png" width="140" alt="Rune" />

# Rune

**The focused markdown writer for desktop.**

[![License: MIT](https://img.shields.io/badge/License-MIT-114ADB.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/JangHyun-bin/Rune?sort=semver&color=114ADB)](https://github.com/JangHyun-bin/Rune/releases/latest)
![Platforms](https://img.shields.io/badge/platforms-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-6B717A)
![Built with Tauri + Rust](https://img.shields.io/badge/built%20with-Tauri%20%2B%20Rust-2C3138)

[**⬇ Download**](https://github.com/JangHyun-bin/Rune/releases/latest) · [Why Rune?](#why-rune) · [Build from source](#development)

English · [한국어](README.ko.md)

</div>

---

<p align="center">
  <img src="docs/rune-demo.gif" width="80%" alt="Rune — formatting as you type" />
</p>

<!-- Screenshots: capture light & dark via `npm run tauri dev`, save to docs/screenshots/{light,dark}.png, then uncomment.
<p align="center">
  <img src="docs/screenshots/light.png" width="48%" alt="Rune — light" />
  <img src="docs/screenshots/dark.png" width="48%" alt="Rune — dark" />
</p>
-->

## What is Rune?

Rune is a cross-platform markdown writer that formats **as you type** — code, Mermaid diagrams, math, and tables turn live while the page stays calm. It's built in Rust ([Tauri 2](https://tauri.app)) for native speed and a small footprint, with **first-class Korean / CJK** typography.

## Features

- ✍️ **Inline live preview** — formatting applies as you type; only the cursor's line shows raw markdown
- 🎨 **Code highlighting · Mermaid · KaTeX math · GFM tables** — rich blocks render in place
- 🖼️ **Images** — paste or drop; saved beside your doc in `assets/` and shown inline
- 🗂️ **Workspace** — open a folder, browse the file tree, debounced autosave
- 🧩 **Multi-tab** — Chrome-like tabs; each keeps its own content, cursor, and undo history
- ⌘ **Command palette** (Ctrl/Cmd-K) **· full-text search · external-change watch**
- 📤 **Export** — self-contained HTML and PDF
- 🌐 **Four languages** — English · 한국어 · 日本語 · 简体中文
- 🌗 **Light & dark** — a calm, minimal theme
- ⚡ **Fast & small** — Rust core, native webview

## Download

Get the latest installer for your OS from the [**Releases**](https://github.com/JangHyun-bin/Rune/releases/latest) page:

| OS | Download |
|----|----------|
| **macOS** · Apple Silicon | [`Rune_0.1.9_aarch64.dmg`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.9/Rune_0.1.9_aarch64.dmg) |
| **macOS** · Intel | [`Rune_0.1.9_x64.dmg`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.9/Rune_0.1.9_x64.dmg) |
| **Windows** | [`.msi`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.9/Rune_0.1.9_x64_en-US.msi) · [`.exe`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.9/Rune_0.1.9_x64-setup.exe) |
| **Linux** | [`.deb`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.9/Rune_0.1.9_amd64.deb) · [`.rpm`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.9/Rune-0.1.9-1.x86_64.rpm) · [`.AppImage`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.9/Rune_0.1.9_amd64.AppImage) |

> **macOS:** CI builds signed DMGs. Notarization is currently a manual post-release step.

## Why Rune?

A calm, precise canvas for thinking and writing. Four principles guide it:

- **Focused** — one thing, done well; nothing between you and the words.
- **Quiet** — the interface recedes so the text leads.
- **Precise** — atomic saves and accurate rendering you can trust.
- **Structured** — structure creates freedom.

## Built with

[Tauri 2](https://tauri.app) (Rust core) · [CodeMirror 6](https://codemirror.net) · TypeScript · [Vite](https://vite.dev). Design system: [`docs/design.md`](docs/design.md).

## Development

```bash
npm install
npm run tauri dev            # run the desktop app (dev mode)
npm test                     # frontend tests (Vitest)
cd src-tauri && cargo test   # Rust core tests
npm run tauri build          # build installers for the current OS
```

Pushing a `v*` tag triggers GitHub Actions to build Windows/macOS/Linux installers and publish a release ([`.github/workflows/release.yml`](.github/workflows/release.yml)).

## Roadmap

- macOS notarization
- Performance & bundle code-splitting
- IME / CJK input refinements
- Plugin system (exploring)
- More export targets

## Contributing

Issues and PRs are welcome. Clone, run `npm install`, then `npm run tauri dev` to get started (see [Development](#development)). Translation help is especially appreciated — UI strings live in [`src/i18n/i18n.ts`](src/i18n/i18n.ts).

## Internationalization

The UI ships in **English · 한국어 · 日本語 · 简体中文**, switchable in Settings (⚙) and auto-detected from your OS.

## License

[MIT](LICENSE) © 2026 Hyunbin Jang
