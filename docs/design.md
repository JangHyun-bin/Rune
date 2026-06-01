# Rune — Design System (Brand & Product Identity)

> **Single source of truth** for every Rune surface: the desktop app UI, the landing page, OG/ad images, social, and store assets. If a visual decision isn't here, it isn't canon yet — add it here first.
>
> Version 1.0 · 2026-06-01 · supersedes the earlier "Minimal/Cool" theme.

---

## 1. Brand essence

**Rune is a focused, precise canvas for thinking and writing.** Markdown keeps the surface clean so ideas can breathe. The brand is calm, structured, and quietly confident — never loud, never decorative for its own sake.

**Tagline:** *Focused markdown writer for desktop.*

**Pillars** (each maps to a dot/halftone micro-icon):
| Pillar | Meaning | In product |
|---|---|---|
| **FOCUSED** | one thing, done well | distraction-free editor, focus mode |
| **QUIET** | interface recedes | muted chrome, content-forward |
| **PRECISE** | exact, dependable | atomic saves, accurate rendering |
| **STRUCTURED** | structure creates freedom | outline, headings, clean hierarchy |

**Voice:** plain, declarative, unhurried. "Make it simple, but significant." Avoid hype, exclamation, jargon. CJK-first — Korean/Japanese/Chinese copy is first-class, never an afterthought.

---

## 2. Logo system

### 2.1 Symbol — the Halftone Sparkle
A **4-point concave star (sparkle)** rendered as a **halftone dot field**: dense at the center, fading to fine dots at the four tips. The silhouette is a single sharp vector path; the dots fill it on a radial density gradient. The sparkle = a *mark made*, a point of focus, the spark of an idea written down.

**The symbol is always vector.** The original raster halftone does not scale and turns to mush below ~64px — never ship the raster. Generate from the vector source (`_icon-mockups/sparkle.cjs` → production `.svg`).

**Size-adaptive rendering** (same mark, the rendering adapts — standard favicon practice):
| Size | Treatment |
|---|---|
| ≥ 48px (app icon, dock, hero, in-app) | **Fine halftone** (~14px dot cell @1024) |
| 24–32px (favicon, taskbar, menu bar) | **Coarse halftone** (~52px dot cell @1024) — survives small |
| ≤ 16px | **Solid sparkle silhouette** (no dots) |

**Color variants:**
| Variant | Background | Dots/Fill | Use |
|---|---|---|---|
| **Dark (default app icon)** | Ink `#0D0F12` | Paper `#FAF8F6` | app icon, dock, dark UI |
| **Light** | Paper `#FAF8F6` | Ink `#0D0F12` | light backgrounds, docs |
| **Cobalt (accent)** | Ink `#0D0F12` | Cobalt `#3D74F0` | landing hero, marketing pop, active state |

### 2.2 Wordmark
**"RUNE" set in MICHROMA**, all-caps, wide. Letter-spacing **+0.12em to +0.22em** (tighter for small, wider for hero). MICHROMA is Latin-only → **wordmark and Latin marketing display only; never body or CJK text.**

### 2.3 Lockups
- **Symbol** — sparkle alone (icons, favicon, avatar).
- **Horizontal** — sparkle + `RUNE` to its right, vertically centered; gap = 0.6× symbol height.
- **Stacked** — sparkle above `RUNE`, centered; gap = 0.35× symbol height. Optional tagline below in Pretendard/Inter, letter-spaced caps.

### 2.4 Clear space & minimums
- **Clear space** = 0.5× symbol height on all sides (nothing intrudes).
- **Min symbol:** 16px (solid). **Min horizontal lockup:** 96px wide. **Min stacked:** 72px wide.

### 2.5 Misuse (don't)
Don't: recolor outside the palette · stretch/skew · rotate the sparkle · add shadows/bevels to the symbol · place fine halftone below 48px · set the wordmark in any font but MICHROMA · put the wordmark on a busy photo without a solid scrim.

---

## 3. Color

### 3.1 Core palette
| Token | Hex | Role |
|---|---|---|
| **Ink** | `#0D0F12` | primary text (light), base surface (dark) |
| **Graphite** | `#2C3138` | secondary text, borders on dark |
| **Ash** | `#6B717A` | muted text, icons, captions (both themes) |
| **Stone** | `#D7DBDF` | borders, dividers, UI lines (light) |
| **Paper** | `#FAF8F6` | warm surface (light chrome), dots on dark |
| **Cobalt** | `#114ADB` | accent: links, focus, active, primary action |

### 3.2 Derived / state
| Token | Hex | Role |
|---|---|---|
| White | `#FFFFFF` | editor canvas, modal cards (light) |
| Cobalt-Bright | `#3D74F0` | accent on dark themes, hover-glow |
| Cobalt-Hover | `#0F3FBE` | accent hover/pressed (light) |
| Cobalt-Soft | `#E7EDFB` | accent tint: hover rows, selection, soft fills (light) |
| Cobalt-Deep | `#16233F` | accent tint on dark |
| Ink-Raised | `#15181D` | raised chrome on dark |

### 3.3 App CSS-variable mapping (drop-in for `src/styles.css`)
**Light** (`:root`)
```
--bg:#FFFFFF; --faint:#FAF8F6; --border:#E2E5E9;
--text:#0D0F12; --muted:#6B717A; --accent:#114ADB; --accent-soft:#E7EDFB;
```
**Dark** (`:root[data-theme="dark"]`)
```
--bg:#0D0F12; --faint:#15181D; --border:#2C3138;
--text:#ECEEF1; --muted:#8A909C; --accent:#3D74F0; --accent-soft:#16233F;
```
*(Borders are softened Stone in light for less harshness; Graphite in dark.)*

### 3.4 Contrast
Body text Ink-on-Paper ≈ 17:1, Paper-on-Ink ≈ 16:1 (AAA). Cobalt `#114ADB` on white ≈ 6.0:1 (AA for text & UI). On dark use Cobalt-Bright `#3D74F0` (≈ 6.4:1 on Ink). Ash on white ≈ 4.0:1 — captions/secondary only, never long body.

---

## 4. Typography

| Role | Family | Notes |
|---|---|---|
| **Display / Wordmark** | **MICHROMA** | Latin only. Logo + big Latin marketing display. Never body/CJK. |
| **UI / Body / Content** | **Pretendard** | CJK-first (한·日·中) + clean Latin. All product text, including headings. |
| **Code / Mono** | **IBM Plex Mono** | code & monospace; CJK falls back to Pretendard. |
| **Marketing body (web, Latin)** | **Inter** | optional, landing/ads only where copy is Latin. |

All four are open-source (OFL). Pretendard is already bundled; add MICHROMA + IBM Plex Mono (and Inter for web) via `@fontsource` or self-host.

> **CJK rule:** product headings use **Pretendard Bold**, *not* MICHROMA (which lacks Korean/CJK glyphs). MICHROMA appears only in the locked-up wordmark and Latin marketing.

**Type scale** (rem @16px base):
| Token | Size / Line | Weight | Use |
|---|---|---|---|
| display | clamp(2.5–4rem) / 1.05 | MICHROMA 400 | hero wordmark |
| h1 | 1.9rem / 1.25 | 700 | doc H1 |
| h2 | 1.55rem / 1.3 | 700 | H2 |
| h3 | 1.3rem / 1.35 | 700 | H3 |
| h4–h6 | 1.1rem / 1.4 | 700 | H4–H6 |
| body | 1rem (16px) / 1.7 | 400 | editor & content |
| ui | 0.8125rem (13px) / 1.4 | 400–600 | chrome |
| small | 0.6875–0.75rem | 400 | status, captions |
| mono | 0.9em / 1.6 | 400 | code |

Tracking: MICHROMA caps +0.12–0.22em; UI/body normal; small caps labels +0.05em.

---

## 5. Iconography & dot language

- **Dot/halftone motif** is the brand's texture: pillar icons (FOCUSED/QUIET/PRECISE/STRUCTURED), section dividers, empty-state art, hero/landing backgrounds, subtle panel textures. Always Ash/Stone opacity on light, Graphite/Ash on dark — never competes with content.
- **UI icons** (toolbar, sidebar, status): line style, **1.75px stroke**, rounded joins, 24px grid (Lucide-compatible set). Color = Ash default, Ink/Paper on hover, Cobalt when active.

---

## 6. Layout system

- **Spacing scale (4px base):** 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
- **Radius:** sm 6 · md 10 · lg 14 · xl 20 · pill 999. (Modals lg–xl; inputs/rows md; chips pill.)
- **Elevation:**
  - sm `0 1px 2px rgba(13,15,18,.06)`
  - md `0 4px 16px rgba(13,15,18,.10)`
  - lg `0 20px 60px rgba(13,15,18,.25)` (modals)
- **Motion:** micro 120ms · default 180ms · panel 240ms; easing `cubic-bezier(0.2,0,0,1)`. Respect `prefers-reduced-motion`.
- **App chrome dimensions** (retained from current structure): titlebar 40 · sidebar 240 · tabbar 36 · statusbar 26. **Editor content max-width 720px**, centered, padding 32×28.

---

## 7. App application (re-skin spec — depth B: look overhaul, structure & inline live-preview retained)

> Architecture unchanged (`titlebar / sidebar / tabbar / editor / statusbar` + palette/search/settings modals). The **inline live-preview WYSIWYG** single-pane model is the product's identity — kept. The BI mock's split view is illustrative only.

- **Titlebar → Top bar:** left = **sparkle symbol** (20px) + optional doc path; center = doc title (Pretendard 500, Ink) with Cobalt dirty-dot; right = action icons (Ash → Ink hover). Surface `--faint`, bottom `1px --border`.
- **Sidebar:** surface `--faint`. Top = **horizontal lockup** (sparkle + RUNE). Search field (pill, `--bg`, Stone border, Cobalt focus ring). Section labels = small caps, Ash, +0.05em ("PAGES", "WORKSPACE"). File-tree rows: radius md; hover `--accent-soft`; **active = Cobalt text + soft fill**.
- **Tab bar:** tabs Pretendard 12.5px; inactive Ash; active `--bg` + Ink + 2px Cobalt top-border; dirty = Cobalt dot; close on hover.
- **Editor canvas:** `--bg` white (light) / Ink (dark). Headings Pretendard Bold per scale; **caret = Cobalt 2px**; selection = `--accent-soft`; links Cobalt underline; inline code & code blocks IBM Plex Mono on `--faint` with `--border`; blockquote Ash + Stone left-rule; tables Stone borders, `--faint` header; mermaid/KaTeX in `--faint` rounded-lg cards.
- **Status bar:** `--faint`, Ash, small. Left = word / char counts. Right = **Focus** toggle indicator, **Auto Save** indicator (Cobalt dot when active), sync/format icons.
- **Modals (palette / search / settings):** card `--bg`, radius lg–xl, shadow lg, 1px `--border`. Inputs borderless with `--border` underline + Cobalt focus. Rows hover/selected = `--accent-soft`; primary text Ink, hints Ash.
- **Buttons:** primary = Cobalt fill / white text / radius md; secondary = `--bg` + `--border`, Ink text, Cobalt border on hover; ghost = Ash text only.
- **Focus mode** (optional, pillar-driven): dims chrome to `--faint`, hides sidebar/tabs, centers content. (Net-new — schedule separately.)

---

## 8. Marketing application

- **Landing:** hero = large **Cobalt or Ink halftone sparkle** + **MICHROMA "RUNE"** wordmark + tagline; Paper background; generous whitespace; pillar row; product screenshot in a rounded-xl frame with shadow lg. Dot-field texture allowed as a faint background motif.
- **OG / ad image (1200×630):** Ink or Paper field; sparkle + wordmark locked left or centered; one line of value copy (Pretendard/Inter); Cobalt accent sparingly; keep a 64px safe margin.
- **Favicon set:** 16/32 = coarse halftone or solid sparkle (per §2.1); 180 apple-touch = dark fine halftone; maskable = solid sparkle on Ink, centered with safe zone.
- **Social avatar:** dark fine halftone, full-bleed.

---

## 9. Deliverables (asset checklist)

- **Vector logo set (SVG):** sparkle — fine-halftone, coarse-halftone, solid — in dark/light/cobalt; horizontal & stacked lockups.
- **App icon master:** 1024×1024 PNG (dark fine halftone) → `tauri icon` → all platform sizes (`src-tauri/icons/`).
- **Favicon set:** 16/32/180/maskable + `favicon.svg`.
- **OG template** (1200×630) + social avatar.
- **Fonts:** MICHROMA, IBM Plex Mono (bundle); Pretendard (already bundled); Inter (web only).
- **Token files:** `src/styles.css` CSS variables (§3.3); a shared `tokens` reference for web/landing.

---

## 10. Implementation handoff (app)

1. **Tokens** — replace `:root` / `[data-theme="dark"]` blocks in `src/styles.css` with §3.3. `editorTheme.ts` already reads the vars → inherits automatically.
2. **Fonts** — add `@fontsource/michroma`, `@fontsource/ibm-plex-mono`; keep Pretendard. `--mono` → `"IBM Plex Mono", "Pretendard Variable", ui-monospace, monospace`. Add `--display: "Michroma", var(--sans)` for the wordmark only.
3. **Logo** — production `sparkle.svg` set from the generator; inject horizontal lockup into the sidebar header and symbol into the top bar (`chrome.ts`).
4. **Chrome re-skin** — apply §7 region by region (radius/spacing/elevation/motion tokens).
5. **App icon** — regenerate `src-tauri/icons/` via `npm run tauri icon <master-1024.png>`.
6. **Net-new (separate plan):** Focus mode, sidebar search, document outline — not part of this re-skin.
