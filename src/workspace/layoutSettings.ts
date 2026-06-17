export interface LayoutSettings {
  sidebarWidth: number | null;
  outlineHeight: number | null;
  splitRatio: number | null;
}

export interface ResolvedLayoutSettings {
  sidebarWidth: number;
  outlineHeight: number;
  splitRatio: number;
}

export const DEFAULT_LAYOUT: ResolvedLayoutSettings = {
  sidebarWidth: 240,
  outlineHeight: 220,
  splitRatio: 0.5,
};

export interface LayoutExport {
  version: 1;
  layout: ResolvedLayoutSettings;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasLayoutValue(value: Partial<LayoutSettings>): boolean {
  return finiteNumber(value.sidebarWidth) !== null
    || finiteNumber(value.outlineHeight) !== null
    || finiteNumber(value.splitRatio) !== null;
}

export function normalizeLayoutSettings(value: Partial<LayoutSettings> | null | undefined): ResolvedLayoutSettings {
  return {
    sidebarWidth: finiteNumber(value?.sidebarWidth) ?? DEFAULT_LAYOUT.sidebarWidth,
    outlineHeight: finiteNumber(value?.outlineHeight) ?? DEFAULT_LAYOUT.outlineHeight,
    splitRatio: finiteNumber(value?.splitRatio) ?? DEFAULT_LAYOUT.splitRatio,
  };
}

export function serializeLayoutSettings(value: Partial<LayoutSettings>): string {
  return JSON.stringify({ version: 1, layout: normalizeLayoutSettings(value) } satisfies LayoutExport, null, 2);
}

export function parseLayoutSettingsJson(text: string): ResolvedLayoutSettings | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const raw = record.layout && typeof record.layout === "object"
      ? record.layout as Partial<LayoutSettings>
      : record as Partial<LayoutSettings>;
    if (!hasLayoutValue(raw)) return null;
    return normalizeLayoutSettings(raw);
  } catch {
    return null;
  }
}
