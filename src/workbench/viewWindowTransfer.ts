import type { Locale } from "../i18n/i18n";
import type { DockPayload, DockSurface, DockTarget, DockZone, LogicalRect } from "./dockTypes";
import type { WorkbenchContainerId, WorkbenchViewId } from "./workbenchLayout";
import type { ViewGroupLayoutNode, ViewGroupState } from "./viewGroupLayout";

export interface ViewWindowPresentation {
  theme: "light" | "dark";
  uiScale: number;
  locale: Locale;
}

export interface ViewWindowTransfer {
  version: 2;
  transferId: string;
  sourceWindowLabel: string;
  targetWindowLabel: string;
  groups: Array<{ containerId: WorkbenchContainerId; group: ViewGroupState }>;
  root: ViewGroupLayoutNode;
  activeGroupId: string;
  presentation: ViewWindowPresentation;
}

export const DOCK_PROTOCOL_EVENT = "rune:dock-protocol";

interface DockProtocolCommon {
  version: 2;
  sessionId: string;
  sourceWindowLabel: string;
}

export type DockProtocolMessage =
  | (DockProtocolCommon & { type: "dock:start"; payload: DockPayload; point: { x: number; y: number } })
  | (DockProtocolCommon & { type: "dock:surface"; surface: DockSurface })
  | (DockProtocolCommon & {
    type: "dock:preview";
    targetWindowLabel: string;
    payload: DockPayload;
    zone: DockZone | null;
    point: { x: number; y: number };
  })
  | (DockProtocolCommon & { type: "dock:commit"; target: DockTarget; revision: number })
  | (DockProtocolCommon & { type: "dock:result"; ok: boolean; revision: number; error: string | null })
  | (DockProtocolCommon & { type: "dock:cancel"; reason: string });

const viewIds = new Set<WorkbenchViewId>([
  "workspace", "outline", "tags", "project", "search", "backlinks", "properties", "references",
]);
const containerIds = new Set<WorkbenchContainerId>(["explorer", "search", "auxiliary", "panel"]);
const locales = new Set<Locale>(["en", "ko", "ja", "zh-Hans"]);
const labelPattern = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;
const sessionPattern = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function finitePoint(value: unknown): { x: number; y: number } | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["x", "y"])
    || typeof value.x !== "number" || !Number.isFinite(value.x)
    || typeof value.y !== "number" || !Number.isFinite(value.y)) return null;
  return { x: value.x, y: value.y };
}

function logicalRect(value: unknown): LogicalRect | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["left", "top", "width", "height"])) return null;
  const entries = [value.left, value.top, value.width, value.height];
  if (entries.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))
    || (value.width as number) < 0 || (value.height as number) < 0) return null;
  return { left: value.left as number, top: value.top as number, width: value.width as number, height: value.height as number };
}

function validGroupId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 160;
}

function normalizeDockLocation(value: unknown): DockPayload["source"] | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["windowLabel", "containerId", "groupId"])
    || typeof value.windowLabel !== "string" || !labelPattern.test(value.windowLabel)
    || !containerIds.has(value.containerId as WorkbenchContainerId) || !validGroupId(value.groupId)) return null;
  return {
    windowLabel: value.windowLabel,
    containerId: value.containerId as WorkbenchContainerId,
    groupId: value.groupId,
  };
}

function normalizeDockPayload(value: unknown): DockPayload | null {
  if (!isRecord(value) || (value.kind !== "view" && value.kind !== "group")) return null;
  const source = normalizeDockLocation(value.source);
  if (!source) return null;
  if (value.kind === "view") {
    if (!hasOnlyKeys(value, ["kind", "viewId", "source"])
      || typeof value.viewId !== "string" || !viewIds.has(value.viewId as WorkbenchViewId)) return null;
    return { kind: "view", viewId: value.viewId as WorkbenchViewId, source };
  }
  if (!hasOnlyKeys(value, ["kind", "viewIds", "activeViewId", "source"])
    || !Array.isArray(value.viewIds) || value.viewIds.length === 0
    || typeof value.activeViewId !== "string") return null;
  const normalized: WorkbenchViewId[] = [];
  for (const id of value.viewIds) {
    if (typeof id !== "string" || !viewIds.has(id as WorkbenchViewId) || normalized.includes(id as WorkbenchViewId)) return null;
    normalized.push(id as WorkbenchViewId);
  }
  if (!normalized.includes(value.activeViewId as WorkbenchViewId)) return null;
  return { kind: "group", viewIds: normalized, activeViewId: value.activeViewId as WorkbenchViewId, source };
}

function normalizeDockTarget(value: unknown): DockTarget | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  if (value.kind === "new-window") {
    if (!hasOnlyKeys(value, ["kind", "bounds"]) || !isRecord(value.bounds)
      || !hasOnlyKeys(value.bounds, ["x", "y", "width", "height"])) return null;
    const bounds = logicalRect({
      left: value.bounds.x,
      top: value.bounds.y,
      width: value.bounds.width,
      height: value.bounds.height,
    });
    return bounds && bounds.width >= 200 && bounds.height >= 120
      ? { kind: "new-window", bounds: { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height } }
      : null;
  }
  if (typeof value.windowLabel !== "string" || !labelPattern.test(value.windowLabel)
    || !containerIds.has(value.containerId as WorkbenchContainerId)) return null;
  const base = { windowLabel: value.windowLabel, containerId: value.containerId as WorkbenchContainerId };
  if (value.kind === "container") {
    if (!hasOnlyKeys(value, ["kind", "windowLabel", "containerId", "index"])
      || typeof value.index !== "number" || !Number.isInteger(value.index) || value.index < 0) return null;
    return { kind: "container", ...base, index: value.index };
  }
  if (!validGroupId(value.groupId)) return null;
  if (value.kind === "tabs") {
    if (!hasOnlyKeys(value, ["kind", "windowLabel", "containerId", "groupId", "index"])
      || typeof value.index !== "number" || !Number.isInteger(value.index) || value.index < 0) return null;
    return { kind: "tabs", ...base, groupId: value.groupId, index: value.index };
  }
  if (value.kind === "combine") {
    return hasOnlyKeys(value, ["kind", "windowLabel", "containerId", "groupId"])
      ? { kind: "combine", ...base, groupId: value.groupId }
      : null;
  }
  if (value.kind === "split") {
    if (!hasOnlyKeys(value, ["kind", "windowLabel", "containerId", "groupId", "direction", "side"])
      || (value.direction !== "row" && value.direction !== "column")
      || (value.side !== "before" && value.side !== "after")) return null;
    return { kind: "split", ...base, groupId: value.groupId, direction: value.direction, side: value.side };
  }
  return null;
}

function normalizeDockZone(value: unknown): DockZone | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["id", "rect", "target", "priority"])
    || typeof value.id !== "string" || !value.id || value.id.length > 256
    || typeof value.priority !== "number" || !Number.isFinite(value.priority)) return null;
  const rect = logicalRect(value.rect);
  const target = normalizeDockTarget(value.target);
  return rect && target ? { id: value.id, rect, target, priority: value.priority } : null;
}

function normalizeDockSurface(value: unknown): DockSurface | null {
  if (!isRecord(value) || !hasOnlyKeys(value, value.viewport === undefined
    ? ["windowLabel", "revision", "metrics", "zones"]
    : ["windowLabel", "revision", "metrics", "viewport", "zones"])
    || typeof value.windowLabel !== "string" || !labelPattern.test(value.windowLabel)
    || typeof value.revision !== "number" || !Number.isInteger(value.revision) || value.revision < 0
    || !isRecord(value.metrics) || !hasOnlyKeys(value.metrics, ["windowLabel", "windowInnerOrigin", "webviewOffset", "innerOrigin", "scaleFactor"])
    || value.metrics.windowLabel !== value.windowLabel
    || typeof value.metrics.scaleFactor !== "number" || !Number.isFinite(value.metrics.scaleFactor)
    || value.metrics.scaleFactor <= 0 || value.metrics.scaleFactor > 8
    || !Array.isArray(value.zones)) return null;
  const windowInnerOrigin = finitePoint(value.metrics.windowInnerOrigin);
  const webviewOffset = finitePoint(value.metrics.webviewOffset);
  const innerOrigin = finitePoint(value.metrics.innerOrigin);
  const viewport = value.viewport === undefined ? undefined : logicalRect(value.viewport);
  if (!windowInnerOrigin || !webviewOffset || !innerOrigin || (value.viewport !== undefined && !viewport)) return null;
  const zones: DockZone[] = [];
  const zoneIds = new Set<string>();
  for (const candidate of value.zones) {
    const zone = normalizeDockZone(candidate);
    if (!zone || zoneIds.has(zone.id) || (zone.target.kind !== "new-window" && zone.target.windowLabel !== value.windowLabel)) return null;
    zoneIds.add(zone.id);
    zones.push(zone);
  }
  return {
    windowLabel: value.windowLabel,
    revision: value.revision,
    metrics: {
      windowLabel: value.windowLabel,
      windowInnerOrigin,
      webviewOffset,
      innerOrigin,
      scaleFactor: value.metrics.scaleFactor,
    },
    ...(viewport ? { viewport } : {}),
    zones,
  };
}

export function normalizeDockProtocolMessage(
  value: unknown,
  expected?: { sessionId: string; sourceWindowLabel: string },
): DockProtocolMessage | null {
  if (!isRecord(value) || value.version !== 2 || typeof value.type !== "string"
    || typeof value.sessionId !== "string" || !sessionPattern.test(value.sessionId)
    || typeof value.sourceWindowLabel !== "string" || !labelPattern.test(value.sourceWindowLabel)
    || (expected && (value.sessionId !== expected.sessionId || value.sourceWindowLabel !== expected.sourceWindowLabel))) return null;
  const common = { version: 2 as const, sessionId: value.sessionId, sourceWindowLabel: value.sourceWindowLabel };
  if (value.type === "dock:start") {
    if (!hasOnlyKeys(value, ["type", "version", "sessionId", "sourceWindowLabel", "payload", "point"])) return null;
    const payload = normalizeDockPayload(value.payload);
    const point = finitePoint(value.point);
    return payload && point && payload.source.windowLabel === value.sourceWindowLabel
      ? { type: value.type, ...common, payload, point }
      : null;
  }
  if (value.type === "dock:surface") {
    if (!hasOnlyKeys(value, ["type", "version", "sessionId", "sourceWindowLabel", "surface"])) return null;
    const surface = normalizeDockSurface(value.surface);
    return surface && surface.windowLabel === value.sourceWindowLabel ? { type: value.type, ...common, surface } : null;
  }
  if (value.type === "dock:preview") {
    if (!hasOnlyKeys(value, ["type", "version", "sessionId", "sourceWindowLabel", "targetWindowLabel", "payload", "zone", "point"])
      || typeof value.targetWindowLabel !== "string" || !labelPattern.test(value.targetWindowLabel)) return null;
    const payload = normalizeDockPayload(value.payload);
    const zone = value.zone === null ? null : normalizeDockZone(value.zone);
    const point = finitePoint(value.point);
    return payload && point
      && (zone === null || (zone.target.kind !== "new-window" && zone.target.windowLabel === value.targetWindowLabel))
      ? { type: value.type, ...common, targetWindowLabel: value.targetWindowLabel, payload, zone, point }
      : null;
  }
  if (value.type === "dock:commit") {
    if (!hasOnlyKeys(value, ["type", "version", "sessionId", "sourceWindowLabel", "target", "revision"])
      || typeof value.revision !== "number" || !Number.isInteger(value.revision) || value.revision < 0) return null;
    const target = normalizeDockTarget(value.target);
    return target ? { type: value.type, ...common, target, revision: value.revision } : null;
  }
  if (value.type === "dock:result") {
    if (!hasOnlyKeys(value, ["type", "version", "sessionId", "sourceWindowLabel", "ok", "revision", "error"])
      || typeof value.ok !== "boolean" || typeof value.revision !== "number" || !Number.isInteger(value.revision) || value.revision < 0
      || (value.error !== null && (typeof value.error !== "string" || !value.error))) return null;
    return { type: value.type, ...common, ok: value.ok, revision: value.revision, error: value.error };
  }
  if (value.type === "dock:cancel") {
    if (!hasOnlyKeys(value, ["type", "version", "sessionId", "sourceWindowLabel", "reason"])
      || typeof value.reason !== "string" || !value.reason || value.reason.length > 128) return null;
    return { type: value.type, ...common, reason: value.reason };
  }
  return null;
}

export function normalizeViewWindowTransfer(value: unknown): ViewWindowTransfer | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "version", "transferId", "sourceWindowLabel", "targetWindowLabel", "groups", "root", "activeGroupId", "presentation",
  ]) || value.version !== 2 || typeof value.transferId !== "string" || !value.transferId
    || typeof value.sourceWindowLabel !== "string" || !labelPattern.test(value.sourceWindowLabel)
    || typeof value.targetWindowLabel !== "string" || !labelPattern.test(value.targetWindowLabel)
    || !Array.isArray(value.groups) || value.groups.length === 0 || value.groups.length > 64
    || typeof value.activeGroupId !== "string"
    || !isRecord(value.presentation) || !hasOnlyKeys(value.presentation, ["theme", "uiScale", "locale"])) return null;

  const groups: ViewWindowTransfer["groups"] = [];
  const groupIds = new Set<string>();
  const seenViews = new Set<WorkbenchViewId>();
  for (const candidate of value.groups) {
    if (!isRecord(candidate) || !hasOnlyKeys(candidate, ["containerId", "group"])
      || !containerIds.has(candidate.containerId as WorkbenchContainerId)
      || !isRecord(candidate.group) || !hasOnlyKeys(candidate.group, ["id", "viewIds", "activeViewId"])
      || typeof candidate.group.id !== "string" || !candidate.group.id || groupIds.has(candidate.group.id)
      || !Array.isArray(candidate.group.viewIds)) return null;
    const groupViewIds: WorkbenchViewId[] = [];
    for (const viewId of candidate.group.viewIds) {
      if (typeof viewId !== "string" || !viewIds.has(viewId as WorkbenchViewId)
        || seenViews.has(viewId as WorkbenchViewId)) return null;
      seenViews.add(viewId as WorkbenchViewId);
      groupViewIds.push(viewId as WorkbenchViewId);
    }
    if (groupViewIds.length === 0 || typeof candidate.group.activeViewId !== "string"
      || !groupViewIds.includes(candidate.group.activeViewId as WorkbenchViewId)) return null;
    groupIds.add(candidate.group.id);
    groups.push({
      containerId: candidate.containerId as WorkbenchContainerId,
      group: {
        id: candidate.group.id,
        viewIds: groupViewIds,
        activeViewId: candidate.group.activeViewId as WorkbenchViewId,
      },
    });
  }
  const orderedGroupIds: string[] = [];
  const parseTree = (candidate: unknown, seen: Set<object>): ViewGroupLayoutNode | null => {
    if (!isRecord(candidate) || seen.has(candidate)) return null;
    seen.add(candidate);
    if (candidate.type === "group") {
      if (!hasOnlyKeys(candidate, ["type", "groupId"]) || typeof candidate.groupId !== "string"
        || !groupIds.has(candidate.groupId) || orderedGroupIds.includes(candidate.groupId)) return null;
      orderedGroupIds.push(candidate.groupId);
      return { type: "group", groupId: candidate.groupId };
    }
    if (candidate.type !== "split" || !hasOnlyKeys(candidate, ["type", "direction", "children", "ratios"])
      || (candidate.direction !== "row" && candidate.direction !== "column") || !Array.isArray(candidate.children)
      || candidate.children.length < 2 || !Array.isArray(candidate.ratios) || candidate.ratios.length !== candidate.children.length
      || !candidate.ratios.every((ratio) => typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0)) return null;
    const children: ViewGroupLayoutNode[] = [];
    for (const child of candidate.children) {
      const parsed = parseTree(child, seen);
      if (!parsed) return null;
      children.push(parsed);
    }
    return { type: "split", direction: candidate.direction, children, ratios: [...candidate.ratios] as number[] };
  };
  const root = parseTree(value.root, new Set());
  if (!root || orderedGroupIds.length !== groups.length
    || orderedGroupIds.some((id, index) => id !== groups[index].group.id)
    || !groupIds.has(value.activeGroupId)
    || (value.presentation.theme !== "light" && value.presentation.theme !== "dark")
    || typeof value.presentation.uiScale !== "number" || !Number.isFinite(value.presentation.uiScale)
    || value.presentation.uiScale < 0.75 || value.presentation.uiScale > 2
    || !locales.has(value.presentation.locale as Locale)) return null;

  return {
    version: 2,
    transferId: value.transferId,
    sourceWindowLabel: value.sourceWindowLabel,
    targetWindowLabel: value.targetWindowLabel,
    groups,
    root,
    activeGroupId: value.activeGroupId,
    presentation: {
      theme: value.presentation.theme,
      uiScale: value.presentation.uiScale,
      locale: value.presentation.locale as Locale,
    },
  };
}
