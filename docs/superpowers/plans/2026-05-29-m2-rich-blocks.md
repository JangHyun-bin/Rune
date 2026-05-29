# M2 — 리치 블록 (코드 하이라이팅 · Mermaid · KaTeX · 표) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 에디터 안에서 펜스 코드블록이 언어별로 하이라이팅되고, ```mermaid 블록은 다이어그램으로, `$...$`/`$$...$$`는 수식으로, GFM 표는 렌더된 표로 보이게 한다 — 모두 "커서가 그 블록에 들어가면 원본 소스로 되돌아오는" Live Preview 방식.

**Architecture:** 프론트(웹뷰/TS)만 변경. 코드 하이라이팅은 CodeMirror의 `codeLanguages` + `syntaxHighlighting`. Mermaid·블록수식·표는 **공통 블록-위젯 StateField**(블록 범위를 렌더 위젯으로 replace, 커서가 안에 있으면 해제) 위에 구현. 인라인 수식은 인라인 위젯 플러그인. Rust 코어 변경 없음(이미지=다음 마일스톤).

**Tech Stack:** CodeMirror 6 (`@codemirror/language`, `@codemirror/language-data`, `@codemirror/view`, `@codemirror/state`), `mermaid`, `katex`, Vite, Vitest, TS.

> 범위: 위 4개 렌더 기능. 이미지(붙여넣기/드롭 + Rust `save_asset`), 내보내기 시 Shiki, 검색은 이후 마일스톤. CM6 **블록 위젯은 반드시 StateField로 제공**(ViewPlugin 불가)해야 한다 — 이 제약이 설계의 핵심.
>
> **시각 검증:** 에이전트는 GUI를 못 본다. 각 Task는 빌드/타입체크로 1차 검증 후 **사람이 `npm run tauri dev`로 렌더 확인·반복**한다.

---

## 파일 구조 (M2 종료 시점)

```
src/editor/
├─ editor.ts            # MODIFY: codeLanguages, syntaxHighlighting, 새 확장들 연결
├─ livePreview.ts       # MODIFY: 펜스 코드블록 줄 스타일(모노+배경) 추가
├─ highlightStyle.ts    # NEW: 테마 연동 코드 하이라이트 스타일
├─ blockWidgets.ts      # NEW: 공통 "블록을 위젯으로, 커서 진입 시 해제" StateField 빌더
├─ mermaid.ts           # NEW: mermaid 블록 위젯
├─ math.ts              # NEW: 인라인/블록 KaTeX 위젯
└─ table.ts             # NEW: GFM 표 위젯
```

설계 원칙: `blockWidgets.ts`가 공통 패턴(노드 매칭 → 위젯 빌드 → 커서 진입 시 원본)을 제공하고, mermaid/math(블록)/table은 그 위에 "노드 판별 + 위젯 DOM 생성"만 구현한다.

---

## Task 1: 코드블록 언어 하이라이팅 (가장 빠른 가시 성과)

**Files:** Create `src/editor/highlightStyle.ts`; Modify `src/editor/editor.ts`, `src/editor/livePreview.ts`

- [ ] **Step 1: 언어 데이터 설치**
```
npm i @codemirror/language-data
```

- [ ] **Step 2: 하이라이트 스타일.** Create `src/editor/highlightStyle.ts`:
```ts
import { HighlightStyle } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/** 라이트/다크 모두에서 읽히는 절제된 코드 하이라이트. */
export const codeHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], color: "#a855c7" },
  { tag: [t.string, t.special(t.string)], color: "#3a9e6e" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#8a909c", fontStyle: "italic" },
  { tag: [t.number, t.bool, t.null], color: "#d2843a" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#4f6bed" },
  { tag: [t.typeName, t.className, t.namespace], color: "#c08a2e" },
  { tag: [t.operator, t.punctuation, t.bracket], color: "#8a909c" },
  { tag: [t.propertyName, t.attributeName], color: "#4f6bed" },
  { tag: t.variableName, color: "var(--text)" },
]);
```

- [ ] **Step 3: 펜스 코드블록 줄 스타일.** Modify `src/editor/livePreview.ts` — `build()`의 `enter` 안, 제목 처리 부근에 FencedCode 줄 스타일을 추가:
```ts
        if (name === "FencedCode") {
          const first = doc.lineAt(node.from).number;
          const last = doc.lineAt(node.to).number;
          for (let ln = first; ln <= last; ln++) {
            decoR.push(Decoration.line({ class: "cm-md-codeblock" }).range(doc.line(ln).from));
          }
          return;
        }
```
그리고 `src/theme/editorTheme.ts`의 테마 객체에 클래스 추가:
```ts
    ".cm-md-codeblock": { fontFamily: "var(--mono)", fontSize: "0.92em", background: "var(--faint)" },
    ".cm-md-codeblock:first-of-type": {},
```
(블록 전체 배경 느낌을 위해 `.cm-md-codeblock`에 배경; 모서리 둥글림은 추후 폴리시.)

- [ ] **Step 4: 에디터에 연결.** Modify `src/editor/editor.ts`:
  - imports 추가:
    ```ts
    import { syntaxHighlighting } from "@codemirror/language";
    import { languages } from "@codemirror/language-data";
    import { codeHighlightStyle } from "./highlightStyle";
    ```
  - `markdown({ base: markdownLanguage })` → `markdown({ base: markdownLanguage, codeLanguages: languages })`
  - extensions 배열에 `syntaxHighlighting(codeHighlightStyle),` 추가(`editorTheme()` 부근).

- [ ] **Step 5: 컴파일.** `npx tsc --noEmit` ; `npm run build`. 둘 다 성공.

- [ ] **Step 6: 사람 스모크.** 보고에 요청 — 사람이 아래를 입력해 확인:
  ````
  ```js
  const x = 1; // 주석
  function hi(name) { return `Hello ${name}`; }
  ```
  ```python
  def add(a, b):
      return a + b  # 합
  ```
  ````
  → 키워드/문자열/주석/함수가 색으로 구분되는지, 코드블록이 모노+배경으로 보이는지. 라이트/다크 양쪽.

- [ ] **Step 7: 커밋.**
```
git add src/editor/highlightStyle.ts src/editor/editor.ts src/editor/livePreview.ts src/theme/editorTheme.ts
git commit -m "feat(m2): code block syntax highlighting via codeLanguages + themed highlight style"
```

---

## Task 2: 공통 블록-위젯 인프라 + Mermaid

**Files:** Create `src/editor/blockWidgets.ts`, `src/editor/mermaid.ts`; Modify `src/editor/editor.ts`

> CM6 제약: **블록 위젯은 StateField로 제공**해야 한다. 공통 빌더를 만들어 Mermaid/표/블록수식이 재사용한다.

- [ ] **Step 1: mermaid 설치**
```
npm i mermaid
```

- [ ] **Step 2: 공통 블록-위젯 StateField 빌더.** Create `src/editor/blockWidgets.ts`:
```ts
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

export interface BlockSpec {
  /** 이 노드를 위젯으로 만들지 판단. true면 render로 위젯 생성. */
  match(state: EditorState, nodeName: string, from: number, to: number): boolean;
  /** 위젯 DOM 생성(소스 텍스트를 받아 렌더된 엘리먼트 반환). */
  render(source: string): HTMLElement;
  /** 같은 source면 위젯 동일 취급(캐시/비교용). */
  key(source: string): string;
}

class BlockWidget extends WidgetType {
  constructor(readonly spec: BlockSpec, readonly source: string) { super(); }
  eq(other: BlockWidget) { return other.spec === this.spec && this.spec.key(this.source) === other.spec.key(this.source); }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-block-widget";
    wrap.appendChild(this.spec.render(this.source));
    return wrap;
  }
  ignoreEvent() { return false; }
}

function cursorInside(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) if (r.to >= from && r.from <= to) return true;
  return false;
}

function buildFor(state: EditorState, specs: BlockSpec[]): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  syntaxTree(state).iterate({
    enter: (node) => {
      for (const spec of specs) {
        if (spec.match(state, node.name, node.from, node.to)) {
          if (cursorInside(state, node.from, node.to)) return; // 커서 안 → 원본 노출
          const source = state.doc.sliceString(node.from, node.to);
          b.add(node.from, node.to, Decoration.replace({ widget: new BlockWidget(spec, source), block: true }));
          return;
        }
      }
    },
  });
  return b.finish();
}

/** 여러 BlockSpec을 받아 하나의 StateField 확장으로 만든다. */
export function blockWidgets(specs: BlockSpec[]): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => buildFor(state, specs),
    update: (deco, tr) => (tr.docChanged || tr.selection ? buildFor(tr.state, specs) : deco),
    provide: (f) => EditorView.decorations.from(f),
  });
  return field;
}
```

- [ ] **Step 3: Mermaid BlockSpec.** Create `src/editor/mermaid.ts`:
```ts
import mermaid from "mermaid";
import type { EditorState } from "@codemirror/state";
import type { BlockSpec } from "./blockWidgets";

mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });

// FencedCode 노드의 info 문자열이 "mermaid"인지 확인.
function isMermaidFence(state: EditorState, name: string, from: number, to: number): boolean {
  if (name !== "FencedCode") return false;
  const firstLine = state.doc.lineAt(from).text.trim();
  return /^`{3,}\s*mermaid\b/.test(firstLine) || /^~{3,}\s*mermaid\b/.test(firstLine);
}

// 펜스 본문(첫 줄 ```mermaid, 마지막 ``` 제외) 추출.
function innerCode(source: string): string {
  const lines = source.split("\n");
  return lines.slice(1, lines[lines.length - 1].trim().startsWith("```") || lines[lines.length - 1].trim().startsWith("~~~") ? -1 : undefined).join("\n");
}

let seq = 0;
export const mermaidSpec: BlockSpec = {
  match: (state, name, from, to) => isMermaidFence(state, name, from, to),
  key: (source) => "mermaid:" + source,
  render: (source) => {
    const el = document.createElement("div");
    el.className = "cm-mermaid";
    const code = innerCode(source);
    const id = "mmd-" + seq++;
    mermaid
      .render(id, code)
      .then(({ svg }) => { el.innerHTML = svg; })
      .catch((err) => { el.className = "cm-mermaid-error"; el.textContent = "Mermaid 오류: " + (err?.message ?? err); });
    return el;
  },
};
```

- [ ] **Step 4: 연결 + 스타일.** Modify `src/editor/editor.ts`:
  - `import { blockWidgets } from "./blockWidgets";` ; `import { mermaidSpec } from "./mermaid";`
  - extensions에 `blockWidgets([mermaidSpec]),` 추가(`livePreview` 다음).
  Modify `src/theme/editorTheme.ts`:
  ```ts
    ".cm-block-widget": { margin: "0.4em 0" },
    ".cm-mermaid": { display: "flex", justifyContent: "center", padding: "8px", background: "var(--faint)", border: "1px solid var(--border)", borderRadius: "10px" },
    ".cm-mermaid-error": { color: "var(--accent)", fontFamily: "var(--mono)", fontSize: "0.85em", padding: "8px" },
  ```

- [ ] **Step 5: 컴파일.** `npx tsc --noEmit` ; `npm run build`.

- [ ] **Step 6: 사람 스모크 (반복).** 입력:
  ````
  ```mermaid
  graph LR
    A[시작] --> B[처리] --> C[끝]
  ```
  ````
  → 블록이 다이어그램으로 렌더되는지, 그 블록에 커서를 넣으면 원본 소스로 돌아오는지, 빼면 다시 렌더되는지. 깨진 mermaid면 오류 메시지 위젯. (FencedCode info 판별/펜스 본문 추출이 어긋나면 컨트롤러가 `isMermaidFence`/`innerCode`를 스모크 피드백으로 보정.)

- [ ] **Step 7: 커밋.**
```
git add src/editor/blockWidgets.ts src/editor/mermaid.ts src/editor/editor.ts src/theme/editorTheme.ts
git commit -m "feat(m2): mermaid block rendering via shared block-widget infrastructure"
```

---

## Task 3: KaTeX 수식 (인라인 `$...$` + 블록 `$$...$$`)

**Files:** Create `src/editor/math.ts`; Modify `src/editor/editor.ts`, `src/main.ts`(또는 fonts) — KaTeX CSS import

- [ ] **Step 1: katex 설치**
```
npm i katex
```
그리고 `src/theme/fonts.ts`에 `import "katex/dist/katex.min.css";` 추가(번들).

- [ ] **Step 2: 수식 위젯.** Create `src/editor/math.ts`:
```ts
import katex from "katex";
import { type Extension, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

class MathWidget extends WidgetType {
  constructor(readonly tex: string, readonly block: boolean) { super(); }
  eq(o: MathWidget) { return o.tex === this.tex && o.block === this.block; }
  toDOM() {
    const el = document.createElement(this.block ? "div" : "span");
    el.className = this.block ? "cm-math-block" : "cm-math-inline";
    try { el.innerHTML = katex.renderToString(this.tex, { displayMode: this.block, throwOnError: false }); }
    catch { el.textContent = this.tex; }
    return el;
  }
  ignoreEvent() { return false; }
}

// $$...$$ (블록, 멀티라인 허용) 와 $...$ (인라인) 를 스캔.
const BLOCK_RE = /\$\$([^$]+?)\$\$/g;
const INLINE_RE = /(?<!\$)\$([^$\n]+?)\$(?!\$)/g;

function activeLine(view: EditorView, pos: number) {
  const ln = view.state.doc.lineAt(pos).number;
  for (const r of view.state.selection.ranges) {
    const a = view.state.doc.lineAt(r.from).number, b = view.state.doc.lineAt(r.to).number;
    if (ln >= a && ln <= b) return true;
  }
  return false;
}

function build(view: EditorView): DecorationSet {
  const ranges: { from: number; to: number; deco: Decoration }[] = [];
  const text = view.state.doc.toString();
  for (const m of text.matchAll(BLOCK_RE)) {
    const from = m.index!, to = from + m[0].length;
    if (!activeLine(view, from)) ranges.push({ from, to, deco: Decoration.replace({ widget: new MathWidget(m[1].trim(), true), block: true }) });
  }
  for (const m of text.matchAll(INLINE_RE)) {
    const from = m.index!, to = from + m[0].length;
    if (!activeLine(view, from)) ranges.push({ from, to, deco: Decoration.replace({ widget: new MathWidget(m[1].trim(), false) }) });
  }
  ranges.sort((a, b) => a.from - b.from);
  // 겹침 제거(블록이 인라인을 포함하는 경우 블록 우선): 단순 비겹침만 채택.
  const b = new RangeSetBuilder<Decoration>();
  let last = -1;
  for (const r of ranges) { if (r.from >= last) { b.add(r.from, r.to, r.deco); last = r.to; } }
  return b.finish();
}

export function mathPreview(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(v: EditorView) { this.decorations = build(v); }
      update(u: ViewUpdate) { if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = build(u.view); }
    },
    {
      decorations: (v) => v.decorations,
      provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.decorations ?? Decoration.none),
    },
  );
}
```
> 메모: base markdown은 `$`를 파싱하지 않으므로 정규식 스캔으로 처리(코드스팬 내부 `$`는 추후 보정 대상). 블록 위젯을 ViewPlugin에서 제공하는 점이 CM 제약과 충돌할 수 있다 — 만약 런타임 경고/오류가 나면 블록 수식만 `blockWidgets` StateField 경로로 옮기고 인라인만 ViewPlugin으로 둔다(스모크에서 확인).

- [ ] **Step 3: 연결 + 스타일.** Modify `editor.ts`: `import { mathPreview } from "./math";` extensions에 `mathPreview(),` 추가. `editorTheme.ts`에:
```ts
    ".cm-math-block": { display: "block", textAlign: "center", margin: "0.5em 0" },
    ".cm-math-inline": { padding: "0 0.1em" },
```

- [ ] **Step 4: 컴파일** `npx tsc --noEmit` ; `npm run build`.

- [ ] **Step 5: 사람 스모크 (반복).** 입력: `질량-에너지 $E = mc^2$ 그리고` / 별도 줄에 `$$\int_0^1 x^2\,dx = \frac{1}{3}$$` → 인라인/블록 수식 렌더, 커서 진입 시 원본. (블록 위젯 경고 시 위 메모대로 보정.)

- [ ] **Step 6: 커밋** `git add src/editor/math.ts src/editor/editor.ts src/theme/editorTheme.ts src/theme/fonts.ts` ; `git commit -m "feat(m2): inline/block KaTeX math rendering"`

---

## Task 4: GFM 표 렌더링

**Files:** Create `src/editor/table.ts`; Modify `src/editor/editor.ts`

- [ ] **Step 1: 표 BlockSpec.** Create `src/editor/table.ts`. GFM 표는 Lezer `Table` 노드로 파싱된다. 소스를 줄 단위로 파싱해 `<table>`을 만든다(헤더/구분선/행):
```ts
import type { EditorState } from "@codemirror/state";
import type { BlockSpec } from "./blockWidgets";

function splitRow(line: string): string[] {
  return line.replace(/^\s*\|?/, "").replace(/\|?\s*$/, "").split("|").map((c) => c.trim());
}

function renderTable(source: string): HTMLElement {
  const lines = source.split("\n").filter((l) => l.trim() !== "");
  const table = document.createElement("table");
  table.className = "cm-md-table";
  if (lines.length >= 1) {
    const thead = table.createTHead();
    const hr = thead.insertRow();
    for (const c of splitRow(lines[0])) { const th = document.createElement("th"); th.textContent = c; hr.appendChild(th); }
  }
  const body = table.createTBody();
  for (let i = 2; i < lines.length; i++) { // 0=헤더, 1=구분선
    const row = body.insertRow();
    for (const c of splitRow(lines[i])) { const td = row.insertCell(); td.textContent = c; }
  }
  return table;
}

export const tableSpec: BlockSpec = {
  match: (_state: EditorState, name: string) => name === "Table",
  key: (source: string) => "table:" + source,
  render: (source: string) => renderTable(source),
};
```

- [ ] **Step 2: 연결 + 스타일.** Modify `editor.ts`: `import { tableSpec } from "./table";` 그리고 `blockWidgets([mermaidSpec])` → `blockWidgets([mermaidSpec, tableSpec])`. `editorTheme.ts`에:
```ts
    ".cm-md-table": { borderCollapse: "collapse", width: "100%", fontSize: "0.95em" },
    ".cm-md-table th, .cm-md-table td": { border: "1px solid var(--border)", padding: "5px 10px", textAlign: "left" },
    ".cm-md-table th": { background: "var(--faint)", fontWeight: "700" },
```

- [ ] **Step 3: 컴파일** `npx tsc --noEmit` ; `npm run build`.

- [ ] **Step 4: 사람 스모크 (반복).** 입력:
  ```
  | 이름 | 값 |
  | --- | --- |
  | A | 1 |
  | B | 2 |
  ```
  → 렌더된 표, 커서 진입 시 원본. (`Table` 노드명/구분선 처리 어긋나면 보정.)

- [ ] **Step 5: 커밋** `git add src/editor/table.ts src/editor/editor.ts src/theme/editorTheme.ts` ; `git commit -m "feat(m2): GFM table rendering"`

---

## Task 5: 통합 검증 + 마무리

- [ ] **Step 1: 전체 테스트** `npm test`(9 pass 유지) ; `cd src-tauri ; cargo test`(5 pass).
- [ ] **Step 2: 릴리스 빌드** `npm run tauri build -- --no-bundle`. (mermaid/katex로 번들이 커짐 — 정상. 너무 느리면 `cargo build --release` 폴백.)
- [ ] **Step 3: 사람 종합 스모크** 코드 하이라이팅·Mermaid·수식·표 + M1 회귀(Live Preview/테마/열기·저장) 한 번에.
- [ ] **Step 4: README 현황 M2로 갱신.**
- [ ] **Step 5: 커밋.**

---

## 알려진 한계 / 다음
- 이미지(붙여넣기/드롭 + Rust `save_asset`) = 다음 마일스톤.
- 내보내기(HTML/PDF)에서 동일 렌더(특히 mermaid/katex 정적화), Shiki = 이후.
- 코드스팬 내부 `$`, 중첩/이스케이프 수식, 표 정렬(`:---:`) 세부 = 스모크 피드백으로 점진 개선.
- 번들 크기 증가(mermaid ~큼) → 추후 동적 import로 코드 스플리팅 고려.
