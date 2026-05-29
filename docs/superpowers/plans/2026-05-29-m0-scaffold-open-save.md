# M0 — 스캐폴드 + 단일 파일 열기/저장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tauri 2 앱이 `.md` 파일을 열어 CodeMirror 6에서 편집하고, 원자적으로 저장하는 최소 수직 슬라이스를 완성한다 (3 OS 빌드 가능).

**Architecture:** Tauri 2 = Rust 코어(파일 I/O, 신뢰 경계) + 웹뷰 프론트(TS, CodeMirror 6). 파일 시스템은 Rust만 접근하고 프론트는 타입 안전 IPC(tauri-specta)로 요청한다. 저장은 temp 파일 쓰기 후 rename(원자적).

**Tech Stack:** Tauri 2, Rust, `tauri-plugin-dialog`, `tauri-specta` + `specta`; TypeScript, Vite, CodeMirror 6, Vitest.

> **이 계획의 범위는 M0뿐이다.** Live Preview(인라인 WYSIWYG), Mermaid/KaTeX/Shiki, 파일 트리, 자동저장, 검색, 내보내기는 M1–M5의 별도 계획에서 다룬다. 스펙: `docs/superpowers/specs/2026-05-29-cross-platform-markdown-editor-design.md`.

---

## 사전 준비 (실행 전 1회)

각 OS의 Tauri 2 사전 요구사항이 설치되어 있어야 한다 (Rust stable, Node ≥ 18, 그리고 플랫폼별 웹뷰 빌드 도구).
- Windows: Microsoft C++ Build Tools + WebView2 (Win11 기본 포함)
- macOS: Xcode Command Line Tools
- Linux: `webkit2gtk`, `libayatana-appindicator`, `librsvg` 등 (Tauri 문서의 Linux 의존성)

확인:
```bash
rustc --version   # stable
node --version    # >= 18
```

---

## 파일 구조 (M0 종료 시점)

```
cp_markdown/
├─ index.html                      # 앱 진입 HTML
├─ package.json                    # 프론트 스크립트/의존성
├─ vite.config.ts                  # Vite + Vitest 설정
├─ tsconfig.json
├─ src/                            # 프론트엔드 (TypeScript)
│  ├─ main.ts                      # 진입: 에디터 마운트 + 열기/저장 와이어링
│  ├─ editor/editor.ts             # CodeMirror 6 생성/텍스트 설정
│  ├─ doc/document.ts              # 순수 문서/dirty 모델 (테스트 대상)
│  ├─ doc/document.test.ts         # Vitest
│  └─ ipc/bindings.ts             # tauri-specta가 생성 (커밋함)
└─ src-tauri/
   ├─ Cargo.toml
   ├─ tauri.conf.json
   ├─ capabilities/default.json    # dialog 권한 추가
   └─ src/
      ├─ main.rs                   # cp_markdown_lib::run() 호출 (템플릿 기본)
      ├─ lib.rs                    # tauri 빌더 + 커맨드 등록 + specta export
      ├─ fs_ops.rs                 # read/write(atomic) + 단위 테스트
      └─ commands.rs               # #[tauri::command] 래퍼
```

각 파일의 단일 책임:
- `fs_ops.rs` — 디스크 입출력 로직(순수, 테스트 가능). Tauri 비의존.
- `commands.rs` — IPC 경계. `fs_ops`를 호출하는 얇은 커맨드.
- `lib.rs` — 앱 조립(빌더, 플러그인, 바인딩 export).
- `doc/document.ts` — UI 비의존 문서 상태 모델(순수 함수).
- `editor/editor.ts` — CM6 어댑터.
- `main.ts` — 조립/와이어링.

---

## Task 0: Tauri 2 + Vite TS 스캐폴드

**Files:**
- Create: 프로젝트 템플릿 일체 (`index.html`, `package.json`, `vite.config.ts`, `tsconfig.json`, `src/`, `src-tauri/`)

- [ ] **Step 1: 현재 디렉토리에 vanilla-ts 템플릿 스캐폴드**

현재 폴더에는 이미 `.git/`, `docs/`, `.gitignore`, `.superpowers/`가 있다. create-tauri-app은 현재 디렉토리(`.`)를 허용한다.

Run:
```bash
npm create tauri-app@latest . -- --template vanilla-ts --manager npm --identifier com.cpmarkdown.app
```
스캐폴더가 비어있지 않은 디렉토리를 거부하면: 임시 폴더에 생성 후 `src/`, `src-tauri/`, `index.html`, `package.json`, `vite.config.ts`, `tsconfig.json`만 현재 폴더로 복사한다(기존 `docs/`, `.git/`, `.gitignore` 보존).

- [ ] **Step 2: 의존성 설치 및 dev 실행 확인**

Run:
```bash
npm install
npm run tauri dev
```
Expected: 데스크톱 창이 뜨고 기본 템플릿 페이지가 보인다. 확인 후 창을 닫는다(Ctrl-C).

- [ ] **Step 3: 라이브러리 크레이트 이름 확인**

`src-tauri/Cargo.toml`의 `[lib] name`을 확인한다(보통 `cp_markdown_lib`). 이 이름을 이후 `main.rs`와 테스트에서 사용한다.

Run:
```bash
grep -A1 "\[lib\]" src-tauri/Cargo.toml
```
Expected: `name = "cp_markdown_lib"` (또는 유사). 이후 단계에서 이 이름을 그대로 쓴다.

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "chore: scaffold Tauri 2 + Vite TS app"
```

---

## Task 1: Rust 파일 I/O (원자적 저장) — TDD

**Files:**
- Create: `src-tauri/src/fs_ops.rs`
- Modify: `src-tauri/src/lib.rs` (모듈 선언 추가)
- Modify: `src-tauri/Cargo.toml` (dev-deps: `tempfile`)

- [ ] **Step 1: 실패하는 테스트 작성**

Create `src-tauri/src/fs_ops.rs`:
```rust
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_write_then_read() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("note.md");
        write_text_file_atomic(&file, "# Hello\n").unwrap();
        assert_eq!(read_text_file(&file).unwrap(), "# Hello\n");
    }

    #[test]
    fn atomic_write_overwrites_existing() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("note.md");
        write_text_file_atomic(&file, "v1").unwrap();
        write_text_file_atomic(&file, "v2 longer").unwrap();
        assert_eq!(read_text_file(&file).unwrap(), "v2 longer");
    }

    #[test]
    fn read_missing_file_is_err() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("nope.md");
        assert!(read_text_file(&file).is_err());
    }
}
```

Modify `src-tauri/Cargo.toml` — `[dev-dependencies]`에 추가:
```bash
cd src-tauri && cargo add --dev tempfile && cd ..
```

Modify `src-tauri/src/lib.rs` — 파일 상단에 모듈 선언 추가:
```rust
mod fs_ops;
```

- [ ] **Step 2: 컴파일 실패 확인**

Run:
```bash
cd src-tauri && cargo test fs_ops 2>&1 | head -20; cd ..
```
Expected: `read_text_file`/`write_text_file_atomic` 미정의로 컴파일 에러.

- [ ] **Step 3: 최소 구현**

`src-tauri/src/fs_ops.rs`의 `#[cfg(test)]` 위에 추가:
```rust
/// UTF-8 텍스트 파일을 읽는다.
pub fn read_text_file(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| format!("read failed: {e}"))
}

/// 원자적 쓰기: 같은 디렉토리에 temp로 쓰고 fsync 후 rename.
pub fn write_text_file_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let tmp = temp_sibling(path);
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("create temp failed: {e}"))?;
        f.write_all(contents.as_bytes()).map_err(|e| format!("write temp failed: {e}"))?;
        f.sync_all().map_err(|e| format!("sync failed: {e}"))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("rename failed: {e}"))?;
    Ok(())
}

fn temp_sibling(path: &Path) -> PathBuf {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let mut p = path.to_path_buf();
    p.set_file_name(format!(".{name}.tmp"));
    p
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
cd src-tauri && cargo test fs_ops; cd ..
```
Expected: 3개 테스트 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src-tauri/src/fs_ops.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(core): atomic file read/write with tests"
```

---

## Task 2: 타입 안전 IPC 커맨드 + tauri-specta 바인딩

**Files:**
- Create: `src-tauri/src/commands.rs`
- Create: `src/ipc/bindings.ts` (생성됨)
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml` (deps)

- [ ] **Step 1: Rust IPC/specta 의존성 추가**

Run:
```bash
cd src-tauri
cargo add tauri-plugin-dialog
cargo add specta
cargo add specta-typescript
cargo add tauri-specta --features derive,typescript
cd ..
```

- [ ] **Step 2: 커맨드 작성**

Create `src-tauri/src/commands.rs`:
```rust
use crate::fs_ops;
use std::path::PathBuf;

#[tauri::command]
#[specta::specta]
pub fn read_file(path: String) -> Result<String, String> {
    fs_ops::read_text_file(&PathBuf::from(path))
}

#[tauri::command]
#[specta::specta]
pub fn write_file(path: String, contents: String) -> Result<(), String> {
    fs_ops::write_text_file_atomic(&PathBuf::from(path), &contents)
}
```

- [ ] **Step 3: 빌더 조립 + 바인딩 export 테스트 작성**

Replace `src-tauri/src/lib.rs` 전체:
```rust
mod fs_ops;
mod commands;

use tauri_specta::{collect_commands, Builder};

fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new()
        .commands(collect_commands![commands::read_file, commands::write_file])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = specta_builder();

    #[cfg(debug_assertions)]
    builder
        .export(specta_typescript::Typescript::default(), "../src/ipc/bindings.ts")
        .expect("failed to export typescript bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(builder.invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod export_tests {
    use super::*;

    #[test]
    fn export_bindings() {
        specta_builder()
            .export(specta_typescript::Typescript::default(), "../src/ipc/bindings.ts")
            .expect("export failed");
    }
}
```

- [ ] **Step 4: 바인딩 생성(테스트 실행)**

Run:
```bash
mkdir -p src/ipc
cd src-tauri && cargo test export_bindings; cd ..
```
Expected: 테스트 PASS, `src/ipc/bindings.ts` 생성됨. 파일에 `commands.readFile`, `commands.writeFile` 타입이 보인다.

Run:
```bash
grep -E "readFile|writeFile" src/ipc/bindings.ts | head
```
Expected: 두 커맨드의 타입 시그니처가 출력된다.

> **버전 충돌 시 폴백:** specta/tauri-specta(2.x rc) 통합이 막히면, 부록 A의 수동 `bindings.ts` 래퍼로 대체하고 Step 3의 export 코드/테스트는 생략한다. 이후 단계는 동일하게 `import { commands } from "./ipc/bindings"`로 동작한다.

- [ ] **Step 5: 커밋**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock src/ipc/bindings.ts
git commit -m "feat(ipc): typed read_file/write_file commands via tauri-specta"
```

---

## Task 3: 프론트 문서 모델 (dirty 추적) — TDD

**Files:**
- Create: `src/doc/document.ts`, `src/doc/document.test.ts`
- Modify: `package.json` (vitest 스크립트), `vite.config.ts` (test 설정)

- [ ] **Step 1: Vitest 설치 및 설정**

Run:
```bash
npm i -D vitest
```

Modify `vite.config.ts` — 최상단에 추가하고 `defineConfig`에 `test` 추가:
```ts
/// <reference types="vitest" />
```
그리고 설정 객체에:
```ts
  test: { environment: "node", include: ["src/**/*.test.ts"] },
```

Modify `package.json` `"scripts"`에 추가:
```json
"test": "vitest run"
```

- [ ] **Step 2: 실패하는 테스트 작성**

Create `src/doc/document.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { newDoc, loadedDoc, withCurrentText, markSaved, isDirty } from "./document";

describe("document model", () => {
  it("new doc is not dirty", () => {
    expect(isDirty(newDoc())).toBe(false);
  });
  it("editing makes it dirty", () => {
    const d = withCurrentText(loadedDoc("/a.md", "x"), "xy");
    expect(isDirty(d)).toBe(true);
  });
  it("saving clears dirty and updates savedText", () => {
    const d = markSaved(withCurrentText(loadedDoc("/a.md", "x"), "xy"));
    expect(isDirty(d)).toBe(false);
    expect(d.savedText).toBe("xy");
  });
  it("loadedDoc records path and is clean", () => {
    const d = loadedDoc("/a.md", "hello");
    expect(d.path).toBe("/a.md");
    expect(isDirty(d)).toBe(false);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run:
```bash
npm test
```
Expected: `./document` 모듈 미존재로 실패.

- [ ] **Step 4: 최소 구현**

Create `src/doc/document.ts`:
```ts
export interface DocState {
  path: string | null;
  savedText: string;
  currentText: string;
}

export function newDoc(): DocState {
  return { path: null, savedText: "", currentText: "" };
}

export function loadedDoc(path: string, text: string): DocState {
  return { path, savedText: text, currentText: text };
}

export function withCurrentText(doc: DocState, text: string): DocState {
  return { ...doc, currentText: text };
}

export function markSaved(doc: DocState): DocState {
  return { ...doc, savedText: doc.currentText };
}

export function isDirty(doc: DocState): boolean {
  return doc.currentText !== doc.savedText;
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run:
```bash
npm test
```
Expected: 4개 테스트 PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/doc/document.ts src/doc/document.test.ts package.json package-lock.json vite.config.ts
git commit -m "feat(doc): pure document model with dirty tracking + tests"
```

---

## Task 4: CodeMirror 6 에디터 모듈

**Files:**
- Create: `src/editor/editor.ts`
- Modify: `package.json` (CM6 의존성)

- [ ] **Step 1: CodeMirror 6 설치**

Run:
```bash
npm i @codemirror/state @codemirror/view @codemirror/commands @codemirror/lang-markdown
```

- [ ] **Step 2: 에디터 모듈 작성**

Create `src/editor/editor.ts`:
```ts
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";

/** 마운트하고, 내용이 바뀔 때마다 onChange(text)를 호출하는 뷰를 만든다. */
export function createEditor(
  parent: HTMLElement,
  doc: string,
  onChange: (text: string) => void,
): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onChange(u.state.doc.toString());
      }),
    ],
  });
  return new EditorView({ state, parent });
}

/** 에디터 전체 내용을 text로 교체한다(파일 열기 시). */
export function setEditorText(view: EditorView, text: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
}
```

- [ ] **Step 3: 타입체크 확인**

Run:
```bash
npx tsc --noEmit
```
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/editor/editor.ts package.json package-lock.json
git commit -m "feat(editor): CodeMirror 6 markdown editor module"
```

---

## Task 5: 열기/저장 와이어링 + 단축키

**Files:**
- Modify: `src/main.ts` (전체 교체)
- Modify: `index.html` (`#app` 컨테이너)
- Modify: `src-tauri/capabilities/default.json` (dialog 권한)
- Modify: `package.json` (`@tauri-apps/plugin-dialog`)

- [ ] **Step 1: 다이얼로그 플러그인(JS) 설치**

Run:
```bash
npm i @tauri-apps/plugin-dialog
```

- [ ] **Step 2: dialog 권한 추가**

Modify `src-tauri/capabilities/default.json` — `"permissions"` 배열에 추가:
```json
"dialog:allow-open",
"dialog:allow-save"
```

- [ ] **Step 3: index.html에 컨테이너 보장**

`index.html`의 `<body>`가 아래를 포함하도록 수정:
```html
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
```

- [ ] **Step 4: main.ts 와이어링**

Replace `src/main.ts` 전체:
```ts
import { createEditor, setEditorText } from "./editor/editor";
import {
  newDoc, loadedDoc, withCurrentText, markSaved, isDirty, type DocState,
} from "./doc/document";
import { commands } from "./ipc/bindings";
import { open, save } from "@tauri-apps/plugin-dialog";

let docState: DocState = newDoc();

const appEl = document.getElementById("app")!;
const view = createEditor(appEl, "", (text) => {
  docState = withCurrentText(docState, text);
  updateTitle();
});

function updateTitle(): void {
  const name = docState.path ?? "Untitled";
  document.title = (isDirty(docState) ? "● " : "") + name + " — cp_markdown";
}
updateTitle();

async function openFile(): Promise<void> {
  const selected = await open({
    multiple: false,
    filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
  });
  if (typeof selected !== "string") return;
  const res = await commands.readFile(selected);
  if (res.status === "error") { console.error(res.error); return; }
  docState = loadedDoc(selected, res.data);
  setEditorText(view, res.data);
  updateTitle();
}

async function saveFile(): Promise<void> {
  let path = docState.path;
  if (!path) {
    const chosen = await save({ filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (typeof chosen !== "string") return;
    path = chosen;
  }
  const res = await commands.writeFile(path, docState.currentText);
  if (res.status === "error") { console.error(res.error); return; }
  docState = markSaved({ ...docState, path });
  updateTitle();
}

window.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); void openFile(); }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void saveFile(); }
});
```

> `commands.readFile`가 반환하는 Result 형태(`{ status: "ok", data } | { status: "error", error }`)는 tauri-specta 생성 타입이다. 부록 A 폴백을 쓰는 경우에도 동일한 형태를 유지한다.

- [ ] **Step 5: 타입체크**

Run:
```bash
npx tsc --noEmit
```
Expected: 에러 없음.

- [ ] **Step 6: 수동 동작 검증**

Run:
```bash
npm run tauri dev
```
검증:
1. Ctrl/Cmd-O → `.md` 파일 선택 → 내용이 에디터에 로드되고 제목이 파일명으로 바뀐다.
2. 텍스트 수정 → 제목에 `●`(dirty) 표시.
3. Ctrl/Cmd-S → 저장 후 `●` 사라짐.
4. 디스크에서 파일을 직접 열어 변경분이 반영됐는지 확인.
5. 새 파일: 빈 상태에서 입력 → Ctrl/Cmd-S → 저장 위치 선택 → 파일 생성 확인.

- [ ] **Step 7: 커밋**

```bash
git add src/main.ts index.html src-tauri/capabilities/default.json package.json package-lock.json
git commit -m "feat: wire open/save with dialogs and keyboard shortcuts"
```

---

## Task 6: M0 마무리 검증 + 빌드 확인

**Files:** 없음(검증 전용)

- [ ] **Step 1: 전체 테스트 실행**

Run:
```bash
npm test
cd src-tauri && cargo test; cd ..
```
Expected: 프론트 4 PASS, Rust(fs_ops 3 + export 1) PASS.

- [ ] **Step 2: 릴리스 빌드 확인(현재 OS)**

Run:
```bash
npm run tauri build
```
Expected: 빌드 성공, `src-tauri/target/release/` 에 실행 파일/번들 생성.

- [ ] **Step 3: README에 M0 실행법 기록**

Create/Modify `README.md`:
```markdown
# cp_markdown

크로스플랫폼 집중형 마크다운 에디터 (Tauri 2 + CodeMirror 6).

## 개발
\`\`\`bash
npm install
npm run tauri dev
\`\`\`

## 테스트
\`\`\`bash
npm test           # 프론트(Vitest)
cd src-tauri && cargo test   # 코어(Rust)
\`\`\`

## M0 상태
파일 열기/편집/원자적 저장 동작. 설계: docs/superpowers/specs/2026-05-29-cross-platform-markdown-editor-design.md
```

- [ ] **Step 4: 커밋 + 푸시**

```bash
git add README.md
git commit -m "docs: add README with M0 run/test instructions"
git push
```

---

## 부록 A — 수동 IPC 바인딩 폴백 (tauri-specta 버전 충돌 시에만)

Task 2의 specta export가 막히면 `src/ipc/bindings.ts`를 직접 작성한다(Step 3의 export 코드/테스트는 생략, `lib.rs`는 `tauri::generate_handler!`로 커맨드 등록):

`src-tauri/src/lib.rs`의 invoke 핸들러를 표준 방식으로:
```rust
        .invoke_handler(tauri::generate_handler![commands::read_file, commands::write_file])
```
그리고 `commands.rs`에서 `#[specta::specta]` 줄을 제거.

Create `src/ipc/bindings.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";

export type Result<T> =
  | { status: "ok"; data: T }
  | { status: "error"; error: string };

async function call<T>(cmd: string, args: Record<string, unknown>): Promise<Result<T>> {
  try {
    return { status: "ok", data: (await invoke(cmd, args)) as T };
  } catch (error) {
    return { status: "error", error: String(error) };
  }
}

export const commands = {
  readFile: (path: string) => call<string>("read_file", { path }),
  writeFile: (path: string, contents: string) =>
    call<null>("write_file", { path, contents }),
};
```
이 형태는 Task 5의 사용처와 동일한 `{ status, data|error }` 계약을 유지하므로 다른 코드는 바뀌지 않는다.

---

## 다음 마일스톤 (별도 계획으로 작성 예정)
- **M1** — Live Preview(인라인 디코레이션 + 활성 줄 원본 노출), 표준 마크다운, 라이트/다크 테마 + Pretendard 번들.
- **M2** — 코드(Shiki)·수식(KaTeX)·Mermaid·표·이미지(붙여넣기/드롭 + asset 저장).
- **M3** — 폴더 열기 + 파일 트리 + watcher + 외부 변경 충돌 처리, 자동저장, 커맨드 팔레트.
- **M4** — HTML/PDF 내보내기, tantivy 전문 검색.
- **M5** — 디자인 폴리시, 성능 예산, IME/CJK, 3 OS QA, 인스톨러.
