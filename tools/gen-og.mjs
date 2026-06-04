// Generates the social/OG cards for the Rune landing (1200x630) — English
// (og.png) and Korean (og.ko.png) — and writes them to the landing repo's
// public/. Reuses this app's resvg + Michroma (wordmark) + Pretendard (body/CJK).
//   node tools/gen-og.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const FONTS = [
  "node_modules/@fontsource/michroma/files/michroma-latin-400-normal.woff2",
  "node_modules/pretendard/dist/public/static/Pretendard-Regular.otf",
  "node_modules/pretendard/dist/public/static/Pretendard-SemiBold.otf",
  "node_modules/pretendard/dist/public/static/Pretendard-Bold.otf",
];
const OUT_DIR = "D:/HB/Rhizome/rune-landing/public";

const W = 1200, H = 630;
const INK = "#0D0F12", PAPER = "#FAF8F6", COBALT = "#3D74F0", ASH = "#8A909C";
const PRET = "Pretendard, 'Segoe UI', sans-serif";

const spark = (cx, cy, r) => { const k = r * 0.15; return `M ${cx},${cy - r} Q ${cx + k},${cy - k} ${cx + r},${cy} Q ${cx + k},${cy + k} ${cx},${cy + r} Q ${cx - k},${cy + k} ${cx - r},${cy} Q ${cx - k},${cy - k} ${cx},${cy - r} Z`; };

// faint cobalt halftone sparkle motif, bleeding off the right edge (lang-independent)
const CX = 1050, CY = 315, R = 300, cell = 15, maxr = cell * 0.62;
let dots = "";
for (let y = cell / 2; y < H; y += cell) {
  for (let x = 540; x < W + cell; x += cell) {
    const d = Math.hypot(x - CX, y - CY);
    const inten = Math.pow(Math.max(0, 1 - d / (R * 1.05)), 0.62);
    const rad = maxr * inten;
    if (rad > 0.5) dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad.toFixed(1)}" fill="${COBALT}"/>`;
  }
}

const COPY = {
  en: {
    h: ["Write without", "the noise."],
    sub: "Markdown, rendered as you type — code, diagrams &amp; math, live.",
    feat: "Free &amp; open source · macOS · Windows · Linux",
  },
  ko: {
    h: ["소음 없이,", "쓰는 일에만."],
    sub: "입력하는 대로 렌더링 — 코드·다이어그램·수식까지.",
    feat: "무료 · 오픈소스 · macOS · Windows · Linux",
  },
};

function card(lang) {
  const c = COPY[lang];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${INK}"/>
  <defs><clipPath id="cl"><path d="${spark(CX, CY, R)}"/></clipPath></defs>
  <g clip-path="url(#cl)" opacity="0.9">${dots}</g>

  <path d="${spark(96, 110, 24)}" fill="${COBALT}"/>
  <text x="138" y="124" font-family="Michroma" font-size="54" letter-spacing="6" fill="${PAPER}">RUNE</text>

  <text x="78" y="296" font-family="${PRET}" font-size="74" font-weight="700" fill="${PAPER}">${c.h[0]}</text>
  <text x="78" y="380" font-family="${PRET}" font-size="74" font-weight="700" fill="${PAPER}">${c.h[1]}</text>

  <text x="80" y="452" font-family="${PRET}" font-size="30" fill="${ASH}">${c.sub}</text>

  <text x="80" y="556" font-family="${PRET}" font-size="24" font-weight="600" fill="${COBALT}">${c.feat}</text>
</svg>`;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [lang, file] of [["en", "og.png"], ["ko", "og.ko.png"]]) {
  const png = new Resvg(card(lang), {
    fitTo: { mode: "width", value: W },
    font: { fontFiles: FONTS, loadSystemFonts: true, defaultFontFamily: "Pretendard" },
  }).render().asPng();
  writeFileSync(`${OUT_DIR}/${file}`, png);
  console.log("wrote", `${OUT_DIR}/${file}`, png.length, "bytes");
}
