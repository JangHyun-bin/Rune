import type { DockSurface, DockZone, LogicalRect, PhysicalRect } from "./dockTypes";
import type { NativeDockWindowMetrics } from "./tauriDockDragAdapter";
import type { WorkbenchContainerId } from "./workbenchLayout";

export function logicalRectForElement(element: HTMLElement): LogicalRect | null {
  if (element.hidden || element.getAttribute("aria-hidden") === "true" || element.classList?.contains("hidden")) return null;
  const rect = element.getBoundingClientRect();
  if (![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

export function toPhysicalScreenRect(rect: LogicalRect, metrics: NativeDockWindowMetrics): PhysicalRect {
  const left = Math.round(metrics.innerOrigin.x + rect.left * metrics.scaleFactor);
  const top = Math.round(metrics.innerOrigin.y + rect.top * metrics.scaleFactor);
  const right = Math.round(metrics.innerOrigin.x + (rect.left + rect.width) * metrics.scaleFactor);
  const bottom = Math.round(metrics.innerOrigin.y + (rect.top + rect.height) * metrics.scaleFactor);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

function contains(rect: PhysicalRect, point: { x: number; y: number }): boolean {
  return rect.width > 0 && rect.height > 0
    && point.x >= rect.x && point.x < rect.x + rect.width
    && point.y >= rect.y && point.y < rect.y + rect.height;
}

export function hitDockZone(surface: DockSurface, point: { x: number; y: number }): DockZone | null {
  const matches = surface.zones.filter((zone) =>
    zone.rect.width > 0 && zone.rect.height > 0 && contains(toPhysicalScreenRect(zone.rect, surface.metrics), point));
  matches.sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  return matches[0] ?? null;
}

export function groupDockZones(
  windowLabel: string,
  containerId: WorkbenchContainerId,
  groupId: string,
  rect: LogicalRect,
  includeSplitEdges = true,
): DockZone[] {
  const zones: DockZone[] = [{
    id: `group:${containerId}:${groupId}:center`,
    rect,
    target: { kind: "combine", windowLabel, containerId, groupId },
    priority: 10,
  }];
  if (!includeSplitEdges) return zones;
  const edgeWidth = rect.width * 0.25;
  const edgeHeight = rect.height * 0.25;
  zones.push(
    {
      id: `group:${containerId}:${groupId}:left`,
      rect: { ...rect, width: edgeWidth },
      target: { kind: "split", windowLabel, containerId, groupId, direction: "row", side: "before" },
      priority: 20,
    },
    {
      id: `group:${containerId}:${groupId}:right`,
      rect: { left: rect.left + rect.width - edgeWidth, top: rect.top, width: edgeWidth, height: rect.height },
      target: { kind: "split", windowLabel, containerId, groupId, direction: "row", side: "after" },
      priority: 20,
    },
    {
      id: `group:${containerId}:${groupId}:top`,
      rect: { ...rect, height: edgeHeight },
      target: { kind: "split", windowLabel, containerId, groupId, direction: "column", side: "before" },
      priority: 20,
    },
    {
      id: `group:${containerId}:${groupId}:bottom`,
      rect: { left: rect.left, top: rect.top + rect.height - edgeHeight, width: rect.width, height: edgeHeight },
      target: { kind: "split", windowLabel, containerId, groupId, direction: "column", side: "after" },
      priority: 20,
    },
  );
  return zones;
}

export function tabDockZones(
  windowLabel: string,
  containerId: WorkbenchContainerId,
  groupId: string,
  strip: LogicalRect,
  tabs: LogicalRect[],
): DockZone[] {
  const ordered = [...tabs].sort((left, right) => left.left - right.left || left.top - right.top);
  const boundaries = [
    strip.left,
    ...ordered.map((tab) => Math.max(strip.left, Math.min(strip.left + strip.width, tab.left + tab.width / 2))),
    strip.left + strip.width,
  ];
  return boundaries.slice(0, -1).flatMap((left, index) => {
    const width = boundaries[index + 1] - left;
    return width > 0 ? [{
      id: `tabs:${containerId}:${groupId}:${index}`,
      rect: { left, top: strip.top, width, height: strip.height },
      target: { kind: "tabs" as const, windowLabel, containerId, groupId, index },
      priority: 30,
    }] : [];
  });
}

export function containerDockZone(
  windowLabel: string,
  containerId: WorkbenchContainerId,
  index: number,
  rect: LogicalRect,
): DockZone {
  return {
    id: `container:${containerId}`,
    rect,
    target: { kind: "container", windowLabel, containerId, index },
    priority: 1,
  };
}

export function measureDetachedDockSurface(options: {
  windowLabel: string;
  revision: number;
  metrics: NativeDockWindowMetrics;
  containerId: WorkbenchContainerId;
  groupId: string;
  groupElement: HTMLElement;
  tabStrip: HTMLElement;
  tabElements: HTMLElement[];
  includeSplitEdges?: boolean;
}): DockSurface {
  const zones: DockZone[] = [];
  const groupRect = logicalRectForElement(options.groupElement);
  if (groupRect) zones.push(...groupDockZones(
    options.windowLabel,
    options.containerId,
    options.groupId,
    groupRect,
    options.includeSplitEdges ?? false,
  ));
  const stripRect = logicalRectForElement(options.tabStrip);
  if (stripRect) {
    const tabRects = options.tabElements.flatMap((element) => {
      const rect = logicalRectForElement(element);
      return rect ? [rect] : [];
    });
    zones.push(...tabDockZones(options.windowLabel, options.containerId, options.groupId, stripRect, tabRects));
  }
  return {
    windowLabel: options.windowLabel,
    revision: options.revision,
    metrics: options.metrics,
    zones,
  };
}

export function measureDetachedDockTreeSurface(options: {
  windowLabel: string;
  revision: number;
  metrics: NativeDockWindowMetrics;
  groups: Array<{
    containerId: WorkbenchContainerId;
    groupId: string;
    groupElement: HTMLElement;
    tabStrip: HTMLElement;
    tabElements: HTMLElement[];
  }>;
}): DockSurface {
  return {
    windowLabel: options.windowLabel,
    revision: options.revision,
    metrics: options.metrics,
    zones: options.groups.flatMap((group) => measureDetachedDockSurface({
      ...group,
      windowLabel: options.windowLabel,
      revision: options.revision,
      metrics: options.metrics,
      includeSplitEdges: true,
    }).zones),
  };
}

export async function publishDetachedDockSurface(options: {
  windowLabel: string;
  revision: number;
  metrics: () => Promise<NativeDockWindowMetrics>;
  containerId: WorkbenchContainerId;
  groupId: string;
  groupElement: HTMLElement;
  tabStrip: HTMLElement;
  tabElements: HTMLElement[];
  publish: (surface: DockSurface) => void | Promise<void>;
}): Promise<DockSurface> {
  const surface = measureDetachedDockSurface({
    ...options,
    metrics: await options.metrics(),
  });
  await options.publish(surface);
  return surface;
}
