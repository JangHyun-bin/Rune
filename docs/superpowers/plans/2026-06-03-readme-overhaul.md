# README Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the developer-milestone README with a product-first English `README.md` (modeled on Marktext/Spacedrive/AppFlowy), add a Korean mirror `README.ko.md`, an MIT `LICENSE`, and a generated hero image.

**Architecture:** Pure docs/assets change — no app code. The hero image is produced by the existing brand generator (`tools/gen-brand-assets.mjs`, reusing the dark halftone sparkle). README media lives under `docs/`. A small Vitest guard asserts the README keeps its key sections, the v0.1.1 download links, and that `LICENSE`/`README.ko.md` exist.

**Tech Stack:** Markdown, shields.io badges, `@resvg/resvg-js` (already a devDep), Vitest.

Spec: `docs/superpowers/specs/2026-06-03-readme-overhaul-design.md`. Repo: `JangHyun-bin/Rune` (public). Current release: `v0.1.1`.

---

## File Structure
- **Create** `LICENSE` — MIT, © 2026 Hyunbin Jang.
- **Modify** `tools/gen-brand-assets.mjs` — also emit `docs/hero.png` (dark halftone sparkle, 512px).
- **Create** `docs/hero.png` — generated (committed).
- **Create** `README.md` — product-first English (replaces current dev README).
- **Create** `README.ko.md` — Korean mirror (same structure/links).
- **Create** `src/readme.test.ts` — structure/links regression guard.

> README screenshots are intentionally an HTML comment (no broken images) until real captures are dropped into `docs/screenshots/`.

---

## Task 1: MIT LICENSE

**Files:** Create `LICENSE`

- [ ] **Step 1: Create `LICENSE`** with exactly:

```
MIT License

Copyright (c) 2026 Hyunbin Jang

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: Commit**

```bash
git add LICENSE
git commit -m "docs: add MIT license"
```

---

## Task 2: Hero image (via brand generator)

**Files:** Modify `tools/gen-brand-assets.mjs`; Create `docs/hero.png`

- [ ] **Step 1: Add the hero output.** In `tools/gen-brand-assets.mjs`, after the line that writes `tools/.out/rune-icon-1024.png`, add:

```js
// README hero — dark halftone sparkle (512px PNG, committed under docs/)
writeFileSync(join(root, "docs/hero.png"),
  new Resvg(assets["sparkle-halftone-dark.svg"], { fitTo: { mode: "width", value: 512 } }).render().asPng());
```
(`docs/` already exists; `assets` and `Resvg` are already in scope in the script.)

- [ ] **Step 2: Generate**

Run: `npm run gen:brand`
Expected: console `brand assets written: ...`; `docs/hero.png` exists (a real PNG, > 5 KB).

Verify:
```bash
ls -la docs/hero.png
```

- [ ] **Step 3: Commit**

```bash
git add tools/gen-brand-assets.mjs docs/hero.png
git commit -m "feat(brand): generate docs/hero.png for README"
```

---

## Task 3: English README.md (product-first)

**Files:** Create `README.md` (overwrite the existing one)

- [ ] **Step 1: Write `README.md`** with exactly this content:

````markdown
<div align="center">

<img src="docs/hero.png" width="140" alt="Rune" />

# Rune

**The focused markdown writer for desktop.**

[![License: MIT](https://img.shields.io/badge/License-MIT-114ADB.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/JangHyun-bin/Rune?color=114ADB)](https://github.com/JangHyun-bin/Rune/releases/latest)
![Platforms](https://img.shields.io/badge/platforms-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-6B717A)
![Built with Tauri + Rust](https://img.shields.io/badge/built%20with-Tauri%20%2B%20Rust-2C3138)

[**⬇ Download**](https://github.com/JangHyun-bin/Rune/releases/latest) · [Why Rune?](#why-rune) · [Build from source](#development)

English · [한국어](README.ko.md)

</div>

---

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
| **macOS** · Apple Silicon | [`Rune_0.1.1_aarch64.dmg`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.1/Rune_0.1.1_aarch64.dmg) |
| **macOS** · Intel | [`Rune_0.1.1_x64.dmg`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.1/Rune_0.1.1_x64.dmg) |
| **Windows** | [`.msi`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.1/Rune_0.1.1_x64_en-US.msi) · [`.exe`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.1/Rune_0.1.1_x64-setup.exe) |
| **Linux** | [`.deb`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.1/Rune_0.1.1_amd64.deb) · [`.rpm`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.1/Rune-0.1.1-1.x86_64.rpm) · [`.AppImage`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.1/Rune_0.1.1_amd64.AppImage) |

> **macOS:** the app is signed but not yet notarized. On first launch, right-click the app → **Open** (or System Settings → Privacy & Security → **Open Anyway**). Afterwards it opens normally.

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
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: product-first English README"
```

---

## Task 4: Korean mirror README.ko.md

**Files:** Create `README.ko.md`

- [ ] **Step 1: Write `README.ko.md`** with exactly this content:

````markdown
<div align="center">

<img src="docs/hero.png" width="140" alt="Rune" />

# Rune

**집중을 위한 데스크톱 마크다운 라이터.**

[![License: MIT](https://img.shields.io/badge/License-MIT-114ADB.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/JangHyun-bin/Rune?color=114ADB)](https://github.com/JangHyun-bin/Rune/releases/latest)
![Platforms](https://img.shields.io/badge/platforms-Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-6B717A)
![Built with Tauri + Rust](https://img.shields.io/badge/built%20with-Tauri%20%2B%20Rust-2C3138)

[**⬇ 다운로드**](https://github.com/JangHyun-bin/Rune/releases/latest) · [왜 Rune?](#왜-rune) · [소스 빌드](#개발)

[English](README.md) · 한국어

</div>

---

<!-- 스크린샷: `npm run tauri dev`로 라이트/다크를 캡처해 docs/screenshots/{light,dark}.png 에 넣고 주석을 해제하세요.
<p align="center">
  <img src="docs/screenshots/light.png" width="48%" alt="Rune — 라이트" />
  <img src="docs/screenshots/dark.png" width="48%" alt="Rune — 다크" />
</p>
-->

## Rune이란?

Rune은 **입력하는 즉시** 서식이 적용되는 크로스플랫폼 마크다운 라이터입니다 — 코드·Mermaid·수식·표가 그 자리에서 살아나고, 화면은 차분하게 유지됩니다. Rust([Tauri 2](https://tauri.app)) 코어로 네이티브 속도와 작은 용량을 갖췄고, **한국어/CJK 타이포그래피를 1급으로** 다룹니다.

## 기능

- ✍️ **인라인 라이브 프리뷰** — 입력 즉시 서식 적용, 커서가 있는 줄만 원본 노출
- 🎨 **코드 하이라이팅 · Mermaid · KaTeX 수식 · GFM 표** — 리치 블록을 그 자리에서 렌더
- 🖼️ **이미지** — 붙여넣기/드롭 → 문서 옆 `assets/`에 저장 → 인라인 표시
- 🗂️ **워크스페이스** — 폴더 열기 + 파일 트리 + 디바운스 자동저장
- 🧩 **멀티탭** — 크롬 같은 탭; 탭별 내용·커서·undo 기록 보존
- ⌘ **커맨드 팔레트** (Ctrl/Cmd-K) **· 전문 검색 · 외부 변경 감시**
- 📤 **내보내기** — 자기완결 HTML · PDF
- 🌐 **4개 언어** — English · 한국어 · 日本語 · 简体中文
- 🌗 **라이트 & 다크** — 차분한 미니멀 테마
- ⚡ **빠르고 가벼움** — Rust 코어, 네이티브 웹뷰

## 다운로드

[**Releases**](https://github.com/JangHyun-bin/Rune/releases/latest) 페이지에서 OS에 맞는 최신 설치본을 받으세요:

| OS | 다운로드 |
|----|----------|
| **macOS** · Apple Silicon | [`Rune_0.1.1_aarch64.dmg`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.1/Rune_0.1.1_aarch64.dmg) |
| **macOS** · Intel | [`Rune_0.1.1_x64.dmg`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.1/Rune_0.1.1_x64.dmg) |
| **Windows** | [`.msi`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.1/Rune_0.1.1_x64_en-US.msi) · [`.exe`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.1/Rune_0.1.1_x64-setup.exe) |
| **Linux** | [`.deb`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.1/Rune_0.1.1_amd64.deb) · [`.rpm`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.1/Rune-0.1.1-1.x86_64.rpm) · [`.AppImage`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.1/Rune_0.1.1_amd64.AppImage) |

> **macOS:** 서명은 됐지만 아직 공증(notarize) 전입니다. 첫 실행 시 앱을 **우클릭 → 열기** (또는 시스템 설정 → 개인정보 보호 및 보안 → **확인 없이 열기**). 이후엔 정상적으로 열립니다.

## 왜 Rune?

사고와 글쓰기를 위한 차분하고 정밀한 캔버스. 네 가지 원칙을 따릅니다:

- **Focused** — 한 가지를 제대로; 글과 나 사이에 군더더기 없음.
- **Quiet** — 인터페이스는 물러나고 글이 주인공.
- **Precise** — 믿을 수 있는 원자적 저장과 정확한 렌더링.
- **Structured** — 구조가 자유를 만든다.

## 기술 스택

[Tauri 2](https://tauri.app) (Rust 코어) · [CodeMirror 6](https://codemirror.net) · TypeScript · [Vite](https://vite.dev). 디자인 시스템: [`docs/design.md`](docs/design.md).

## 개발

```bash
npm install
npm run tauri dev            # 데스크톱 앱 실행 (개발 모드)
npm test                     # 프론트엔드 테스트 (Vitest)
cd src-tauri && cargo test   # Rust 코어 테스트
npm run tauri build          # 현재 OS용 설치본 빌드
```

`v*` 태그를 푸시하면 GitHub Actions가 Windows/macOS/Linux 설치본을 빌드해 릴리스를 발행합니다 ([`.github/workflows/release.yml`](.github/workflows/release.yml)).

## 로드맵

- macOS 공증(notarization)
- 성능 · 번들 코드 스플리팅
- IME / CJK 입력 보정
- 플러그인 시스템 (검토 중)
- 내보내기 형식 확장

## 기여

이슈·PR 환영합니다. 클론 후 `npm install` → `npm run tauri dev`로 시작하세요 ([개발](#개발) 참고). 번역 기여는 특히 환영해요 — UI 문자열은 [`src/i18n/i18n.ts`](src/i18n/i18n.ts)에 있습니다.

## 다국어

UI는 **English · 한국어 · 日本語 · 简体中文**로 제공되며, 설정(⚙)에서 전환하거나 OS 언어로 자동 감지됩니다.

## 라이선스

[MIT](LICENSE) © 2026 Hyunbin Jang
````

- [ ] **Step 2: Commit**

```bash
git add README.ko.md
git commit -m "docs: Korean README mirror"
```

---

## Task 5: README structure guard + verify

**Files:** Create `src/readme.test.ts`

- [ ] **Step 1: Write the test** (`src/readme.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const at = (p: string) => new URL("../" + p, import.meta.url);
const readme = readFileSync(at("README.md"), "utf8");

describe("README", () => {
  it("keeps the core product sections", () => {
    for (const h of ["## What is Rune?", "## Features", "## Download", "## Why Rune?", "## Development", "## License"]) {
      expect(readme).toContain(h);
    }
  });
  it("links the v0.1.1 macOS dmg downloads", () => {
    expect(readme).toContain("Rune_0.1.1_aarch64.dmg");
    expect(readme).toContain("Rune_0.1.1_x64.dmg");
  });
  it("references the Korean mirror and the hero image", () => {
    expect(readme).toContain("README.ko.md");
    expect(readme).toContain("docs/hero.png");
  });
  it("ships LICENSE and the Korean mirror files", () => {
    expect(existsSync(at("LICENSE"))).toBe(true);
    expect(existsSync(at("README.ko.md"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/readme.test.ts`
Expected: PASS (4 tests). (`*.test.ts` is excluded from the production `tsc` build, so the `node:fs`/`node:url` imports don't affect `npm run build`.)

- [ ] **Step 3: Full gate**

Run: `npm test` (all pass) and `npm run build` (succeeds — README/LICENSE don't affect the bundle).

- [ ] **Step 4: Commit**

```bash
git add src/readme.test.ts
git commit -m "test: README structure + download-link guard"
```

---

## Self-Review (against the spec)
- **Language (EN main + KO mirror):** Task 3 (EN) + Task 4 (KO), cross-linked at top. ✔
- **License MIT + LICENSE file:** Task 1 + README License section (both languages). ✔
- **Product-first structure (hero→screenshot→pitch→features→download→why→built-with→dev→roadmap→contributing→i18n→license):** Tasks 3/4 follow it exactly; screenshot is a commented placeholder (no broken image). ✔
- **Hero visual generated:** Task 2 (`docs/hero.png` via generator). Wordmark "Rune" is a markdown H1 (GitHub renders its own font; Michroma stays for the app/marketing per design.md §4) — a deliberate, standard README choice, not a gap. ✔
- **Download links = real v0.1.1 assets:** verified against the published release; guarded by Task 5 test. ✔
- **Badges via shields.io (no deps):** Tasks 3/4. ✔
- **Placeholder scan:** none — full content provided for every file; screenshot block is an intentional commented-out section documented in the spec's "out of scope." ✔
- **Path consistency:** `docs/hero.png` produced (Task 2) and referenced (Tasks 3/4/5); `JangHyun-bin/Rune` used in all links. ✔
