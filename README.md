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

## 현황 — M1

- **M0** — 파일 열기(Ctrl/Cmd-O) · 편집 · 원자적 저장(Ctrl/Cmd-S)
- **M1** — 인라인 Live Preview(입력 즉시 서식, 커서 줄만 원본 노출) · Pretendard 라이트/다크 테마 · 최소 크롬(상단·상태바)

- 설계 스펙: `docs/superpowers/specs/2026-05-29-cross-platform-markdown-editor-design.md`
- 구현 계획: `docs/superpowers/plans/` (M0, M1)

다음(M2): 코드블록 하이라이팅 · Mermaid · KaTeX 수식 · 표 · 이미지(붙여넣기/드롭).
