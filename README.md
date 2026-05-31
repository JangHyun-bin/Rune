# cp_markdown

크로스플랫폼 집중형 마크다운 에디터 — Tauri 2 (Rust 코어) + CodeMirror 6.

## 개발

    npm install
    npm run tauri dev     # 데스크톱 앱 실행 (개발 모드)

## 테스트

    npm test                      # 프론트엔드 (Vitest)
    cd src-tauri && cargo test    # Rust 코어

## 빌드

    npm run tauri build -- --no-bundle   # 릴리스 바이너리 (설치 패키지 제외)

## 현황

- **M0** — 파일 열기(Ctrl/Cmd-O) · 편집 · 원자적 저장(Ctrl/Cmd-S)
- **M1** — 인라인 Live Preview(입력 즉시 서식, 커서 줄만 원본 노출) · Pretendard 라이트/다크 테마 · 최소 크롬(상단·상태바)
- **M2** — 리치 블록: 코드 신택스 하이라이팅 · Mermaid 다이어그램 · KaTeX 수식(인라인/블록) · GFM 표 (블록은 커서 진입 시 원본 노출)
- **이미지** — 붙여넣기/드롭 → 문서 옆 `assets/`에 해시 저장 → 인라인 렌더 (Rust `save_asset` + 에셋 프로토콜)

- 설계 스펙: `docs/superpowers/specs/2026-05-29-cross-platform-markdown-editor-design.md`
- 구현 계획: `docs/superpowers/plans/` (M0, M1, M2, 이미지)

다음: M3 워크스페이스(폴더 열기·파일 트리·watcher·자동저장·커맨드 팔레트) · M4 내보내기/검색 · M5 폴리시.
