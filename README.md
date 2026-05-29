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

## 현황 — M0

파일 열기(Ctrl/Cmd-O) · 편집 · 원자적 저장(Ctrl/Cmd-S)이 동작합니다.

- 설계 스펙: `docs/superpowers/specs/2026-05-29-cross-platform-markdown-editor-design.md`
- M0 계획: `docs/superpowers/plans/2026-05-29-m0-scaffold-open-save.md`

다음 단계(M1+): Live Preview(인라인 WYSIWYG), Mermaid · KaTeX · 코드 하이라이트, 파일 트리, 자동저장, 검색, 내보내기.
