// Generates an animated "renders as you type" demo of the Rune editor as a PNG
// frame sequence (resvg). ffmpeg then assembles MP4 + GIF (see the bash step).
// A designed motion graphic of the behaviour (not a screen recording).
//   node tools/gen-demo.mjs
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

const DIR = "D:/HB/Rhizome/.demo-frames";
try { rmSync(DIR, { recursive: true, force: true }); } catch {}
mkdirSync(DIR, { recursive: true });

const W = 1280, H = 720;
const PAPER = "#ECEAE7", SURF = "#FFFFFF", INK = "#0D0F12", ASH = "#6B717A",
      STONE = "#D7DBDF", RULE = "#E4E7EA", COBALT = "#114ADB", SOFT = "#E7EDFB", MUTE = "#6B717A";
const MONO = "Consolas, 'Courier New', monospace";
const SANS = "'Segoe UI', Arial, sans-serif";
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sparkle = (cx, cy, r) => { const k = r * 0.15; return `M ${cx},${cy - r} Q ${cx + k},${cy - k} ${cx + r},${cy} Q ${cx + k},${cy + k} ${cx},${cy + r} Q ${cx - k},${cy + k} ${cx - r},${cy} Q ${cx - k},${cy - k} ${cx},${cy - r} Z`; };

// document: each line has a raw form (what you type) + a renderer (committed look)
const X0 = 196, W0 = 888;            // content left + width (inside the card)
const lines = [
  { slot: 70, raw: "# On craft", render: (y) => `<text x="${X0}" y="${y + 40}" font-family="${SANS}" font-size="40" font-weight="700" fill="${INK}" letter-spacing="-0.5">On craft</text>` },
  { slot: 50, raw: "Write with **clarity**, not noise.", render: (y) => `<text x="${X0}" y="${y + 30}" font-family="${SANS}" font-size="22" fill="${INK}">Write with <tspan font-weight="700">clarity</tspan>, not noise.</text>` },
  { slot: 44, raw: "- It renders as you type.", render: (y) => `<text x="${X0 + 4}" y="${y + 28}" font-family="${SANS}" font-size="22" fill="${COBALT}">•</text><text x="${X0 + 30}" y="${y + 28}" font-family="${SANS}" font-size="22" fill="${INK}">It renders as you type.</text>` },
  { slot: 60, raw: "> Quiet by default.", render: (y) => `<rect x="${X0}" y="${y + 6}" width="3" height="34" fill="${STONE}"/><text x="${X0 + 18}" y="${y + 32}" font-family="${SANS}" font-size="22" font-style="italic" fill="${MUTE}">Quiet by default.</text>` },
];
const slotY = (i) => 172 + lines.slice(0, i).reduce((a, l) => a + l.slot, 0);

function activeLine(y, slot, text, caretOn) {
  const t = esc(text);
  const caretX = X0 + 2 + t.length * 9.6; // approx mono advance at 16px
  return `<rect x="${X0 - 16}" y="${y + 2}" width="${W0 + 24}" height="${slot - 6}" rx="5" fill="${SOFT}"/>`
       + `<rect x="${X0 - 16}" y="${y + 2}" width="3" height="${slot - 6}" fill="${COBALT}"/>`
       + `<text x="${X0}" y="${y + slot / 2 + 6}" font-family="${MONO}" font-size="16" fill="${INK}">${t}</text>`
       + (caretOn ? `<rect x="${caretX.toFixed(1)}" y="${y + slot / 2 - 8}" width="2" height="20" fill="${COBALT}"/>` : "");
}

function frame(committed, active, typed, fi) {
  let body = "";
  for (let i = 0; i < lines.length; i++) {
    const y = slotY(i);
    if (committed[i]) body += lines[i].render(y);
    else if (i === active) body += activeLine(y, lines[i].slot, lines[i].raw.slice(0, typed), (fi % 14) < 8);
  }
  const wc = committed.filter(Boolean).length === lines.length;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect width="${W}" height="${H}" fill="${PAPER}"/>`
    + `<rect x="140" y="80" width="1000" height="560" rx="16" fill="${SURF}" stroke="${STONE}" stroke-width="1"/>`
    + `<rect x="140" y="80" width="1000" height="46" rx="16" fill="#FAF8F6"/><rect x="140" y="110" width="1000" height="16" fill="#FAF8F6"/>`
    + `<line x1="140" y1="126" x2="1140" y2="126" stroke="${RULE}" stroke-width="1"/>`
    + `<path d="${sparkle(174, 103, 9)}" fill="${COBALT}"/>`
    + `<text x="192" y="108" font-family="${SANS}" font-size="13" fill="${ASH}">on-craft.md</text>`
    + `<text x="1086" y="108" font-family="${SANS}" font-size="12" fill="${wc ? COBALT : ASH}">${wc ? "Auto Save" : "•"}</text>`
    + body
    + `</svg>`;
}

// build the frame timeline
const specs = [];
const committed = [false, false, false, false];
let fi = 0;
const snap = (active, typed) => { specs.push({ committed: committed.slice(), active, typed, fi: fi++ }); };
for (let i = 0; i < lines.length; i++) {
  const raw = lines[i].raw;
  for (let c = 1; c <= raw.length; c++) snap(i, c);   // type
  for (let h = 0; h < 7; h++) snap(i, raw.length);     // hold raw
  committed[i] = true;
  for (let h = 0; h < 5; h++) snap(-1, 0);             // settle after commit
}
for (let h = 0; h < 36; h++) snap(-1, 0);              // final hold

specs.forEach((s, idx) => {
  const svg = frame(s.committed, s.active, s.typed, s.fi);
  const png = new Resvg(svg, { fitTo: { mode: "width", value: W }, font: { loadSystemFonts: true, defaultFontFamily: "Segoe UI" } }).render().asPng();
  writeFileSync(`${DIR}/f${String(idx).padStart(4, "0")}.png`, png);
});
console.log("frames:", specs.length, "->", DIR);
