# README Overhaul — Design Spec

> Turn the developer-milestone README into a product-facing README modeled on well-structured OSS desktop apps (Marktext, Spacedrive, AppFlowy). English primary + Korean mirror, MIT licensed.

Date 2026-06-03 · Brand source of truth: `docs/design.md`

## Decisions (approved)
- **Language:** English is the primary `README.md`; a Korean mirror lives at `README.ko.md`. Each links the other at the top (`English · 한국어`).
- **License:** **MIT**. Add a `LICENSE` file (MIT, © 2026 Hyunbin Jang) and a License section.
- **Structure:** product-first (hero → screenshot → pitch → features → download → why → built-with → development → roadmap → contributing → i18n → license).
- **Hero visual:** a branded banner (sparkle + `RUNE` wordmark + tagline) generated via the brand pipeline. App screenshots: a reserved placeholder for now (light/dark) — added later when captured.

## Files
- **Create** `README.md` (English, product-first) — replaces the current dev-milestone README.
- **Create** `README.ko.md` (Korean mirror, same structure/content).
- **Create** `LICENSE` (MIT, © 2026 Hyunbin Jang).
- **Create** `assets/brand/readme-hero.png` (+ `.svg`) — the README hero banner, generated.
- **Modify** `tools/gen-brand-assets.mjs` — add a `readme-hero` banner output (sparkle + wordmark + tagline on the Ink/Paper palette).
- **Create** `docs/screenshots/` placeholder note (real screenshots dropped in later).

## README section spec (English; Korean mirror = same, translated)

Top: language switcher line + a compact **Table of Contents**.

1. **Hero (centered)** — `assets/brand/readme-hero.png`; tagline **"The focused markdown writer for desktop."**; badge row: `License: MIT` · `Release` (shields.io, links to releases/latest) · `Platforms: Windows · macOS · Linux` · `Built with Tauri + Rust`; CTA: **⬇ Download** (→ `releases/latest`) and **★ Star**.
2. **Screenshot** — placeholder image refs `docs/screenshots/light.png` / `dark.png` with an HTML comment noting they're pending capture.
3. **What is Rune?** — 2-sentence elevator pitch: formats *as you type* (code/Mermaid/math/tables go live, page stays calm); Rust (Tauri 2) for native speed; first-class Korean/CJK.
4. **Features** — benefit-led list with emoji: inline live preview (WYSIWYG, cursor-line shows source) · code highlighting · Mermaid · KaTeX math · GFM tables · paste/drop images → local `assets/` · folder workspace + file tree · Chrome-like multitab · command palette (⌘K) · full-text search · external-change watch · HTML/PDF export · 4 languages (en/ko/ja/zh-Hans) · light/dark · fast & small (Rust core).
5. **Download** — OS table with direct v0.1.1 asset links:
   - macOS Apple Silicon → `releases/download/v0.1.1/Rune_0.1.1_aarch64.dmg`
   - macOS Intel → `releases/download/v0.1.1/Rune_0.1.1_x64.dmg`
   - Windows → `Rune_0.1.1_x64_en-US.msi` / `Rune_0.1.1_x64-setup.exe`
   - Linux → `Rune_0.1.1_amd64.deb` / `Rune-0.1.1-1.x86_64.rpm` / `Rune_0.1.1_amd64.AppImage`
   - Note: macOS first launch = right-click → Open (signed, not notarized). Link to `releases/latest` for newer versions.
6. **Why Rune?** — brand pillars **Focused · Quiet · Precise · Structured** + one short paragraph (calm, distraction-free canvas; structure creates freedom).
7. **Built with** — Tauri 2 (Rust core) · CodeMirror 6 · TypeScript · Vite. Link to `docs/design.md` (design system).
8. **Development** — copy-paste block: `npm install`; `npm run tauri dev`; `npm test` + `cd src-tauri && cargo test`; `npm run tauri build`. Note tag-push → CI release.
9. **Roadmap** — macOS notarization · performance / bundle code-splitting · IME/CJK refinements · plugin system (exploring) · more export targets.
10. **Contributing** — short welcome + how to run/build (links to Development); issues/PRs welcome.
11. **Internationalization** — UI in English · 한국어 · 日本語 · 简体中文; translation contributions welcome (point to `src/i18n/i18n.ts`).
12. **License** — MIT © 2026 Hyunbin Jang (link `LICENSE`).

## Out of scope
- Real app screenshots/GIF (placeholder now; captured later).
- CONTRIBUTING.md / CODE_OF_CONDUCT (can follow; README has an inline Contributing section).
- Marketing landing page (separate; same DI from `docs/design.md`).

## Notes
- Badges via shields.io (no extra deps). Release badge: `https://img.shields.io/github/v/release/JangHyun-bin/Rune`.
- Repo is public, renamed to `JangHyun-bin/Rune`; all links use that path.
- Korean mirror keeps identical section order; numbers/links identical.
