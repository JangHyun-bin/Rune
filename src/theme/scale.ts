// UI scale + editor font scale: pure, clamped helpers. No DOM access.

export const UI_SCALE_STEPS = [0.8, 0.9, 1.0, 1.1, 1.25, 1.5] as const;
export const UI_SCALE_DEFAULT = 1.0;

/** Snap any value to the nearest allowed UI-scale step; non-finite → default. */
export function clampUiScale(value: number): number {
  if (!Number.isFinite(value)) return UI_SCALE_DEFAULT;
  let best: number = UI_SCALE_STEPS[0];
  for (const step of UI_SCALE_STEPS) {
    if (Math.abs(step - value) < Math.abs(best - value)) best = step;
  }
  return best;
}

export const EDITOR_FONT_MIN = 0.75;
export const EDITOR_FONT_MAX = 1.75;
export const EDITOR_FONT_DEFAULT = 1.0;
const EDITOR_FONT_STEP = 0.1;

/** Clamp editor font scale to [MIN, MAX]; non-finite → default. */
export function clampEditorFontScale(value: number): number {
  if (!Number.isFinite(value)) return EDITOR_FONT_DEFAULT;
  return Math.min(EDITOR_FONT_MAX, Math.max(EDITOR_FONT_MIN, value));
}

/** Step the editor font scale one increment in `dir` (+1/−1), rounded, clamped. */
export function stepEditorFontScale(current: number, dir: 1 | -1): number {
  const base = clampEditorFontScale(current);
  const next = Math.round((base + dir * EDITOR_FONT_STEP) * 100) / 100;
  return clampEditorFontScale(next);
}
