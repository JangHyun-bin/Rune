<div align="center">

<img src="docs/hero.png" width="140" alt="Rune" />

# Rune

**집중을 위한 데스크톱 마크다운 라이터.**

[![License: MIT](https://img.shields.io/badge/License-MIT-114ADB.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/JangHyun-bin/Rune?sort=semver&color=114ADB)](https://github.com/JangHyun-bin/Rune/releases/latest)
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
| **macOS** · Apple Silicon | [`Rune_0.1.4_aarch64.dmg`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.4/Rune_0.1.4_aarch64.dmg) |
| **macOS** · Intel | [`Rune_0.1.4_x64.dmg`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.4/Rune_0.1.4_x64.dmg) |
| **Windows** | [`.msi`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.4/Rune_0.1.4_x64_en-US.msi) · [`.exe`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.4/Rune_0.1.4_x64-setup.exe) |
| **Linux** | [`.deb`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.4/Rune_0.1.4_amd64.deb) · [`.rpm`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.4/Rune-0.1.4-1.x86_64.rpm) · [`.AppImage`](https://github.com/JangHyun-bin/Rune/releases/download/v0.1.4/Rune_0.1.4_amd64.AppImage) |

> **macOS:** 서명 및 공증 완료 — 게이트키퍼 경고 없이 바로 열립니다.

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
