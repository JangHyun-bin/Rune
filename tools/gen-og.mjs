// Generates the social/OG card for the Rune landing (1200x630) and writes it to
// the landing repo's public/og.png. Reuses this app's resvg + Michroma font.
// Run from the app repo:  node tools/gen-og.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const MICHROMA = "node_modules/@fontsource/michroma/files/michroma-latin-400-normal.woff2";
const OUT_DIR = "D:/HB/Rhizome/rune-landing/public";
const OUT = OUT_DIR + "/og.png";

const W = 1200, H = 630;
const INK = "#0D0F12", PAPER = "#FAF8F6", COBALT = "#3D74F0", ASH = "#8A909C";

// 4-point concave sparkle (matches the brand mark geometry)
const spark = (cx, cy, r) => {
  const k = r * 0.15;
  return `M ${cx},${cy - r} Q ${cx + k},${cy - k} ${cx + r},${cy} Q ${cx + k},${cy + k} ${cx},${cy + r} `
       + `Q ${cx - k},${cy + k} ${cx - r},${cy} Q ${cx - k},${cy - k} ${cx},${cy - r} Z`;
};

// faint cobalt halftone sparkle motif, bleeding off the right edge
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

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${INK}"/>
  <defs><clipPath id="cl"><path d="${spark(CX, CY, R)}"/></clipPath></defs>
  <g clip-path="url(#cl)" opacity="0.9">${dots}</g>

  <path d="${spark(96, 110, 24)}" fill="${COBALT}"/>
  <text x="138" y="124" font-family="Michroma" font-size="54" letter-spacing="6" fill="${PAPER}">RUNE</text>

  <text x="78" y="296" font-family="Segoe UI, Arial, sans-serif" font-size="74" font-weight="700" fill="${PAPER}">Write without</text>
  <text x="78" y="380" font-family="Segoe UI, Arial, sans-serif" font-size="74" font-weight="700" fill="${PAPER}">the noise.</text>

  <text x="80" y="452" font-family="Segoe UI, Arial, sans-serif" font-size="30" fill="${ASH}">Markdown, rendered as you type — code, diagrams &amp; math, live.</text>

  <text x="80" y="556" font-family="Segoe UI, Arial, sans-serif" font-size="24" font-weight="600" fill="${COBALT}">Free &amp; open source · macOS · Windows · Linux</text>
</svg>`;

const png = new Resvg(svg, {
  fitTo: { mode: "width", value: W },
  font: { fontFiles: [MICHROMA], loadSystemFonts: true, defaultFontFamily: "Segoe UI" },
}).render().asPng();

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, png);
console.log("wrote", OUT, png.length, "bytes");
