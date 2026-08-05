import { isMigratableWorkbenchLayout, normalizeWorkbenchLayout, type WorkbenchLayoutSnapshot } from "../workbench/workbenchLayout";

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

export interface LayoutExportV2 {
  version: 2;
  layout: ResolvedLayoutSettings;
  workbench: WorkbenchLayoutSnapshot;
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

export function normalizePersistedWorkbenchLayout(
  workbenchLayout: unknown,
  layout: Partial<LayoutSettings> | null | undefined,
  sidebarWidth: number | null | undefined,
): WorkbenchLayoutSnapshot {
  return normalizeWorkbenchLayout(workbenchLayout, {
    sidebarWidth: layout?.sidebarWidth ?? sidebarWidth,
    outlineHeight: layout?.outlineHeight,
  });
}

export function createSettingsSaveScheduler(save: () => void, delay: number) {
  let enabled = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const saveNow = (): void => {
    if (!enabled) {
      pending = true;
      return;
    }
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pending = false;
    save();
  };
  const schedule = (): void => {
    if (!enabled) {
      pending = true;
      return;
    }
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      save();
    }, delay);
  };

  return {
    schedule,
    saveNow,
    enable(flushPending = true): void {
      enabled = true;
      if (pending && flushPending) saveNow();
      else pending = false;
    },
  };
}

export function serializeLayoutSettings(
  value: Partial<LayoutSettings>,
  workbench: WorkbenchLayoutSnapshot,
): string {
  return JSON.stringify({
    version: 2,
    layout: normalizeLayoutSettings(value),
    workbench: normalizeWorkbenchLayout(workbench),
  } satisfies LayoutExportV2, null, 2);
}

export function parseLayoutSettingsJson(text: string): {
  layout: ResolvedLayoutSettings;
  workbench: WorkbenchLayoutSnapshot | null;
} | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if ("version" in record && record.version !== 1 && record.version !== 2) return null;
    if (record.version === 2) {
      if (!record.layout || !hasLayoutValue(record.layout as Partial<LayoutSettings>) || !isMigratableWorkbenchLayout(record.workbench)) return null;
      return {
        layout: normalizeLayoutSettings(record.layout as Partial<LayoutSettings>),
        workbench: normalizeWorkbenchLayout(record.workbench),
      };
    }
    const raw = record.layout && typeof record.layout === "object"
      ? record.layout as Partial<LayoutSettings>
      : record as Partial<LayoutSettings>;
    if (!hasLayoutValue(raw)) return null;
    return { layout: normalizeLayoutSettings(raw), workbench: null };
  } catch {
    return null;
  }
}
