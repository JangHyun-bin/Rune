import type { Locale } from "../i18n/i18n";
import type { WorkbenchContainerId, WorkbenchViewId } from "./workbenchLayout";
import type { ViewGroupState } from "./viewGroupLayout";

export interface ViewWindowPresentation {
  theme: "light" | "dark";
  uiScale: number;
  locale: Locale;
}

export interface ViewWindowTransfer {
  version: 1;
  transferId: string;
  sourceWindowLabel: string;
  targetWindowLabel: string;
  sourceContainerId: WorkbenchContainerId;
  group: ViewGroupState;
  presentation: ViewWindowPresentation;
}

const viewIds = new Set<WorkbenchViewId>([
  "workspace", "outline", "tags", "project", "search", "backlinks", "properties", "references",
]);
const containerIds = new Set<WorkbenchContainerId>(["explorer", "search", "auxiliary", "panel"]);
const locales = new Set<Locale>(["en", "ko", "ja", "zh-Hans"]);
const labelPattern = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

export function normalizeViewWindowTransfer(value: unknown): ViewWindowTransfer | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "version", "transferId", "sourceWindowLabel", "targetWindowLabel", "sourceContainerId", "group", "presentation",
  ]) || value.version !== 1 || typeof value.transferId !== "string" || !value.transferId
    || typeof value.sourceWindowLabel !== "string" || !labelPattern.test(value.sourceWindowLabel)
    || typeof value.targetWindowLabel !== "string" || !labelPattern.test(value.targetWindowLabel)
    || !containerIds.has(value.sourceContainerId as WorkbenchContainerId)
    || !isRecord(value.group) || !hasOnlyKeys(value.group, ["id", "viewIds", "activeViewId"])
    || typeof value.group.id !== "string" || !value.group.id || !Array.isArray(value.group.viewIds)
    || !isRecord(value.presentation) || !hasOnlyKeys(value.presentation, ["theme", "uiScale", "locale"])) return null;

  const groupViewIds: WorkbenchViewId[] = [];
  for (const viewId of value.group.viewIds) {
    if (typeof viewId !== "string" || !viewIds.has(viewId as WorkbenchViewId) || groupViewIds.includes(viewId as WorkbenchViewId)) return null;
    groupViewIds.push(viewId as WorkbenchViewId);
  }
  if (groupViewIds.length === 0 || typeof value.group.activeViewId !== "string"
    || !groupViewIds.includes(value.group.activeViewId as WorkbenchViewId)
    || (value.presentation.theme !== "light" && value.presentation.theme !== "dark")
    || typeof value.presentation.uiScale !== "number" || !Number.isFinite(value.presentation.uiScale)
    || value.presentation.uiScale < 0.75 || value.presentation.uiScale > 2
    || !locales.has(value.presentation.locale as Locale)) return null;

  return {
    version: 1,
    transferId: value.transferId,
    sourceWindowLabel: value.sourceWindowLabel,
    targetWindowLabel: value.targetWindowLabel,
    sourceContainerId: value.sourceContainerId as WorkbenchContainerId,
    group: {
      id: value.group.id,
      viewIds: groupViewIds,
      activeViewId: value.group.activeViewId as WorkbenchViewId,
    },
    presentation: {
      theme: value.presentation.theme,
      uiScale: value.presentation.uiScale,
      locale: value.presentation.locale as Locale,
    },
  };
}
