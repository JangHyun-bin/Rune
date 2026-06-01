import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brandDir = join(root, "src/assets/brand");
const outDir = join(root, "tools/.out");
const publicDir = join(root, "public");
mkdirSync(brandDir, { recursive: true });
mkdirSync(outDir, { recursive: true });
mkdirSync(publicDir, { recursive: true });

const C = 1024, CX = 512, CY = 512;

// 1024-space sparkle (large assets)
function sp(R = 350, f = 0.15) {
  const k = R * f;
  return `M ${CX},${CY - R} Q ${CX + k},${CY - k} ${CX + R},${CY} Q ${CX + k},${CY + k} ${CX},${CY + R} `
       + `Q ${CX - k},${CY + k} ${CX - R},${CY} Q ${CX - k},${CY - k} ${CX},${CY - R} Z`;
}
// Inlined copy of src/brand/sparkle.ts -> sparklePath() (24-space). KEEP IN SYNC: the favicon must match the in-app mark.
function sparklePath(cx = 12, cy = 12, R = 11, f = 0.15) {
  const k = R * f;
  return `M ${cx},${cy - R} Q ${cx + k},${cy - k} ${cx + R},${cy} Q ${cx + k},${cy + k} ${cx},${cy + R} `
       + `Q ${cx - k},${cy + k} ${cx - R},${cy} Q ${cx - k},${cy - k} ${cx},${cy - R} Z`;
}
function solid({ bg, fg }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${C}" height="${C}" viewBox="0 0 ${C} ${C}">`
       + `<rect width="${C}" height="${C}" rx="220" fill="${bg}"/><path d="${sp()}" fill="${fg}"/></svg>`;
}
function halftone({ bg, dot, R = 400, cell = 14 }) {
  const maxr = cell * 0.64;
  let c = "";
  for (let y = cell / 2; y < C; y += cell) for (let x = cell / 2; x < C; x += cell) {
    const r = Math.hypot(x - CX, y - CY);
    const inten = Math.pow(Math.max(0, 1 - r / (R * 1.05)), 0.62);
    const rad = maxr * inten;
    if (rad > 0.5) c += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad.toFixed(1)}" fill="${dot}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${C}" height="${C}" viewBox="0 0 ${C} ${C}">`
       + `<defs><clipPath id="cl"><path d="${sp(R)}"/></clipPath></defs>`
       + `<rect width="${C}" height="${C}" rx="220" fill="${bg}"/><g clip-path="url(#cl)">${c}</g></svg>`;
}
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${sparklePath()}" fill="#0D0F12"/></svg>`;

const assets = {
  "sparkle-solid.svg": solid({ bg: "#0D0F12", fg: "#FAF8F6" }),
  "sparkle-halftone-dark.svg": halftone({ bg: "#0D0F12", dot: "#FAF8F6" }),
  "sparkle-halftone-light.svg": halftone({ bg: "#FAF8F6", dot: "#0D0F12" }),
  "sparkle-halftone-cobalt.svg": halftone({ bg: "#0D0F12", dot: "#3D74F0" }),
};
for (const [name, svg] of Object.entries(assets)) writeFileSync(join(brandDir, name), svg);
writeFileSync(join(publicDir, "favicon.svg"), favicon);
writeFileSync(join(outDir, "rune-icon-1024.png"),
  new Resvg(assets["sparkle-halftone-dark.svg"], { fitTo: { mode: "width", value: 1024 } }).render().asPng());
console.log("brand assets written:", Object.keys(assets).length + 2, "files");
