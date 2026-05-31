# M3a — 폴더 열기 + 사이드 파일 트리 + 자동저장 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 폴더를 열어 왼쪽 사이드바에 `.md` 파일 트리를 보고, 클릭해 문서를 전환하며(미저장 가드), 편집은 디바운스 자동저장된다.

**Architecture:** Rust 코어가 새 `list_dir` 커맨드로 폴더를 스캔해 트리(JSON)를 반환(파일 시스템은 Rust만). 프론트는 사이드바에 트리를 렌더하고 클릭 시 기존 `read_file`로 연다. 자동저장은 프론트 디바운스 + 창 blur 시 `write_file`, 저장 시점 텍스트를 스냅샷해 `markSavedAs`로 dirty 추적(M1 TOCTOU 해결).

**Tech Stack:** Rust(serde), CodeMirror 6, `@tauri-apps/plugin-dialog`(폴더 picker), Vitest.

> 범위: 폴더 열기 · 파일 트리 · 클릭 전환 · 자동저장. **외부 변경 감시(watcher)·커맨드 팔레트·설정 영속화는 M3b.** 스펙 §6/§7.
>
> **시각 검증:** 트리·전환은 사람이 `npm run tauri dev`로 확인·반복.

---

## 파일 구조
```
src-tauri/src/
├─ fs_ops.rs    # MODIFY: scan_dir(트리) + 테스트
├─ commands.rs  # MODIFY: list_dir 커맨드
src/
├─ ipc/bindings.ts   # MODIFY: listDir + FileNode 타입
├─ doc/document.ts   # MODIFY: markSavedAs (TOCTOU 해결)
├─ workspace/
│  ├─ fileTree.ts     # NEW: 트리 렌더(확장/접기, 클릭→열기 콜백)
│  └─ autosave.ts     # NEW: 디바운스 자동저장 확장
├─ main.ts            # MODIFY: 폴더 열기·트리 마운트·open-by-path·autosave 배선
index.html + styles.css  # MODIFY: 사이드바 영역
```

---

## Task 1: Rust `list_dir` (폴더 스캔 → 트리) TDD

**Files:** Modify `src-tauri/src/fs_ops.rs`, `src-tauri/src/commands.rs`, `src/ipc/bindings.ts`

- [ ] **Step 1: 실패 테스트** — `fs_ops.rs` 테스트 모듈에 추가:
```rust
    #[test]
    fn scan_dir_lists_md_and_subdirs_sorted() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("b.md"), "b").unwrap();
        std::fs::write(dir.path().join("a.md"), "a").unwrap();
        std::fs::write(dir.path().join("ignore.txt"), "x").unwrap();
        std::fs::write(dir.path().join("sub").join("c.md"), "c").unwrap();
        let nodes = scan_dir(dir.path(), 0);
        // dirs first, then files alpha; .txt excluded
        assert_eq!(nodes.iter().map(|n| n.name.as_str()).collect::<Vec<_>>(), vec!["sub", "a.md", "b.md"]);
        let sub = &nodes[0];
        assert!(sub.is_dir && sub.children.len() == 1 && sub.children[0].name == "c.md");
    }
```

- [ ] **Step 2: cargo test scan_dir → 컴파일 실패 확인**

- [ ] **Step 3: 구현** — `fs_ops.rs` 상단 `use serde::Serialize;` 추가하고:
```rust
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<FileNode>,
}

const IGNORE: &[&str] = &[".git", "node_modules", "target", ".superpowers"];

/// 폴더를 재귀 스캔해 트리를 만든다. dir 먼저·이름 오름차순, .md/.markdown 파일만(+ 모든 비무시 디렉토리). depth 제한.
pub fn scan_dir(root: &Path, depth: usize) -> Vec<FileNode> {
    if depth > 12 { return vec![]; }
    let mut dirs: Vec<FileNode> = vec![];
    let mut files: Vec<FileNode> = vec![];
    let Ok(entries) = fs::read_dir(root) else { return vec![]; };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || IGNORE.contains(&name.as_str()) { continue; }
        let path = e.path();
        let p = path.to_string_lossy().to_string();
        if path.is_dir() {
            dirs.push(FileNode { name, path: p, is_dir: true, children: scan_dir(&path, depth + 1) });
        } else if matches!(path.extension().and_then(|x| x.to_str()), Some("md") | Some("markdown")) {
            files.push(FileNode { name, path: p, is_dir: false, children: vec![] });
        }
    }
    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    dirs.into_iter().chain(files).collect()
}
```

- [ ] **Step 4: cargo test → 통과(8개)**

- [ ] **Step 5: 커맨드** — `commands.rs`:
```rust
#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<crate::fs_ops::FileNode>, String> {
    let p = std::path::PathBuf::from(&path);
    if !p.is_dir() { return Err(format!("폴더가 아님: {path}")); }
    Ok(crate::fs_ops::scan_dir(&p, 0))
}
```
`lib.rs`의 `generate_handler![...]`에 `commands::list_dir` 추가.

- [ ] **Step 6: 바인딩** — `src/ipc/bindings.ts`:
```ts
export interface FileNode { name: string; path: string; isDir: boolean; children: FileNode[]; }
```
그리고 commands 객체에:
```ts
  listDir: (path: string) => call<FileNode[]>("list_dir", { path }),
```

- [ ] **Step 7: 검증** `cd src-tauri ; cargo test ; cargo check ; cd ..` ; `npx tsc --noEmit` ; `npm run build`.

- [ ] **Step 8: 커밋** `git add src-tauri/src/fs_ops.rs src-tauri/src/commands.rs src-tauri/src/lib.rs src/ipc/bindings.ts` ; `git commit -m "feat(m3a): list_dir command — folder scan to file tree"`

---

## Task 2: 사이드바 레이아웃

**Files:** Modify `index.html`, `src/styles.css`

- [ ] **Step 1: index.html** — `#app` 안을 titlebar / (row: sidebar + editor) / statusbar 구조로:
```html
<body>
  <div id="app">
    <div id="titlebar"></div>
    <div id="body">
      <div id="sidebar"></div>
      <div id="editor"></div>
    </div>
    <div id="statusbar"></div>
  </div>
  <script type="module" src="/src/main.ts"></script>
</body>
```

- [ ] **Step 2: styles.css** — `#app`의 기존 flex 컬럼 유지하고 추가/수정:
```css
#body { flex: 1; min-height: 0; display: flex; }
#sidebar {
  width: 240px; flex-shrink: 0; overflow: auto; background: var(--faint);
  border-right: 1px solid var(--border); padding: 8px 6px; font-size: 13px;
}
#sidebar.hidden { display: none; }
#editor { flex: 1; min-height: 0; overflow: hidden; }
.ft-row { display: flex; align-items: center; gap: 5px; padding: 4px 8px; border-radius: 6px; cursor: pointer; color: #3b414d; white-space: nowrap; }
:root[data-theme="dark"] .ft-row { color: #c5c9d3; }
.ft-row:hover { background: var(--accent-soft); }
.ft-row.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.ft-twist { width: 12px; color: var(--muted); font-size: 10px; flex-shrink: 0; }
.ft-children { margin-left: 12px; }
.ft-ws { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); padding: 4px 8px; }
```
(기존 `#editor` 규칙이 이미 있으면 중복 제거.)

- [ ] **Step 3: 검증** `npm run build`. **사람 스모크:** 빈 사이드바 영역이 왼쪽에 보이고 에디터가 그 오른쪽인지.

- [ ] **Step 4: 커밋** `git add index.html src/styles.css` ; `git commit -m "feat(m3a): sidebar layout region"`

---

## Task 3: 파일 트리 UI + 폴더 열기 + 클릭 전환

**Files:** Create `src/workspace/fileTree.ts`; Modify `src/main.ts`

- [ ] **Step 1: 트리 렌더.** Create `src/workspace/fileTree.ts`:
```ts
import type { FileNode } from "../ipc/bindings";

export interface FileTree {
  render(root: FileNode[]): void;
  setActive(path: string | null): void;
}

/** sidebar에 트리를 그리고, 파일 클릭 시 onOpen(path)을 호출. */
export function mountFileTree(sidebar: HTMLElement, onOpen: (path: string) => void): FileTree {
  let activePath: string | null = null;
  const expanded = new Set<string>();

  function rowEl(node: FileNode, depth: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "ft-row" + (!node.isDir && node.path === activePath ? " active" : "");
    row.style.paddingLeft = `${8 + depth * 12}px`;
    const tw = document.createElement("span");
    tw.className = "ft-twist";
    tw.textContent = node.isDir ? (expanded.has(node.path) ? "▾" : "▸") : "";
    row.appendChild(tw);
    row.appendChild(document.createTextNode(node.name));
    row.addEventListener("click", () => {
      if (node.isDir) {
        if (expanded.has(node.path)) expanded.delete(node.path); else expanded.add(node.path);
        draw();
      } else {
        onOpen(node.path);
      }
    });
    return row;
  }

  let lastRoot: FileNode[] = [];
  function draw() {
    sidebar.replaceChildren();
    const ws = document.createElement("div");
    ws.className = "ft-ws";
    ws.textContent = "워크스페이스";
    sidebar.appendChild(ws);
    const walk = (nodes: FileNode[], depth: number) => {
      for (const n of nodes) {
        sidebar.appendChild(rowEl(n, depth));
        if (n.isDir && expanded.has(n.path)) walk(n.children, depth + 1);
      }
    };
    walk(lastRoot, 0);
  }

  return {
    render(root) { lastRoot = root; draw(); },
    setActive(path) { activePath = path; draw(); },
  };
}
```

- [ ] **Step 2: 폴더 열기 + open-by-path 배선.** Modify `src/main.ts`:
  - imports: `import { mountFileTree } from "./workspace/fileTree";` ; `open`은 이미 `@tauri-apps/plugin-dialog`에서 import됨.
  - 트리 마운트: `const tree = mountFileTree(document.getElementById("sidebar")!, (p) => void openPath(p));`
  - 공통 열기 함수(기존 openFile을 일반화). 미저장 가드 포함:
```ts
async function openPath(path: string): Promise<void> {
  if (isDirty(docState) && !confirm("저장하지 않은 변경이 있습니다. 버리고 열까요?")) return;
  const res = await commands.readFile(path);
  if (res.status === "error") { console.error(res.error); return; }
  docState = loadedDoc(path, res.data);
  setDocPath(docState.path);
  setEditorText(view, res.data);
  updateTitle(); refreshStatus();
  tree.setActive(path);
}
```
  - 기존 `openFile()`(Ctrl+O)은 다이얼로그로 파일을 고른 뒤 `openPath(selected)` 호출하도록 단순화.
  - 폴더 열기 명령 추가(메뉴 없으니 단축키 Ctrl/Cmd-Shift-O):
```ts
async function openFolder(): Promise<void> {
  const dir = await open({ directory: true, multiple: false });
  if (typeof dir !== "string") return;
  const res = await commands.listDir(dir);
  if (res.status === "error") { console.error(res.error); return; }
  tree.render(res.data);
}
```
  - keydown에 추가: `if (mod && e.shiftKey && e.key.toLowerCase() === "o") { e.preventDefault(); void openFolder(); }`

- [ ] **Step 3: 검증** `npx tsc --noEmit` ; `npm run build`.

- [ ] **Step 4: 사람 스모크** — Ctrl/Cmd-Shift-O로 폴더 열기 → 트리에 .md 파일·폴더 표시, 폴더 클릭 시 확장/접기, 파일 클릭 시 열림(활성 강조), 미저장 시 가드. (트리가 비거나 경로 클릭이 안 되면 알려주기.)

- [ ] **Step 5: 커밋** `git add src/workspace/fileTree.ts src/main.ts` ; `git commit -m "feat(m3a): file tree UI, open folder, click-to-open with unsaved guard"`

---

## Task 4: 자동저장 + markSavedAs (TOCTOU 해결)

**Files:** Modify `src/doc/document.ts` (+ test), Create `src/workspace/autosave.ts`; Modify `src/main.ts`

- [ ] **Step 1: markSavedAs 테스트** — `src/doc/document.test.ts`에 추가:
```ts
  it("markSavedAs records the snapshot text and path, clearing dirty", () => {
    const d = withCurrentText(loadedDoc("/a.md", "x"), "edited");
    const saved = markSavedAs(d, "/a.md", "edited");
    expect(saved.path).toBe("/a.md");
    expect(saved.savedText).toBe("edited");
    expect(isDirty(saved)).toBe(false);
  });
```
import 줄에 `markSavedAs` 추가.

- [ ] **Step 2: npm test → 실패 확인**

- [ ] **Step 3: 구현** — `src/doc/document.ts`에 추가:
```ts
export function markSavedAs(doc: DocState, path: string, savedText: string): DocState {
  return { ...doc, path, savedText };
}
```

- [ ] **Step 4: npm test → 통과(document 5 + wordcount 5 = 10)**

- [ ] **Step 5: autosave 확장.** Create `src/workspace/autosave.ts`:
```ts
import { EditorView } from "@codemirror/view";

/** 입력이 멈춘 뒤 delay(ms)면 save()를 호출하는 CM6 확장 + 즉시 저장 트리거. */
export function autosave(delay: number, save: () => void) {
  let timer: number | undefined;
  const schedule = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = window.setTimeout(save, delay);
  };
  const flush = () => { if (timer !== undefined) { clearTimeout(timer); timer = undefined; } save(); };
  const ext = EditorView.updateListener.of((u) => { if (u.docChanged) schedule(); });
  return { ext, flush };
}
```

- [ ] **Step 6: 배선.** Modify `src/main.ts`:
  - `import { markSavedAs } from "./doc/document";` (기존 import에 추가) ; `import { autosave } from "./workspace/autosave";`
  - 저장 로직을 스냅샷 기반으로(TOCTOU 해결). 자동저장은 path 있는 문서만:
```ts
async function doSave(): Promise<void> {
  let path = docState.path;
  if (!path) {
    const chosen = await save({ filters: [{ name: "Markdown", extensions: ["md"] }] });
    if (typeof chosen !== "string") return;
    path = chosen;
  }
  const text = docState.currentText;            // 스냅샷
  const res = await commands.writeFile(path, text);
  if (res.status === "error") { console.error(res.error); return; }
  docState = markSavedAs(docState, path, text);  // 스냅샷으로 기록
  setDocPath(path); updateTitle(); refreshStatus();
}

async function autoSave(): Promise<void> {
  if (!docState.path || !isDirty(docState)) return;
  const text = docState.currentText;
  const res = await commands.writeFile(docState.path, text);
  if (res.status === "error") { console.error(res.error); return; }
  docState = markSavedAs(docState, docState.path, text);
  updateTitle(); refreshStatus();
}
const as = autosave(800, () => void autoSave());
```
  - `createEditor(...)`의 `extraExtensions`에 `as.ext` 추가(기존 selection 리스너와 함께 배열로).
  - 창 blur 시 즉시 저장: `window.addEventListener("blur", () => as.flush());`
  - 기존 Ctrl+S 핸들러는 `doSave()` 호출로 교체. (수동 저장과 자동저장 모두 doSave/autoSave로 일원화; openFile/openPath는 그대로.)

- [ ] **Step 7: 검증** `npm test`(10) ; `npx tsc --noEmit` ; `npm run build`.

- [ ] **Step 8: 사람 스모크** — 파일 연 상태에서 입력 → ~0.8초 후 dirty(●) 사라지고 디스크 반영, 다른 창 클릭(blur) 시 즉시 저장, Untitled는 자동저장 안 되고 Ctrl+S로 저장위치 물음.

- [ ] **Step 9: 커밋** `git add src/doc/document.ts src/doc/document.test.ts src/workspace/autosave.ts src/main.ts` ; `git commit -m "feat(m3a): debounced autosave + markSavedAs (fixes save TOCTOU)"`

---

## Task 5: 통합 검증 + 마무리
- [ ] 전체 테스트(프론트 10 + Rust 8) ; 릴리스 빌드.
- [ ] 사람 종합 스모크: 폴더 열기→트리→클릭 전환→자동저장, 이미지/수식/표 회귀.
- [ ] README 현황 갱신(M3a).
- [ ] 커밋 → `main` 병합·푸시.

## 알려진 한계 / 다음 (M3b)
- **외부 변경 감시(watcher)** 및 충돌 배너 = M3b.
- **커맨드 팔레트(⌘K)**, **설정 영속화(테마/최근 폴더를 Rust로)** = M3b.
- 트리는 폴더 열 때 1회 스캔(파일 추가/삭제 자동 반영은 watcher 붙으면) — M3b.
- 미저장 가드는 confirm()(버리고 열기) — 추후 "저장/버림/취소" 3버튼으로.
- 사이드바 토글(접기) 단축키 = 폴리시.
