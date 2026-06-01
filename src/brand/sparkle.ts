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

/** Inline SVG string for the solid sparkle. Uses currentColor so CSS controls the tint.
 *  The embedded path always uses the default sparklePath geometry (cx=12,cy=12,R=11,f=0.15),
 *  matched to the fixed viewBox="0 0 24 24"; `size` only scales the rendered pixel size. */
export function sparkleSvg(size = 24, color = "currentColor"): string {
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">` +
    `<path d="${sparklePath()}" fill="${color}"/></svg>`
  );
}
