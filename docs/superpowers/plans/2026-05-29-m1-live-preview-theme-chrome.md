# M1 — Live Preview + 테마(Pretendard) + 최소 크롬 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** M0의 "보이지 않는 토대"를 실제로 보이는 제품으로 만든다 — 입력 즉시 서식이 적용되는 인라인 Live Preview, Pretendard 기반 Minimal 테마(라이트/다크), 그리고 앱처럼 보이게 하는 최소 크롬(상단바·상태바).

**Architecture:** 모두 프론트(웹뷰/TS)에서 처리한다. Live Preview는 CodeMirror 6의 `ViewPlugin` + 데코레이션(마크/라인/replace)으로 Lezer 마크다운 트리를 순회해 구현하고, **커서가 있는 줄에서만 원본 마커를 노출**한다. 테마는 번들된 Pretendard/JetBrains Mono + `EditorView.theme` + 앱 CSS(라이트/다크). 크롬은 순수 DOM. Rust 코어는 이 마일스톤에서 변경 없음.

**Tech Stack:** CodeMirror 6 (`@codemirror/view`, `@codemirror/state`, `@codemirror/language`, `@lezer/markdown`), `pretendard` + `@fontsource/jetbrains-mono`(번들), Vite, Vitest, TypeScript.

> **범위:** 인라인/구조 마크다운(제목·강조·인라인코드·취소선·목록·인용·링크)의 Live Preview + 테마 + 최소 크롬까지. **코드블록 하이라이트·Mermaid·KaTeX·이미지는 M2**, 파일트리·커맨드팔레트·설정영속화는 M3. 스펙: `docs/superpowers/specs/2026-05-29-cross-platform-markdown-editor-design.md`.
>
> **시각 검증 주의:** 에이전트는 GUI 창을 볼 수 없다. Task 1·3은 빌드/타입체크로 1차 검증하고, **실제 렌더 모양은 사람이 `npm run tauri dev`로 확인·반복**한다(각 Task의 "사람 스모크" 항목).

---

## 파일 구조 (M1 종료 시점)

```
src/
├─ main.ts                 # MODIFY: 크롬 구성 + 에디터를 #editor에 마운트 + 상태/테마 배선
├─ styles.css              # MODIFY: 앱 레이아웃(크롬+에디터 영역), 라이트/다크 변수
├─ theme/
│  ├─ fonts.ts             # NEW: 번들 폰트 CSS import (Pretendard, JetBrains Mono)
│  └─ editorTheme.ts       # NEW: EditorView.theme (Minimal/Cool) + Live Preview 클래스 스타일
├─ editor/
│  ├─ editor.ts            # MODIFY: livePreview + editorTheme 확장 추가
│  └─ livePreview.ts       # NEW: CM6 Live Preview 데코레이션 확장
└─ chrome/
   ├─ wordcount.ts         # NEW: 순수 countWords(text)
   ├─ wordcount.test.ts    # NEW: Vitest
   └─ chrome.ts            # NEW: 상단바/상태바 DOM 생성 + 갱신 함수
index.html                 # MODIFY: #app > #titlebar / #editor / #statusbar 구조
```

책임 분리:
- `theme/*` — 시각 토큰(폰트/색/타이포)만. 로직 없음.
- `editor/livePreview.ts` — 마크다운 → 데코레이션 변환(순수에 가까운 뷰 플러그인).
- `chrome/wordcount.ts` — 순수 함수(테스트 대상). `chrome.ts` — DOM 어댑터.
- `main.ts` — 조립/배선만.

---

## Task 1: Pretendard 테마 + 폰트 번들 (먼저 "디자인된 모습")

**Files:**
- Create: `src/theme/fonts.ts`, `src/theme/editorTheme.ts`
- Modify: `src/styles.css`, `src/editor/editor.ts`, `index.html`

- [ ] **Step 1: 폰트 패키지 설치 (앱에 번들 → 오프라인·OS 무관 동일)**

```
npm i pretendard @fontsource/jetbrains-mono
```

- [ ] **Step 2: 폰트 import 진입점.** Create `src/theme/fonts.ts`:

```ts
// 번들 폰트. Vite가 woff2를 처리해 오프라인에서도 OS 무관 동일하게 렌더.
import "pretendard/dist/web/variable/pretendardvariable.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
```

> 만약 `pretendard/dist/web/variable/pretendardvariable.css` 경로가 패키지 버전에서 다르면, `node_modules/pretendard/dist/web/` 아래 실제 CSS 경로로 맞춘다(예: `static/pretendard.css`). 폰트 패밀리명은 각각 `"Pretendard Variable"`(또는 `"Pretendard"`)와 `"JetBrains Mono"`.

- [ ] **Step 3: 앱 레이아웃 + 테마 변수.** Replace `src/styles.css` 전체:

```css
:root {
  --bg: #ffffff; --faint: #f7f8fa; --border: #ecedf1;
  --text: #181a1f; --muted: #8a909c; --accent: #5b5bd6; --accent-soft: #eef0fb;
  --mono: "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace;
  --sans: "Pretendard Variable", Pretendard, -apple-system, system-ui, "Apple SD Gothic Neo", sans-serif;
}
:root[data-theme="dark"] {
  --bg: #16181d; --faint: #1c1f26; --border: #2a2d36;
  --text: #e6e8ee; --muted: #8a909c; --accent: #7c7cf0; --accent-soft: #23263a;
}
html, body { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--text); font-family: var(--sans); }
#app { height: 100vh; display: flex; flex-direction: column; }
#titlebar {
  height: 40px; flex-shrink: 0; display: flex; align-items: center;
  padding: 0 14px; gap: 10px; border-bottom: 1px solid var(--border); background: var(--faint);
  font-size: 12.5px; color: var(--muted); user-select: none;
}
#titlebar .doc-title { flex: 1; text-align: center; color: var(--text); font-weight: 500; }
#titlebar .dirty { color: var(--accent); }
#titlebar button {
  background: none; border: 1px solid var(--border); border-radius: 6px;
  color: var(--muted); font-size: 11px; padding: 3px 8px; cursor: pointer;
}
#editor { flex: 1; min-height: 0; overflow: hidden; }
#statusbar {
  height: 26px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;
  padding: 0 16px; border-top: 1px solid var(--border); background: var(--faint);
  font-size: 11px; color: var(--muted); user-select: none;
}
```

- [ ] **Step 4: CodeMirror 테마 + Live Preview 클래스 스타일.** Create `src/theme/editorTheme.ts`:

```ts
import { EditorView } from "@codemirror/view";

/** Minimal/Cool 에디터 테마. 색은 CSS 변수에서 가져와 라이트/다크 자동 추종. */
export function editorTheme() {
  return EditorView.theme({
    "&": { height: "100%", backgroundColor: "var(--bg)", color: "var(--text)" },
    ".cm-scroller": {
      fontFamily: "var(--sans)", fontSize: "16px", lineHeight: "1.7",
      overflow: "auto",
    },
    ".cm-content": { maxWidth: "720px", margin: "0 auto", padding: "32px 28px" },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor": { borderLeftColor: "var(--accent)" },
    ".cm-selectionBackground, ::selection": { backgroundColor: "var(--accent-soft)" },
    // ----- Live Preview rendered styles -----
    ".cm-md-h1": { fontSize: "1.9em", fontWeight: "700", lineHeight: "1.25" },
    ".cm-md-h2": { fontSize: "1.55em", fontWeight: "700", lineHeight: "1.3" },
    ".cm-md-h3": { fontSize: "1.3em", fontWeight: "700" },
    ".cm-md-h4, .cm-md-h5, .cm-md-h6": { fontSize: "1.1em", fontWeight: "700" },
    ".cm-md-strong": { fontWeight: "700" },
    ".cm-md-em": { fontStyle: "italic" },
    ".cm-md-strike": { textDecoration: "line-through", color: "var(--muted)" },
    ".cm-md-code": {
      fontFamily: "var(--mono)", fontSize: "0.9em",
      background: "var(--faint)", border: "1px solid var(--border)",
      borderRadius: "4px", padding: "0.05em 0.35em",
    },
    ".cm-md-quote": { color: "var(--muted)", borderLeft: "3px solid var(--border)", paddingLeft: "0.8em" },
    ".cm-md-link": { color: "var(--accent)", textDecoration: "underline" },
  });
}
```

- [ ] **Step 5: 에디터에 폰트/테마 연결.** Modify `src/editor/editor.ts`:
  - 파일 맨 위에 `import "../theme/fonts.ts";` 와 `import { editorTheme } from "../theme/editorTheme";` 추가.
  - `createEditor`의 `extensions` 배열에 `editorTheme(),` 를 `markdown()` 다음에 추가.

- [ ] **Step 6: index.html 구조.** Modify `index.html` `<body>`:

```html
<body>
  <div id="app">
    <div id="titlebar"></div>
    <div id="editor"></div>
    <div id="statusbar"></div>
  </div>
  <script type="module" src="/src/main.ts"></script>
</body>
```

- [ ] **Step 7: 에디터 마운트 지점 변경.** Modify `src/main.ts`: `const appEl = document.getElementById("app")!;` → `const appEl = document.getElementById("editor")!;` (나머지 로직은 유지; styles.css import 줄은 그대로 둠).

- [ ] **Step 8: 컴파일 검증.**
```
npx tsc --noEmit
npm run build
```
Expected: 둘 다 성공. (폰트 import 해석 실패 시 Step 2의 경로를 실제 패키지 경로로 수정.)

- [ ] **Step 9: 사람 스모크 (커밋 전).** 보고에 다음을 요청으로 명시: 사람이 `npm run tauri dev` 실행 → 에디터에 **Pretendard 본문**, 중앙 정렬된 측정폭, 상단/상태바(빈 상태라도) 보이는지, OS 다크 설정에서 다크로 보이는지 확인. (이 단계엔 아직 크롬 내용·Live Preview 없음 — 폰트/레이아웃/색만.)

- [ ] **Step 10: 커밋.**
```
git add -A
git commit -m "feat(m1): bundle Pretendard/JetBrains Mono, Minimal light/dark theme, app layout"
```

---

## Task 2: 최소 크롬 (상단바·상태바) + 단어 수 (TDD)

**Files:**
- Create: `src/chrome/wordcount.ts`, `src/chrome/wordcount.test.ts`, `src/chrome/chrome.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: 실패하는 테스트.** Create `src/chrome/wordcount.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { countWords } from "./wordcount";

describe("countWords", () => {
  it("empty string is 0", () => expect(countWords("")).toBe(0));
  it("whitespace only is 0", () => expect(countWords("   \n\t ")).toBe(0));
  it("counts space-separated words", () => expect(countWords("hello world")).toBe(2));
  it("collapses multiple spaces/newlines", () => expect(countWords("a   b\n\nc")).toBe(3));
  it("counts CJK runs as words too", () => expect(countWords("안녕 세계")).toBe(2));
});
```

- [ ] **Step 2: 테스트 실패 확인.** `npm test` → `./wordcount` 미존재로 실패.

- [ ] **Step 3: 구현.** Create `src/chrome/wordcount.ts`:

```ts
/** 공백으로 구분된 토큰 수. 빈/공백 문자열은 0. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}
```

- [ ] **Step 4: 통과 확인.** `npm test` → 5 passed (기존 document 4 + wordcount 5 = 9 total).

- [ ] **Step 5: 크롬 DOM.** Create `src/chrome/chrome.ts`:

```ts
import { countWords } from "./wordcount";

export interface Chrome {
  setTitle(name: string, dirty: boolean): void;
  setStatus(text: string, line: number, col: number): void;
}

/** 상단바/상태바 DOM을 채우고, 갱신 함수와 테마 토글을 배선한다. */
export function mountChrome(
  titlebar: HTMLElement,
  statusbar: HTMLElement,
): Chrome {
  // ----- titlebar -----
  const title = document.createElement("span");
  title.className = "doc-title";
  const themeBtn = document.createElement("button");
  themeBtn.textContent = "테마";
  themeBtn.addEventListener("click", toggleTheme);
  const spacerL = document.createElement("span");
  spacerL.style.width = "40px"; // balance the right-side button so title stays centered
  titlebar.replaceChildren(spacerL, title, themeBtn);

  // ----- statusbar -----
  const left = document.createElement("span");
  const right = document.createElement("span");
  statusbar.replaceChildren(left, right);

  // initial theme from saved pref or OS
  applyTheme(savedTheme());

  return {
    setTitle(name, dirty) {
      title.replaceChildren();
      if (dirty) {
        const dot = document.createElement("span");
        dot.className = "dirty";
        dot.textContent = "● ";
        title.appendChild(dot);
      }
      title.appendChild(document.createTextNode(`${name} — cp_markdown`));
    },
    setStatus(text, line, col) {
      left.textContent = `${countWords(text)} 단어`;
      right.textContent = `줄 ${line}, 열 ${col}`;
    },
  };
}

function savedTheme(): "light" | "dark" {
  const saved = localStorage.getItem("cpmd-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function applyTheme(t: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("cpmd-theme", t);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  applyTheme(cur === "dark" ? "light" : "dark");
}
```

> 메모: 테마 선호 영속화는 M1에선 `localStorage`로 임시 처리. M3에서 Rust 설정 저장으로 이관.

- [ ] **Step 6: main.ts 배선.** Modify `src/main.ts`:
  - import 추가: `import { mountChrome } from "./chrome/chrome";`
  - `#titlebar`/`#statusbar` 엘리먼트 취득 후 `const chrome = mountChrome(titlebarEl, statusbarEl);`
  - `updateTitle()`가 `document.title` 대신(또는 함께) `chrome.setTitle(name, isDirty(docState))` 호출하도록 수정.
  - 에디터 `onChange` 및 초기화 시 상태바 갱신: 현재 텍스트 + 커서 위치로 `chrome.setStatus(...)` 호출. 커서 줄/열은 `view.state.selection.main.head`를 `view.state.doc.lineAt(head)`로 변환(line.number, head - line.from + 1). `createEditor`가 `EditorView`를 반환하므로, `onChange`에서 `view`가 필요하면 `updateListener`를 활용하도록 `editor.ts`에 커서 변경 콜백을 추가하거나, main에서 `view.dispatch` 후 직접 계산한다.
  - 구체 배선(권장): `editor.ts`의 `createEditor`에 선택영역 변경도 알리는 옵션을 추가하기보다, main에서 별도 `updateListener`를 extensions로 넘기는 대신 **간단히**: `onChange(text)` 콜백 안에서 `chrome.setStatus(text, line, col)`를 호출하되 line/col은 `view` 클로저로 계산. (단, `view`는 `createEditor` 반환 이후 생성되므로, `onChange`에서 `view` 참조는 지연 바인딩으로 안전 — main의 모듈 스코프 `view`를 클로저로 캡처.)

  실제 코드 패턴(main.ts 발췌):
```ts
import { mountChrome } from "./chrome/chrome";

const titlebarEl = document.getElementById("titlebar")!;
const statusbarEl = document.getElementById("statusbar")!;
const chrome = mountChrome(titlebarEl, statusbarEl);

const editorEl = document.getElementById("editor")!;
let view: import("@codemirror/view").EditorView;

function refreshStatus(): void {
  const text = view.state.doc.toString();
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  chrome.setStatus(text, line.number, head - line.from + 1);
}

view = createEditor(editorEl, "", (text) => {
  docState = withCurrentText(docState, text);
  updateTitle();
  refreshStatus();
});
```
  - `updateTitle()` 내부를 `chrome.setTitle(docState.path ?? "Untitled", isDirty(docState))`로 변경(기존 `document.title` 세팅은 유지해도 무방).
  - `openFile`/`saveFile` 성공 경로 끝에 `refreshStatus()` 추가.
  - 초기 1회 `updateTitle(); refreshStatus();` 호출.

> 커서 이동만으로도 줄/열을 갱신하려면 선택 변경 리스너가 필요하다. M1에서는 `editor.ts`의 `updateListener`가 `docChanged`만 보고 있으므로, **`editor.ts`를 살짝 확장**: 콜백을 `onUpdate(text, head)` 형태로 바꾸거나, 별도 `selectionChange` 콜백을 추가한다. 가장 작은 변경: `createEditor` 시그니처에 선택 변경 콜백을 옵션으로 추가하지 말고, main에서 `EditorView.updateListener.of`를 포함한 확장을 직접 주입할 수 있도록 `createEditor`가 추가 extensions를 받게 한다(아래 Task 3에서 어차피 확장을 주입하므로 그때 통합).

- [ ] **Step 7: 컴파일 + 테스트.** `npx tsc --noEmit` ; `npm test`(9 pass) ; `npm run build`.

- [ ] **Step 8: 사람 스모크.** 보고에 요청 명시: 상단바에 제목/dirty ●, "테마" 버튼으로 라이트↔다크 전환, 상태바에 단어 수·줄/열 표시, 타이핑 시 갱신되는지.

- [ ] **Step 9: 커밋.**
```
git add -A
git commit -m "feat(m1): minimal chrome — title bar (dirty + theme toggle) and status bar"
```

---

## Task 3: Live Preview (인라인 WYSIWYG 데코레이션)

**Files:**
- Create: `src/editor/livePreview.ts`
- Modify: `src/editor/editor.ts`

> 이 Task가 M1의 핵심이자 가장 까다롭다. 데코레이션 모양은 빌드/타입체크로는 검증 불가 → **사람 스모크로 반복**한다.

- [ ] **Step 1: Live Preview 확장 작성.** Create `src/editor/livePreview.ts`:

```ts
import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import {
  Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate,
} from "@codemirror/view";

// 커서가 그 줄에 없을 때 숨길 마커 노드들.
const HIDDEN_MARKS = new Set([
  "HeaderMark", "EmphasisMark", "CodeMark", "StrikethroughMark", "QuoteMark", "LinkMark",
]);
// 렌더 콘텐츠에 입힐 스타일 클래스.
const NODE_CLASS: Record<string, string> = {
  StrongEmphasis: "cm-md-strong",
  Emphasis: "cm-md-em",
  Strikethrough: "cm-md-strike",
  InlineCode: "cm-md-code",
};

function activeLines(view: EditorView): Set<number> {
  const set = new Set<number>();
  for (const r of view.state.selection.ranges) {
    const a = view.state.doc.lineAt(r.from).number;
    const b = view.state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) set.add(n);
  }
  return set;
}

function build(view: EditorView): { deco: DecorationSet; atomic: DecorationSet } {
  const decoR: Range<Decoration>[] = [];
  const atomicR: Range<Decoration>[] = [];
  const active = activeLines(view);
  const doc = view.state.doc;

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from, to,
      enter: (node) => {
        const name = node.name;

        const h = /^ATXHeading([1-6])$/.exec(name);
        if (h) {
          const line = doc.lineAt(node.from);
          decoR.push(Decoration.line({ class: `cm-md-h${h[1]}` }).range(line.from));
          return;
        }
        if (name === "Blockquote") {
          const line = doc.lineAt(node.from);
          decoR.push(Decoration.line({ class: "cm-md-quote" }).range(line.from));
          return;
        }
        if (name === "URL" || name === "LinkLabel") {
          decoR.push(Decoration.mark({ class: "cm-md-link" }).range(node.from, node.to));
          return;
        }
        const cls = NODE_CLASS[name];
        if (cls) {
          decoR.push(Decoration.mark({ class: cls }).range(node.from, node.to));
          return;
        }
        if (HIDDEN_MARKS.has(name) && node.to > node.from) {
          const lineNo = doc.lineAt(node.from).number;
          if (!active.has(lineNo)) {
            const hide = Decoration.replace({});
            decoR.push(hide.range(node.from, node.to));
            atomicR.push(hide.range(node.from, node.to));
          }
        }
      },
    });
  }
  const cmp = (a: Range<Decoration>, b: Range<Decoration>) =>
    a.from - b.from || a.value.startSide - b.value.startSide;
  decoR.sort(cmp);
  atomicR.sort(cmp);
  return { deco: Decoration.set(decoR, true), atomic: Decoration.set(atomicR, true) };
}

export const livePreview = ViewPlugin.fromClass(
  class {
    deco: DecorationSet;
    atomic: DecorationSet;
    constructor(view: EditorView) {
      const r = build(view);
      this.deco = r.deco;
      this.atomic = r.atomic;
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        const r = build(u.view);
        this.deco = r.deco;
        this.atomic = r.atomic;
      }
    }
  },
  {
    decorations: (v) => v.deco,
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.atomic ?? Decoration.none,
      ),
  },
);
```

- [ ] **Step 2: 에디터에 연결.** Modify `src/editor/editor.ts`:
  - `import { livePreview } from "./livePreview";`
  - `createEditor`의 `extensions`에 `livePreview,` 를 `markdown()` 다음, `editorTheme()` 앞/뒤 아무 곳에 추가.

- [ ] **Step 3: 컴파일.** `npx tsc --noEmit` ; `npm run build`. Expected: 성공. (Lezer 노드명 불일치로 타입 에러는 없지만, 노드명이 틀리면 런타임에 그 서식만 안 먹는다 — 스모크에서 확인.)

- [ ] **Step 4: 사람 스모크 (핵심·반복).** 보고에 요청 명시 — 사람이 `npm run tauri dev` 후 다음을 입력하며 확인:
  - `# 제목` → 큰 제목으로, 커서를 그 줄에서 빼면 `#`가 사라지고 줄에 들어가면 다시 보임
  - `**굵게**` → 굵게, 커서 밖이면 `**` 숨김 / 안이면 노출
  - `*기울임*`, `` `코드` ``, `~~취소선~~`, `> 인용`, `[링크](http://x)`
  - 한글 입력/조합(IME)이 깨지지 않는지, 화살표 이동이 숨긴 마커를 건너뛰는지(atomicRanges)
  - **반복:** 안 먹는 서식이 있으면 그 노드명을 Lezer 문법 기준으로 수정(예: GFM 취소선은 `Strikethrough`/`StrikethroughMark`; 링크 구성은 `Link`,`LinkMark`,`URL`). 컨트롤러가 사람 피드백을 받아 `HIDDEN_MARKS`/`NODE_CLASS`/조건을 조정해 재배포.

- [ ] **Step 5: 커밋.**
```
git add -A
git commit -m "feat(m1): inline live preview — markdown decorations with active-line source reveal"
```

---

## Task 4: 통합 검증 + 마무리

**Files:** 없음(검증 전용) / 필요 시 README 갱신

- [ ] **Step 1: 전체 테스트.** `npm test`(9 pass: document 4 + wordcount 5) ; `cd src-tauri ; cargo test ; cd ..`(5 pass — 변경 없음).
- [ ] **Step 2: 릴리스 빌드.** `npm run tauri build -- --no-bundle` (성공). 느리면 `cd src-tauri ; cargo build --release`로 폴백, 단순 지연은 실패 아님.
- [ ] **Step 3: 사람 종합 스모크.** Task 1·2·3의 스모크를 한 번에: 테마 전환, 크롬 표시, Live Preview 동작 + 열기/저장(M0 회귀 없는지).
- [ ] **Step 4: README의 "현황" 섹션을 M1로 갱신** (Live Preview·테마·크롬 동작; 다음은 M2 코드/수식/Mermaid/이미지).
- [ ] **Step 5: 커밋.**
```
git add README.md
git commit -m "docs: update README status to M1"
```

---

## 알려진 한계 / 다음(M2+)
- 코드블록 신택스 하이라이트(Shiki)·Mermaid·KaTeX·이미지 = **M2**.
- 파일 트리·커맨드 팔레트·**설정 영속화(테마 선호를 Rust로)** = **M3**. (M1은 localStorage 임시.)
- 저장 TOCTOU(`markSavedAs`)·자동저장 = M1 후속 또는 M3 저장 코디네이션 시 처리(스펙 §15).
- `tauri-app` → `cp_markdown` 리네이밍 = M5.
- Live Preview 세부(목록 마커 정렬, 중첩 강조, 링크 클릭 등)는 스모크 피드백으로 점진 개선.
