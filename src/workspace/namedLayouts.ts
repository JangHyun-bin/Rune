import type { EditorMode } from "../editor/editor";
import {
  DEFAULT_WORKBENCH_LAYOUT,
  activateContainer,
  isMigratableWorkbenchLayout,
  normalizeWorkbenchLayout,
  type WorkbenchLayoutSnapshot,
} from "../workbench/workbenchLayout";
import {
  DEFAULT_LAYOUT,
  normalizeLayoutSettings,
  type ResolvedLayoutSettings,
} from "./layoutSettings";
import {
  parsePaneWorkspaceSnapshot,
  type PaneWorkspaceSnapshot,
} from "./panePersistence";

export type BuiltInLayoutId = "writing" | "research" | "review";

export interface NamedLayoutState {
  workbenchLayout: WorkbenchLayoutSnapshot;
  layout: ResolvedLayoutSettings;
  editorWidth: "readable" | "wide";
  editorMode: EditorMode;
  paneLayout?: PaneWorkspaceSnapshot;
}

export interface SavedNamedLayout extends NamedLayoutState {
  version: 1;
  name: string;
}

export interface NamedLayoutChoice {
  value: string;
  builtIn: boolean;
  name: string;
}

export function createBuiltInLayout(id: BuiltInLayoutId): NamedLayoutState {
  const workbenchLayout = id === "research"
    ? activateContainer(DEFAULT_WORKBENCH_LAYOUT, "search")
    : normalizeWorkbenchLayout(DEFAULT_WORKBENCH_LAYOUT);
  return {
    workbenchLayout,
    layout: { ...DEFAULT_LAYOUT },
    editorWidth: id === "writing" ? "readable" : "wide",
    editorMode: id === "writing" ? "preview" : "split",
  };
}

export function captureNamedLayout(
  name: string,
  state: NamedLayoutState,
  includeTabs: boolean,
): SavedNamedLayout | null {
  const trimmedName = name.trim();
  if (!trimmedName) return null;
  const saved: SavedNamedLayout = {
    version: 1,
    name: trimmedName,
    workbenchLayout: normalizeWorkbenchLayout(state.workbenchLayout),
    layout: { ...state.layout },
    editorWidth: state.editorWidth,
    editorMode: state.editorMode,
  };
  if (includeTabs && state.paneLayout) saved.paneLayout = structuredClone(state.paneLayout);
  return saved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function normalizeSavedLayouts(value: unknown): SavedNamedLayout[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): SavedNamedLayout[] => {
    if (!isRecord(candidate) || candidate.version !== 1) return [];
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    if (!name || !isMigratableWorkbenchLayout(candidate.workbenchLayout) || !isRecord(candidate.layout)) return [];
    if (!isFiniteNumber(candidate.layout.sidebarWidth)
      || !isFiniteNumber(candidate.layout.outlineHeight)
      || !isFiniteNumber(candidate.layout.splitRatio)) return [];
    if (candidate.editorWidth !== "readable" && candidate.editorWidth !== "wide") return [];
    if (candidate.editorMode !== "preview" && candidate.editorMode !== "source" && candidate.editorMode !== "split") return [];
    const saved: SavedNamedLayout = {
      version: 1,
      name,
      workbenchLayout: normalizeWorkbenchLayout(candidate.workbenchLayout),
      layout: normalizeLayoutSettings(candidate.layout),
      editorWidth: candidate.editorWidth,
      editorMode: candidate.editorMode,
    };
    const paneLayout = parsePaneWorkspaceSnapshot(candidate.paneLayout);
    if (paneLayout) saved.paneLayout = paneLayout;
    return [saved];
  });
}

export function upsertSavedLayout(
  layouts: readonly SavedNamedLayout[],
  replacement: SavedNamedLayout,
): SavedNamedLayout[] {
  const index = layouts.findIndex((layout) => layout.name.toLowerCase() === replacement.name.toLowerCase());
  if (index < 0) return [...layouts, replacement];
  return layouts.map((layout, current) => current === index ? replacement : layout);
}

export function deleteSavedLayout(
  layouts: readonly SavedNamedLayout[],
  name: string,
): SavedNamedLayout[] {
  const target = name.toLowerCase();
  return layouts.filter((layout) => layout.name.toLowerCase() !== target);
}

export function namedLayoutChoices(layouts: readonly SavedNamedLayout[]): NamedLayoutChoice[] {
  const builtIns: BuiltInLayoutId[] = ["writing", "research", "review"];
  return [
    ...builtIns.map((name) => ({ value: `builtin:${name}`, builtIn: true, name })),
    ...layouts.map(({ name }) => ({ value: `saved:${name}`, builtIn: false, name })),
  ];
}

export function resolveNamedLayout(
  value: string,
  layouts: readonly SavedNamedLayout[],
): NamedLayoutState | null {
  if (value.startsWith("builtin:")) {
    const id = value.slice("builtin:".length);
    return id === "writing" || id === "research" || id === "review"
      ? createBuiltInLayout(id)
      : null;
  }
  if (!value.startsWith("saved:")) return null;
  const name = value.slice("saved:".length);
  return layouts.find((layout) => layout.name === name) ?? null;
}

export function selectedNamedLayoutValue(
  choices: readonly NamedLayoutChoice[],
  active: string | null,
): string {
  return choices.some((choice) => choice.value === active)
    ? active!
    : (choices[0]?.value ?? "");
}
