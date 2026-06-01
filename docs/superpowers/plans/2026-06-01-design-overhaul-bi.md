# Rune Design Overhaul (BI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the Rune app to the new Brand Identity in `docs/design.md` — halftone-sparkle logo/icon (vector), Ink/Cobalt color tokens (light/dark), Michroma wordmark + Pretendard(CJK) + IBM Plex Mono — keeping the existing layout structure and inline live-preview editor.

**Architecture:** Depth **B** (look & feel overhaul, structure retained). Colors flow through CSS variables in `src/styles.css`, which `editorTheme.ts` and all chrome already consume — so most of the re-skin is token + selector edits. A new `src/brand/sparkle.ts` is the single source for the in-app vector sparkle; a tracked `tools/gen-brand-assets.mjs` produces production SVGs + the 1024px icon master. Out of scope (separate plans): Focus mode, document outline, sidebar search.

**Tech Stack:** TypeScript, Vite, Vitest, CSS custom properties, `@resvg/resvg-js` (asset generation), `@fontsource/*`, Tauri icon CLI.

---

## Reference
- Design system / source of truth: `docs/design.md` (§2 logo, §3 color, §4 type, §6 layout tokens, §7 app application).
- Current tokens: `src/styles.css` `:root` + `:root[data-theme="dark"]`.
- Fonts imported in: `src/theme/fonts.ts`.
- Editor theme (reads vars): `src/theme/editorTheme.ts`.
- Chrome (titlebar/statusbar): `src/chrome/chrome.ts`. Sidebar tree: `src/workspace/fileTree.ts`. Tabs: `src/workspace/tabBar.ts`. Entry/mounting + theme: `src/main.ts`. Markup root: `index.html`.

## File Structure (what changes)
- **Create** `src/brand/sparkle.ts` — vector sparkle path + inline SVG string (in-app logo, favicon source). One responsibility: the mark geometry.
- **Create** `src/brand/sparkle.test.ts`, `src/theme/tokens.test.ts`, `src/theme/fonts.test.ts` — regression guards.
- **Create** `tools/gen-brand-assets.mjs` — emits production SVGs to `src/assets/brand/` + PNG master to `tools/.out/`.
- **Create** `src/assets/brand/*.svg`, `public/favicon.svg` — committed vector assets.
- **Modify** `package.json` (deps + `gen:brand` script), `src/theme/fonts.ts`, `src/styles.css` (tokens + all chrome selectors), `src/theme/editorTheme.ts` (radii/token polish), `src/chrome/chrome.ts` (sparkle in top bar), `src/workspace/fileTree.ts` (mount target), `src/main.ts` (sidebar lockup + filetree mount), `index.html` (sidebar split + favicon link).
- **Regenerate** `src-tauri/icons/*` via `npm run tauri icon`.

---

## Task 1: Brand sparkle module (vector mark)

**Files:**
- Create: `src/brand/sparkle.ts`
- Test: `src/brand/sparkle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/brand/sparkle.test.ts
import { describe, it, expect } from "vitest";
import { sparklePath, sparkleSvg } from "./sparkle";

describe("sparkle", () => {
  it("path is a closed move/curve string", () => {
    const d = sparklePath();
    expect(d.startsWith("M ")).toBe(true);
    expect(d.trim().endsWith("Z")).toBe(true);
    expect(d).toContain("Q"); // concave quad curves
  });
  it("svg embeds the path, viewBox, and size", () => {
    const s = sparkleSvg(20);
    expect(s).toContain("<svg");
    expect(s).toContain('viewBox="0 0 24 24"');
    expect(s).toContain('width="20"');
    expect(s).toContain("<path");
  });
  it("defaults fill to currentColor (CSS-controllable)", () => {
    expect(sparkleSvg()).toContain("currentColor");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/brand/sparkle.test.ts`
Expected: FAIL — `Cannot find module './sparkle'`.

- [ ] **Step 3: Implement the module**

```ts
// src/brand/sparkle.ts
/** 4-point concave star (sparkle) — the Rune mark. `f` = waist factor (smaller = pointier). */
export function sparklePath(cx = 12, cy = 12, R = 11, f = 0.15): string {
  const k = R * f;
  return (
    `M ${cx},${cy - R} ` +
    `Q ${cx + k},${cy - k} ${cx + R},${cy} ` +
    `Q ${cx + k},${cy + k} ${cx},${cy + R} ` +
    `Q ${cx - k},${cy + k} ${cx - R},${cy} ` +
    `Q ${cx - k},${cy - k} ${cx},${cy - R} Z`
  );
}

/** Inline SVG string for the solid sparkle. Uses currentColor so CSS controls the tint. */
export function sparkleSvg(size = 24, color = "currentColor"): string {
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">` +
    `<path d="${sparklePath()}" fill="${color}"/></svg>`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/brand/sparkle.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/brand/sparkle.ts src/brand/sparkle.test.ts
git commit -m "feat(brand): vector sparkle mark module"
```

---

## Task 2: Brand fonts (Michroma + IBM Plex Mono)

**Files:**
- Modify: `package.json` (dependencies + scripts)
- Modify: `src/theme/fonts.ts`
- Test: `src/theme/fonts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/theme/fonts.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const fonts = readFileSync(new URL("./fonts.ts", import.meta.url), "utf8");

describe("brand fonts", () => {
  it("declares michroma + ibm-plex-mono deps", () => {
    expect(pkg.dependencies["@fontsource/michroma"]).toBeTruthy();
    expect(pkg.dependencies["@fontsource/ibm-plex-mono"]).toBeTruthy();
  });
  it("imports michroma + plex mono in fonts.ts", () => {
    expect(fonts).toContain("@fontsource/michroma");
    expect(fonts).toContain("@fontsource/ibm-plex-mono");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/theme/fonts.test.ts`
Expected: FAIL — michroma dep/import missing.

- [ ] **Step 3: Install fonts**

Run:
```bash
npm install @fontsource/michroma @fontsource/ibm-plex-mono
npm uninstall @fontsource/jetbrains-mono
```
Expected: `package.json` gains `@fontsource/michroma`, `@fontsource/ibm-plex-mono`; loses `@fontsource/jetbrains-mono`.

- [ ] **Step 4: Update `src/theme/fonts.ts`**

Replace the JetBrains Mono imports with Michroma + IBM Plex Mono:
```ts
// src/theme/fonts.ts
import "pretendard/dist/web/variable/pretendardvariable.css";
import "@fontsource/michroma/400.css";          // wordmark / Latin display only
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
```

- [ ] **Step 5: Run test + build to verify**

Run: `npx vitest run src/theme/fonts.test.ts` → PASS
Run: `npm run build` → succeeds (no missing-module errors from the removed JetBrains import).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/theme/fonts.ts src/theme/fonts.test.ts
git commit -m "feat(brand): add Michroma + IBM Plex Mono, drop JetBrains Mono"
```

---

## Task 3: Color tokens + layout-token variables

**Files:**
- Modify: `src/styles.css:1-10` (the `:root` and `:root[data-theme="dark"]` blocks)
- Test: `src/theme/tokens.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/theme/tokens.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("design tokens", () => {
  it("light accent is Cobalt", () => expect(css).toMatch(/--accent:\s*#114ADB/i));
  it("paper surface present", () => expect(css).toMatch(/--faint:\s*#FAF8F6/i));
  it("dark theme uses Ink background", () =>
    expect(css).toMatch(/data-theme="dark"[\s\S]*?--bg:\s*#0D0F12/i));
  it("display + mono tokens declared", () => {
    expect(css).toMatch(/--display:/);
    expect(css).toMatch(/IBM Plex Mono/i);
  });
  it("layout tokens declared", () => {
    expect(css).toMatch(/--radius-md:/);
    expect(css).toMatch(/--shadow-lg:/);
    expect(css).toMatch(/--space-4:/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/theme/tokens.test.ts`
Expected: FAIL (old tokens use `#5b5bd6`, no `--display`/layout tokens).

- [ ] **Step 3: Replace the token blocks**

Replace `src/styles.css` lines 1–10 (`:root { … }` and `:root[data-theme="dark"] { … }`) with:
```css
:root {
  /* color — light (docs/design.md §3) */
  --bg:#FFFFFF; --faint:#FAF8F6; --border:#E2E5E9;
  --text:#0D0F12; --muted:#6B717A; --accent:#114ADB; --accent-soft:#E7EDFB;
  --accent-hover:#0F3FBE;
  /* type */
  --sans:"Pretendard Variable", Pretendard, -apple-system, system-ui, "Apple SD Gothic Neo", sans-serif;
  --mono:"IBM Plex Mono", "Pretendard Variable", ui-monospace, Menlo, Consolas, monospace;
  --display:"Michroma", var(--sans);
  /* spacing (4px base) */
  --space-4:4px; --space-8:8px; --space-12:12px; --space-16:16px; --space-24:24px; --space-32:32px;
  /* radius */
  --radius-sm:6px; --radius-md:10px; --radius-lg:14px; --radius-xl:20px;
  /* elevation */
  --shadow-sm:0 1px 2px rgba(13,15,18,.06);
  --shadow-md:0 4px 16px rgba(13,15,18,.10);
  --shadow-lg:0 20px 60px rgba(13,15,18,.25);
  /* motion */
  --ease:cubic-bezier(0.2,0,0,1); --dur:180ms;
}
:root[data-theme="dark"] {
  --bg:#0D0F12; --faint:#15181D; --border:#2C3138;
  --text:#ECEEF1; --muted:#8A909C; --accent:#3D74F0; --accent-soft:#16233F;
  --accent-hover:#5B8DEF;
}
```

- [ ] **Step 4: Run test + build to verify**

Run: `npx vitest run src/theme/tokens.test.ts` → PASS (5 tests)
Run: `npm run build` → succeeds.

- [ ] **Step 5: Human visual smoke**

Run `npm run tauri dev`. Confirm app loads with: white editor canvas, warm-paper chrome, **cobalt** cursor/links/active states (light); toggle dark → Ink background, brighter cobalt. No broken colors. (Chrome layout polish comes in Tasks 4–7.)

- [ ] **Step 6: Commit**

```bash
git add src/styles.css src/theme/tokens.test.ts
git commit -m "feat(theme): Ink/Cobalt color tokens + layout-token variables"
```

---

## Task 4: Top bar re-skin + sparkle logo

**Files:**
- Modify: `src/chrome/chrome.ts:16-25` (mount markup)
- Modify: `src/styles.css` (`#titlebar` rules, ~line 14-17)

- [ ] **Step 1: Inject the sparkle into the top bar**

In `src/chrome/chrome.ts`, add the import at top:
```ts
import { sparkleSvg } from "../brand/sparkle";
```
Replace the `spacerL` block (lines ~23-25) with a brand mark:
```ts
  const brand = document.createElement("span");
  brand.className = "tb-brand";
  brand.innerHTML = sparkleSvg(18);
  titlebar.replaceChildren(brand, title, settingsBtn);
```
(Removes the empty 40px spacer; the 18px mark + gear roughly balance the centered title.)

- [ ] **Step 2: Re-skin `#titlebar` in `src/styles.css`**

Replace the existing `#titlebar` / `#titlebar .doc-title` / `#titlebar button` rules with:
```css
#titlebar { height:40px; flex-shrink:0; display:flex; align-items:center; padding:0 var(--space-12); gap:var(--space-12);
  border-bottom:1px solid var(--border); background:var(--faint); font-size:12.5px; color:var(--muted); user-select:none; }
#titlebar .tb-brand { display:inline-flex; align-items:center; color:var(--text); }
#titlebar .tb-brand svg { display:block; }
#titlebar .doc-title { flex:1; text-align:center; color:var(--text); font-weight:500; }
#titlebar .dirty { color:var(--accent); }
#titlebar button { background:none; border:none; color:var(--muted); font-size:14px; line-height:1; padding:4px 8px;
  border-radius:var(--radius-sm); cursor:pointer; transition:color var(--dur) var(--ease), background var(--dur) var(--ease); }
#titlebar button:hover { color:var(--text); background:var(--accent-soft); }
```
(Delete the now-duplicate `#titlebar button { … }` rule near the end of the file, line ~69.)

- [ ] **Step 2.5: Verify tsc + build**

Run: `npm run build`
Expected: succeeds (sparkle import resolves; no TS errors).

- [ ] **Step 3: Human visual smoke**

`npm run tauri dev`: sparkle mark at top-left, doc title centered, gear at right with hover. Dirty dot is cobalt.

- [ ] **Step 4: Commit**

```bash
git add src/chrome/chrome.ts src/styles.css
git commit -m "feat(chrome): sparkle logo + top bar re-skin"
```

---

## Task 5: Sidebar lockup + re-skin

**Files:**
- Modify: `index.html:13` (split `#sidebar` into header + tree)
- Modify: `src/main.ts:24` (mount file tree into `#filetree`; render lockup into `#sidebar-head`)
- Modify: `src/workspace/fileTree.ts` (no logic change — it now receives the `#filetree` element)
- Modify: `src/styles.css` (`#sidebar`, `.ft-*` rules; add `.brand-*`)

- [ ] **Step 1: Split the sidebar markup**

In `index.html`, replace `<div id="sidebar"></div>` with:
```html
        <div id="sidebar">
          <div id="sidebar-head"></div>
          <div id="filetree"></div>
        </div>
```

- [ ] **Step 2: Render the lockup + retarget the tree in `src/main.ts`**

Add import near the other imports:
```ts
import { sparkleSvg } from "./brand/sparkle";
```
Replace the `mountFileTree(...)` line (line 24) with:
```ts
document.getElementById("sidebar-head")!.innerHTML =
  `<span class="brand-mark">${sparkleSvg(20)}</span><span class="brand-word">RUNE</span>`;
const tree = mountFileTree(document.getElementById("filetree")!, (p) => void openPath(p));
```

- [ ] **Step 3: Re-skin sidebar in `src/styles.css`**

Replace the `#sidebar` rule and add brand + refreshed tree rules:
```css
#sidebar { width:240px; flex-shrink:0; display:flex; flex-direction:column; background:var(--faint);
  border-right:1px solid var(--border); font-size:13px; }
#sidebar.hidden { display:none; }
#sidebar-head { display:flex; align-items:center; gap:8px; padding:12px 14px; color:var(--text); }
#sidebar-head .brand-mark { display:inline-flex; color:var(--text); }
#sidebar-head .brand-word { font-family:var(--display); font-size:13px; letter-spacing:0.18em; color:var(--text); }
#filetree { flex:1; overflow:auto; padding:4px 6px; }
.ft-row { display:flex; align-items:center; gap:5px; padding:5px 8px; border-radius:var(--radius-md); cursor:pointer;
  color:var(--text); white-space:nowrap; transition:background var(--dur) var(--ease), color var(--dur) var(--ease); }
.ft-row:hover { background:var(--accent-soft); }
.ft-row.active { background:var(--accent-soft); color:var(--accent); font-weight:600; }
.ft-twist { width:12px; color:var(--muted); font-size:10px; flex-shrink:0; }
.ft-ws { font-size:10.5px; text-transform:uppercase; letter-spacing:0.06em; color:var(--muted); padding:8px 8px 4px; }
```
(Delete the old `#sidebar`, `.ft-row`, `:root[data-theme="dark"] .ft-row`, `.ft-twist`, `.ft-ws` rules being replaced. The per-theme `.ft-row` color override is no longer needed — `.ft-row` now uses `var(--text)`.)

- [ ] **Step 4: Verify tsc + build + tests**

Run: `npm run build` → succeeds.
Run: `npm test` → all existing tests still pass (fileTree still calls `replaceChildren` on its element).

- [ ] **Step 5: Human visual smoke**

`npm run tauri dev`, open a folder: RUNE lockup (Michroma, letter-spaced) above the tree; tree rows have cobalt-soft hover, cobalt active. Lockup persists when no folder is open.

- [ ] **Step 6: Commit**

```bash
git add index.html src/main.ts src/styles.css
git commit -m "feat(sidebar): RUNE lockup header + tree re-skin"
```

---

## Task 6: Tab bar + status bar re-skin

**Files:**
- Modify: `src/styles.css` (`#tabbar`, `.tab*`, `#statusbar` rules)
- Modify: `src/chrome/chrome.ts` (status bar markup: add Auto Save indicator)

- [ ] **Step 1: Re-skin tab bar + status bar in `src/styles.css`**

Replace the `#tabbar`, `.tab`, `.tab.active`, `.tab .label`, `.tab .dirty`, `.tab .close`, `.tab .close:hover`, and `#statusbar` rules with:
```css
#tabbar { display:flex; align-items:stretch; height:36px; background:var(--faint); border-bottom:1px solid var(--border); overflow-x:auto; }
#tabbar:empty { display:none; }
.tab { display:flex; align-items:center; gap:6px; padding:0 12px; max-width:200px; border-right:1px solid var(--border);
  cursor:pointer; font-size:12.5px; color:var(--muted); white-space:nowrap;
  border-top:2px solid transparent; transition:background var(--dur) var(--ease), color var(--dur) var(--ease); }
.tab.active { background:var(--bg); color:var(--text); border-top-color:var(--accent); }
.tab .label { overflow:hidden; text-overflow:ellipsis; }
.tab .dirty { color:var(--accent); }
.tab .close { width:16px; height:16px; border-radius:var(--radius-sm); display:inline-flex; align-items:center; justify-content:center; color:var(--muted); }
.tab .close:hover { background:var(--border); color:var(--text); }
#statusbar { height:26px; flex-shrink:0; display:flex; align-items:center; justify-content:space-between; padding:0 16px;
  border-top:1px solid var(--border); background:var(--faint); font-size:11px; color:var(--muted); user-select:none; }
#statusbar .sb-right { display:flex; align-items:center; gap:14px; }
#statusbar .sb-autosave { display:inline-flex; align-items:center; gap:5px; }
#statusbar .sb-autosave::before { content:""; width:6px; height:6px; border-radius:999px; background:var(--accent); display:inline-block; }
```

- [ ] **Step 2: Add the Auto Save indicator in `src/chrome/chrome.ts`**

In `mountChrome`, replace the status bar markup (lines ~27-29) with a right group that includes an autosave chip:
```ts
  const left = document.createElement("span");
  const right = document.createElement("span");
  right.className = "sb-right";
  const lineCol = document.createElement("span");
  const autoSave = document.createElement("span");
  autoSave.className = "sb-autosave";
  autoSave.textContent = t("status.autosave");
  right.replaceChildren(lineCol, autoSave);
  statusbar.replaceChildren(left, right);
```
Update `setStatus` to write into `lineCol` (not `right`):
```ts
    setStatus(text, line, col) {
      left.textContent = t("status.words", { n: countWords(text) });
      lineCol.textContent = t("status.lineCol", { line, col });
    },
```
And in `relabel()`, refresh the autosave label:
```ts
      autoSave.textContent = t("status.autosave");
```

- [ ] **Step 3: Add the `status.autosave` i18n key**

In `src/i18n/i18n.ts`, add to each locale dict: `"status.autosave"` → en `"Auto Save"`, ko `"자동 저장"`, ja `"自動保存"`, zh-Hans `"自动保存"`.

- [ ] **Step 4: Verify tsc + build + tests**

Run: `npm run build` → succeeds.
Run: `npm test` → existing i18n test still passes (new key is additive; fallback test unaffected).

- [ ] **Step 5: Human visual smoke**

`npm run tauri dev`: active tab has a cobalt top-border; status bar right shows line/col + an "Auto Save" chip with a cobalt dot. Switch locale → label translates.

- [ ] **Step 6: Commit**

```bash
git add src/styles.css src/chrome/chrome.ts src/i18n/i18n.ts
git commit -m "feat(chrome): tab bar + status bar re-skin with auto-save indicator"
```

---

## Task 7: Editor canvas + modals + buttons polish

**Files:**
- Modify: `src/theme/editorTheme.ts` (radii/token polish)
- Modify: `src/styles.css` (modal cards, inputs, rows, settings, conflict banner, buttons)

- [ ] **Step 1: Editor theme polish in `src/theme/editorTheme.ts`**

Update these properties (values only — keep the rest):
- `.cm-md-code` and `.cm-md-codeblock`: `borderRadius: "var(--radius-sm)"`.
- `.cm-mermaid`: `borderRadius: "var(--radius-lg)"`.
- `.cm-md-image`: `borderRadius: "var(--radius-md)"`.
- `.cm-md-quote`: `borderLeft: "3px solid var(--accent-soft)"`.
Leave cursor (`var(--accent)`), selection, and headings as-is (they already track tokens → now cobalt).

- [ ] **Step 2: Re-skin modals/inputs/buttons in `src/styles.css`**

Update the radius/shadow of cards and the focus/hover treatments. Replace the `.cp-card`, `.cp-input`, `.cp-row.sel`/`:hover`, `.sp-card`, `.sp-input`, `.sp-row:hover`, `.sp-file`, `.settings-card`, `.settings-row select`, and `.conflict-banner button` rules so that:
- cards use `border-radius:var(--radius-xl); box-shadow:var(--shadow-lg); border:1px solid var(--border);`
- inputs use `border-bottom:1px solid var(--border);` and on focus `outline:none; border-bottom-color:var(--accent);`
- selected/hover rows use `background:var(--accent-soft);`
- `.sp-file` and `.settings-row select:focus` use `var(--accent)`.
- `.conflict-banner button:hover { border-color:var(--accent); color:var(--accent); }`

Add a reusable button style block at the end of the file:
```css
.btn { font-family:var(--sans); font-size:13px; padding:6px 12px; border-radius:var(--radius-md); cursor:pointer; border:1px solid transparent;
  transition:background var(--dur) var(--ease), border-color var(--dur) var(--ease), color var(--dur) var(--ease); }
.btn-primary { background:var(--accent); color:#fff; }
.btn-primary:hover { background:var(--accent-hover); }
.btn-secondary { background:var(--bg); border-color:var(--border); color:var(--text); }
.btn-secondary:hover { border-color:var(--accent); color:var(--accent); }
.btn-ghost { background:none; color:var(--muted); }
.btn-ghost:hover { color:var(--text); }
```

- [ ] **Step 3: Verify build + tests**

Run: `npm run build` → succeeds. Run: `npm test` → all pass (render.test/others unaffected — styling only).

- [ ] **Step 4: Human visual smoke**

`npm run tauri dev`: open command palette (Ctrl/Cmd-K), search (Ctrl/Cmd-Shift-F), settings (gear) — cards have larger radius + soft shadow, cobalt focus underlines, cobalt-soft row highlight. Code blocks/quotes/tables/mermaid look cohesive in light + dark.

- [ ] **Step 5: Commit**

```bash
git add src/theme/editorTheme.ts src/styles.css
git commit -m "feat(theme): editor, modal, and button polish to BI tokens"
```

---

## Task 8: Production brand assets + favicon generator

**Files:**
- Create: `tools/gen-brand-assets.mjs`
- Modify: `package.json` (devDep `@resvg/resvg-js` + `gen:brand` script)
- Create (generated, committed): `src/assets/brand/sparkle-solid.svg`, `sparkle-halftone-dark.svg`, `sparkle-halftone-light.svg`, `sparkle-halftone-cobalt.svg`; `public/favicon.svg`
- Create (gitignored): `tools/.out/rune-icon-1024.png`
- Modify: `index.html` (favicon link), `.gitignore` (`tools/.out/`)

- [ ] **Step 1: Install the rasterizer + add script**

Run: `npm install -D @resvg/resvg-js`
In `package.json` `scripts`, add: `"gen:brand": "node tools/gen-brand-assets.mjs"`.

- [ ] **Step 2: Write the generator** (`tools/gen-brand-assets.mjs`)

```js
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { sparklePath } from "../src/brand/sparkle.ts"; // see note below

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brandDir = join(root, "src/assets/brand");
const outDir = join(root, "tools/.out");
mkdirSync(brandDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const C = 1024, CX = 512, CY = 512;
// 1024-space sparkle (R≈350) — reuse the same geometry as the in-app mark, scaled.
function sp(R = 350, f = 0.15) {
  const k = R * f;
  return `M ${CX},${CY-R} Q ${CX+k},${CY-k} ${CX+R},${CY} Q ${CX+k},${CY+k} ${CX},${CY+R} `
       + `Q ${CX-k},${CY+k} ${CX-R},${CY} Q ${CX-k},${CY-k} ${CX},${CY-R} Z`;
}
function solid({ bg, fg }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${C}" height="${C}" viewBox="0 0 ${C} ${C}">`
       + `<rect width="${C}" height="${C}" rx="220" fill="${bg}"/><path d="${sp()}" fill="${fg}"/></svg>`;
}
function halftone({ bg, dot, R = 400, cell = 14 }) {
  const maxr = cell * 0.64; let c = "";
  for (let y = cell/2; y < C; y += cell) for (let x = cell/2; x < C; x += cell) {
    const r = Math.hypot(x-CX, y-CY);
    const inten = Math.pow(Math.max(0, 1 - r/(R*1.05)), 0.62);
    const rad = maxr * inten;
    if (rad > 0.5) c += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad.toFixed(1)}" fill="${dot}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${C}" height="${C}" viewBox="0 0 ${C} ${C}">`
       + `<defs><clipPath id="cl"><path d="${sp(R)}"/></clipPath></defs>`
       + `<rect width="${C}" height="${C}" rx="220" fill="${bg}"/><g clip-path="url(#cl)">${c}</g></svg>`;
}
// favicon: solid sparkle on transparent (24-viewBox, uses the shared in-app path)
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${sparklePath()}" fill="#0D0F12"/></svg>`;

const assets = {
  "sparkle-solid.svg": solid({ bg: "#0D0F12", fg: "#FAF8F6" }),
  "sparkle-halftone-dark.svg": halftone({ bg: "#0D0F12", dot: "#FAF8F6" }),
  "sparkle-halftone-light.svg": halftone({ bg: "#FAF8F6", dot: "#0D0F12" }),
  "sparkle-halftone-cobalt.svg": halftone({ bg: "#0D0F12", dot: "#3D74F0" }),
};
for (const [name, svg] of Object.entries(assets)) writeFileSync(join(brandDir, name), svg);
writeFileSync(join(root, "public/favicon.svg"), favicon);
// 1024 PNG master for `tauri icon` — DARK FINE HALFTONE (premium dock look)
writeFileSync(join(outDir, "rune-icon-1024.png"),
  new Resvg(assets["sparkle-halftone-dark.svg"], { fitTo: { mode: "width", value: 1024 } }).render().asPng());
console.log("brand assets written");
```
> **Note on the import:** if Node cannot import the `.ts` file directly, inline a copy of `sparklePath()` at the top of this script (it is a 6-line pure function) instead of importing — keep the two in sync. The favicon must match the in-app mark.

- [ ] **Step 3: Generate + verify outputs**

Run: `npm run gen:brand`
Expected: console `brand assets written`; files exist:
```bash
ls src/assets/brand/    # 4 .svg files
ls public/favicon.svg
ls tools/.out/rune-icon-1024.png
```
Verify each SVG contains `<svg` and a `<path`/`<circle>`:
```bash
grep -l "<svg" src/assets/brand/*.svg public/favicon.svg
```

- [ ] **Step 4: Wire favicon + ignore build output**

In `index.html` `<head>`, add: `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`.
In `.gitignore`, add: `tools/.out/`.

- [ ] **Step 5: Build to confirm favicon resolves**

Run: `npm run build` → succeeds; `dist/` contains `favicon.svg`.

- [ ] **Step 6: Commit**

```bash
git add tools/gen-brand-assets.mjs package.json package-lock.json src/assets/brand public/favicon.svg index.html .gitignore
git commit -m "feat(brand): asset generator, production sparkle SVGs, favicon"
```

---

## Task 9: App icon regeneration + final verification

**Files:**
- Regenerate: `src-tauri/icons/*`
- Verify: whole app

- [ ] **Step 1: Regenerate platform icons from the master**

Run: `npm run tauri icon tools/.out/rune-icon-1024.png`
Expected: `src-tauri/icons/` PNGs, `icon.icns`, `icon.ico`, and Square*Logo.png are overwritten with the sparkle.

- [ ] **Step 2: Full automated gate**

Run: `npm test` → all pass (frontend).
Run: `npm run build` → succeeds.
Run: `npm run tauri build -- --no-bundle` → release binary builds.

- [ ] **Step 3: Human visual smoke (light + dark)**

`npm run tauri dev`:
- Top bar sparkle, sidebar RUNE lockup (Michroma), cobalt accents throughout.
- Editor: cobalt cursor, cobalt links, cohesive code/quote/table/mermaid in both themes.
- Palette / search / settings modals: xl radius, soft shadow, cobalt focus.
- Tabs: cobalt active top-border. Status bar: Auto Save chip.
- Toggle dark/light via settings — all regions consistent; no orphan old colors.
- App window/taskbar icon shows the sparkle (may require app restart to refresh OS icon cache).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/icons
git commit -m "feat(brand): regenerate app icons from sparkle master"
```

- [ ] **Step 5: Finish the branch**

Use **superpowers:finishing-a-development-branch** to merge/PR per the user's choice.

---

## Self-Review (against `docs/design.md`)

- **§2 logo/icon:** sparkle module (T1), in-app logo top bar + sidebar (T4/T5), production SVGs + favicon (T8), OS icons (T9). Size-adaptive: in-app uses solid (small); favicon solid; OS master fine-halftone (note: if 16px OS icon reads mushy after T9 visual smoke, swap the T8 master to `halftone({cell:52})` coarse and re-run T9). ✔
- **§3 color:** tokens light/dark + layout tokens (T3), applied across chrome (T4–T7). ✔
- **§4 type:** Michroma/Plex deps+imports (T2), `--display`/`--mono` (T3), wordmark uses `--display` (T5). Pretendard body unchanged = CJK retained. ✔
- **§6 layout tokens:** radius/shadow/space/motion vars (T3), used in T4–T7. ✔
- **§7 app application:** top bar (T4), sidebar (T5), tab+status (T6), editor+modals+buttons (T7). Inline live-preview untouched; Focus/outline/search excluded per scope. ✔
- **§9 deliverables (app subset):** SVG set + favicon + icon master + OS icons (T8/T9). Landing/OG templates are out of app scope — produced separately from the same `docs/design.md` + generator. ✔
- **No placeholders:** all steps carry concrete code/CSS/commands. ✔
- **Type consistency:** `sparklePath`/`sparkleSvg` (T1) reused verbatim in T4/T5/T8; `status.autosave` key added (T6) before use. ✔
```
