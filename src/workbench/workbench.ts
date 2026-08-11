import {
  activateContainer as activateLayoutContainer,
  activateViewGroup as activateLayoutViewGroup,
  closeView as closeLayoutView,
  normalizeWorkbenchLayout,
  openView as openLayoutView,
  moveView as moveLayoutView,
  moveViewToWorkbenchGroup as moveLayoutViewToGroup,
  resetViewVisibility as resetLayoutViewVisibility,
  resetViewLocations as resetLayoutViewLocations,
  splitWorkbenchViewGroup as splitLayoutViewGroup,
  setPanelPosition as setLayoutPanelPosition,
  setPartSize,
  setPrimarySidebarPosition as setLayoutPrimarySidebarPosition,
  toggleViewCollapsed as toggleLayoutViewCollapsed,
  type WorkbenchContainerId,
  type WorkbenchLayoutSnapshot,
  type WorkbenchPartId,
  type WorkbenchViewId,
  type PanelPosition,
  type SidebarPosition,
} from "./workbenchLayout";
import { viewGroupIdForView, type ViewGroupLayoutNode, type ViewGroupSplitDirection } from "./viewGroupLayout";
import type { ViewContribution, ViewRegistry } from "./viewRegistry";
import { decodeViewDrag, encodeViewDrag, insertionIndex, VIEW_DRAG_TYPE } from "./viewDrop";
import { t } from "../i18n/i18n";
import { containerDockZone, groupDockZones, logicalRectForElement, tabDockZones } from "./dockGeometry";
import { createDockDragCoordinator, type DockDragCoordinator, type DockDragPreview } from "./dockDragSession";
import type { DockEffect, DockPayload, DockSurface, DockWorkspaceSnapshot } from "./dockTypes";
import { logicalClientPointToPhysicalScreen, type NativeDockWindowMetrics } from "./tauriDockDragAdapter";
import { EMPTY_VIEW_WINDOW_LAYOUT, type ViewWindowLayoutSnapshot } from "./viewWindowLayout";

export interface NativeDockingOptions {
  metrics(): Promise<NativeDockWindowMetrics>;
  registeredSurfaces?(): DockSurface[];
  workspace?(): { viewWindows: ViewWindowLayoutSnapshot; windowLabels?: string[] };
  requestNewWindow(payload: DockPayload, point: { x: number; y: number }): void | Promise<void>;
  commitEffects?(effects: DockEffect[], snapshot: DockWorkspaceSnapshot): void | Promise<void>;
}

export interface Workbench {
  snapshot(): WorkbenchLayoutSnapshot;
  restore(snapshot: WorkbenchLayoutSnapshot, options?: { emitChange?: boolean }): void;
  onDidChange(listener: (snapshot: WorkbenchLayoutSnapshot) => void): () => void;
  dockSurface(metrics: NativeDockWindowMetrics, revision: number): DockSurface;
  showDockPreview(preview: DockDragPreview | null): void;
  dockWorkspaceSnapshot(viewWindows: ViewWindowLayoutSnapshot, windowLabels?: string[]): DockWorkspaceSnapshot;
  commitDockWorkspaceSnapshot(snapshot: DockWorkspaceSnapshot): void;
  openView(id: WorkbenchViewId): void;
  closeView(id: WorkbenchViewId): void;
  toggleView(id: WorkbenchViewId): void;
  toggleViewCollapsed(id: WorkbenchViewId): void;
  togglePrimarySidebar(): void;
  moveView(viewId: WorkbenchViewId, containerId: WorkbenchContainerId, order?: number): void;
  moveViewToGroup(viewId: WorkbenchViewId, containerId: WorkbenchContainerId, groupId: string, order?: number): void;
  splitViewGroup(
    viewId: WorkbenchViewId,
    containerId: WorkbenchContainerId,
    targetGroupId: string,
    direction: ViewGroupSplitDirection,
    side: "before" | "after",
  ): void;
  setViewGroupDetached(containerId: WorkbenchContainerId, groupId: string, detached: boolean): void;
  togglePart(partId: WorkbenchPartId): void;
  setPrimarySidebarPosition(position: SidebarPosition): void;
  setPanelPosition(position: PanelPosition): void;
  resetViewLocations(): void;
  activateContainer(id: WorkbenchContainerId): void;
  resetViewVisibility(): void;
  setPrimarySidebarSize(size: number): void;
  reflow(options?: { emitChange?: boolean }): void;
  relabel(): void;
  destroy(): void;
}

interface ViewShell {
  section: HTMLElement;
  header: HTMLElement;
  title: HTMLElement;
  collapse: HTMLButtonElement;
  more: HTMLButtonElement;
  close: HTMLButtonElement;
  body: HTMLElement;
}

export function mountWorkbench(options: {
  activityBar: HTMLElement;
  primarySidebar: HTMLElement;
  primaryResizer: HTMLElement;
  secondarySidebar: HTMLElement;
  secondaryResizer: HTMLElement;
  panel: HTMLElement;
  panelResizer: HTMLElement;
  registry: ViewRegistry;
  initialState: WorkbenchLayoutSnapshot;
  focusEditor: () => void;
  onViewMenu?: (viewId: WorkbenchViewId, x: number, y: number) => void;
  nativeDocking?: NativeDockingOptions;
}): Workbench {
  let state = normalizeWorkbenchLayout(options.initialState);
  let destroyed = false;
  const changeListeners = new Set<(snapshot: WorkbenchLayoutSnapshot) => void>();
  const viewShells = new Map<WorkbenchViewId, ViewShell>();
  let primaryContainerTitlebar: HTMLElement | null = null;
  let outlineResizer: HTMLElement | null = null;
  let draggingHeader: HTMLElement | null = null;
  let draggingViewId: WorkbenchViewId | null = null;
  let groupIdSequence = 0;
  const detachedGroups = new Set<string>();
  const dropIndicators = new Set<HTMLElement>();
  const renderedGroups = new Map<string, { containerId: WorkbenchContainerId; groupId: string; element: HTMLElement }>();
  const renderedTabs = new Map<string, { containerId: WorkbenchContainerId; groupId: string; strip: HTMLElement; tabs: HTMLElement[] }>();
  const renderedContainers = new Map<WorkbenchContainerId, HTMLElement>();
  let dockRevision = 0;
  let dockMetrics: NativeDockWindowMetrics | null = null;
  let dockMetricsRequest: Promise<NativeDockWindowMetrics> | null = null;
  let dockDragCoordinator: DockDragCoordinator | null = null;
  let dockGhost: HTMLElement | null = null;
  let dockOverlay: HTMLElement | null = null;
  const OUTLINE_DEFAULT_SIZE = 220;
  const MIN_EDITOR_WIDTH = 220;
  const MIN_WORKSPACE_HEIGHT = 120;
  const ACTIVITY_BAR_FALLBACK_WIDTH = 48;
  const RESIZER_FALLBACK_SIZE = 6;
  const MIN_PART_WIDTH = 96;

  const measuredSize = (size: number, fallback: number): number =>
    Number.isFinite(size) && size > 0 ? size : fallback;

  const outerSize = (element: HTMLElement | null, dimension: "width" | "height", fallback: number): number => {
    if (!element) return fallback;
    const rectSize = element.getBoundingClientRect()[dimension];
    const offsetSize = dimension === "width" ? element.offsetWidth : element.offsetHeight;
    return measuredSize(rectSize, measuredSize(offsetSize, fallback));
  };

  const rootFontSize = (): number => {
    if (typeof getComputedStyle !== "function" || !document.documentElement) return 16;
    return measuredSize(Number.parseFloat(getComputedStyle(document.documentElement).fontSize), 16);
  };

  const workbenchWidth = (): number =>
    outerSize(
      options.primarySidebar.parentElement,
      "width",
      measuredSize(
        options.primarySidebar.parentElement?.clientWidth ?? 0,
        measuredSize(window.innerWidth, 1024),
      ),
    );

  const partHasVisibleView = (partId: WorkbenchPartId, value: WorkbenchLayoutSnapshot): boolean =>
    Object.values(value.views).some((view) => view.visible && value.containers[view.containerId].part === partId);

  const horizontalFit = (value = state): {
    primarySize: number;
    secondarySize: number;
    panelSize: number;
    primaryMax: number;
    hideSecondary: boolean;
    hidePanel: boolean;
  } => {
    const width = workbenchWidth();
    const activityWidth = outerSize(options.activityBar, "width", ACTIVITY_BAR_FALLBACK_WIDTH);
    const primaryResizerWidth = outerSize(options.primaryResizer, "width", RESIZER_FALLBACK_SIZE);
    const secondaryResizerWidth = outerSize(options.secondaryResizer, "width", RESIZER_FALLBACK_SIZE);
    const panelResizerWidth = outerSize(options.panelResizer, "width", RESIZER_FALLBACK_SIZE);
    const primaryRequested = value.parts.primarySidebar.visible;
    const secondaryRequested = value.parts.secondarySidebar.visible && partHasVisibleView("secondarySidebar", value);
    const panelRequested = value.positions.panel !== "bottom"
      && value.parts.panel.visible
      && partHasVisibleView("panel", value);
    const desiredPrimary = Math.min(720, Math.max(MIN_PART_WIDTH, value.parts.primarySidebar.size));
    let primarySize = primaryRequested ? desiredPrimary : 0;
    let secondarySize = Math.min(720, Math.max(MIN_PART_WIDTH, value.parts.secondarySidebar.size));
    let panelSize = Math.min(600, Math.max(MIN_PART_WIDTH, value.parts.panel.size));
    let hideSecondary = false;
    let hidePanel = false;
    let overflow = activityWidth + MIN_EDITOR_WIDTH
      + (primaryRequested ? primaryResizerWidth + primarySize : 0)
      + (secondaryRequested ? secondaryResizerWidth + secondarySize : 0)
      + (panelRequested ? panelResizerWidth + panelSize : 0)
      - width;
    const shrink = (size: number): number => {
      if (overflow <= 0) return size;
      const reduction = Math.min(overflow, size - MIN_PART_WIDTH);
      overflow -= reduction;
      return size - reduction;
    };
    if (secondaryRequested) secondarySize = shrink(secondarySize);
    if (panelRequested) panelSize = shrink(panelSize);
    if (primaryRequested) primarySize = shrink(primarySize);
    if (overflow > 0 && secondaryRequested) {
      hideSecondary = true;
      overflow -= secondarySize + secondaryResizerWidth;
    }
    if (overflow > 0 && panelRequested) {
      hidePanel = true;
      overflow -= panelSize + panelResizerWidth;
    }
    const primaryMax = Math.max(MIN_PART_WIDTH, Math.min(720,
      width - activityWidth - MIN_EDITOR_WIDTH
      - (primaryRequested ? primaryResizerWidth : 0)
      - (secondaryRequested && !hideSecondary ? secondaryResizerWidth + secondarySize : 0)
      - (panelRequested && !hidePanel ? panelResizerWidth + panelSize : 0),
    ));
    primarySize = primaryRequested ? Math.min(desiredPrimary, primaryMax) : 0;
    return { primarySize, secondarySize, panelSize, primaryMax, hideSecondary, hidePanel };
  };

  const outlineMax = (): number => {
    const sidebarHeight = outerSize(
      options.primarySidebar,
      "height",
      measuredSize(
        options.primarySidebar.clientHeight,
        measuredSize(
          options.primarySidebar.parentElement?.clientHeight ?? 0,
          measuredSize(window.innerHeight, 820),
        ),
      ),
    );
    const rem = rootFontSize();
    const chromeHeight = outerSize(primaryContainerTitlebar, "height", 2.125 * rem)
      + outerSize(viewShells.get("workspace")?.header ?? null, "height", 1.875 * rem)
      + outerSize(viewShells.get("outline")?.header ?? null, "height", 1.875 * rem)
      + outerSize(outlineResizer, "height", RESIZER_FALLBACK_SIZE);
    const available = Math.floor(sidebarHeight - MIN_WORKSPACE_HEIGHT - chromeHeight);
    return Math.max(64, Math.min(600, available));
  };

  const boundState = (value: WorkbenchLayoutSnapshot): WorkbenchLayoutSnapshot => {
    const next = normalizeWorkbenchLayout(value);
    next.views.outline.size = Math.min(next.views.outline.size ?? OUTLINE_DEFAULT_SIZE, outlineMax());
    return normalizeWorkbenchLayout(next);
  };

  const contributions = (): ViewContribution[] => options.registry.allViews();
  const groupKey = (containerId: WorkbenchContainerId, groupId: string): string => `${containerId}\0${groupId}`;

  const viewsIn = (containerId: WorkbenchContainerId): ViewContribution[] =>
    contributions()
      .filter((view) => state.views[view.id].containerId === containerId)
      .sort((a, b) => state.views[a.id].order - state.views[b.id].order || a.id.localeCompare(b.id));

  const createButton = (className: string, label: string, text: string): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.textContent = text;
    return button;
  };

  const clearViewDropIndicators = (clearDragging = true): void => {
    if (clearDragging) {
      draggingHeader?.classList.remove("view-dragging");
      draggingHeader = null;
      draggingViewId = null;
    }
    for (const indicator of dropIndicators) {
      indicator.parentElement?.classList.remove("view-drop-target");
      indicator.remove();
    }
    dropIndicators.clear();
  };
  const finishViewDrag = (): void => clearViewDropIndicators();

  const viewDockPayload = (viewId: WorkbenchViewId): DockPayload | null => {
    const containerId = state.views[viewId]?.containerId;
    if (!containerId) return null;
    const groupId = viewGroupIdForView(state.viewGroups[containerId], viewId);
    return groupId ? {
      kind: "view",
      viewId,
      source: { windowLabel: "main", containerId, groupId },
    } : null;
  };

  const groupDockPayload = (containerId: WorkbenchContainerId, groupId: string): DockPayload | null => {
    const group = state.viewGroups[containerId]?.groups[groupId];
    if (!group?.activeViewId || group.viewIds.length === 0) return null;
    return {
      kind: "group",
      viewIds: [...group.viewIds],
      activeViewId: group.activeViewId,
      source: { windowLabel: "main", containerId, groupId },
    };
  };

  const loadDockMetrics = (): Promise<NativeDockWindowMetrics> | null => {
    if (!options.nativeDocking) return null;
    if (!dockMetricsRequest) {
      dockMetricsRequest = options.nativeDocking.metrics().then((metrics) => {
        dockMetrics = metrics;
        return metrics;
      }).finally(() => { dockMetricsRequest = null; });
    }
    return dockMetricsRequest;
  };

  const bindDockPointer = (element: HTMLElement, payload: () => DockPayload | null): void => {
    element.draggable = false;
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target !== element && target?.closest?.("button, [role=button], input, select, textarea, a")) return;
      const nextPayload = payload();
      if (!nextPayload || !dockDragCoordinator?.begin({
        pointerId: event.pointerId,
        payload: nextPayload,
        client: { x: event.clientX, y: event.clientY },
      })) return;
      void loadDockMetrics()?.catch(() => { dockDragCoordinator?.cancel(); });
    });
  };

  const viewIdFromEvent = (event: DragEvent): WorkbenchViewId | null =>
    decodeViewDrag(event.dataTransfer?.getData(VIEW_DRAG_TYPE) ?? "");

  const openViewMenu = (viewId: WorkbenchViewId, anchor: HTMLElement, event: MouseEvent): void => {
    const rect = anchor.getBoundingClientRect();
    options.onViewMenu?.(viewId, event.clientX || rect.left, event.clientY || rect.bottom);
  };

  const bindViewDrag = (element: HTMLElement, viewId: WorkbenchViewId): void => {
    if (options.nativeDocking) {
      bindDockPointer(element, () => viewDockPayload(viewId));
      return;
    }
    element.draggable = decodeViewDrag(encodeViewDrag(viewId)) !== null;
    element.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData(VIEW_DRAG_TYPE, encodeViewDrag(viewId));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      draggingHeader = element;
      draggingViewId = viewId;
      element.classList.add("view-dragging");
    });
    element.addEventListener("dragend", finishViewDrag);
  };

  const bindDropTarget = (
    target: HTMLElement,
    containerId: WorkbenchContainerId,
    axis: "x" | "y",
    views: () => ViewContribution[],
    elementFor = (view: ViewContribution): HTMLElement | undefined => viewShells.get(view.id)?.header,
    onDrop = (viewId: WorkbenchViewId, order: number): void => workbench.moveView(viewId, containerId, order),
  ): void => {
    const rectsFor = (viewId: WorkbenchViewId | null): DOMRect[] =>
      views()
        .filter((view) => view.id !== viewId)
        .map((view) => elementFor(view)?.getBoundingClientRect() ?? null)
        .filter((rect): rect is DOMRect => rect !== null);
    const orderAt = (event: DragEvent, viewId: WorkbenchViewId | null): number => {
      const pointer = axis === "x" ? event.clientX : event.clientY;
      const midpoints = rectsFor(viewId).map((rect) =>
        axis === "x" ? rect.left + rect.width / 2 : rect.top + rect.height / 2);
      return insertionIndex(midpoints, pointer);
    };
    const boundaryAt = (order: number, viewId: WorkbenchViewId | null): number => {
      const rects = rectsFor(viewId);
      if (rects.length === 0) return axis === "x" ? target.scrollLeft : target.scrollTop;
      const boundary = order < rects.length
        ? (axis === "x" ? rects[order].left : rects[order].top)
        : (axis === "x" ? rects[rects.length - 1].right : rects[rects.length - 1].bottom);
      const targetRect = target.getBoundingClientRect();
      const targetStart = axis === "x" ? targetRect.left : targetRect.top;
      const scroll = axis === "x" ? target.scrollLeft : target.scrollTop;
      return Math.max(0, Math.round(boundary - targetStart + scroll));
    };
    const show = (order: number, viewId: WorkbenchViewId | null): void => {
      clearViewDropIndicators(false);
      const indicator = document.createElement("div");
      indicator.className = "view-drop-indicator";
      indicator.dataset.order = String(order);
      indicator.dataset.axis = axis;
      indicator.style.setProperty("--view-drop-offset", `${boundaryAt(order, viewId)}px`);
      target.classList.add("view-drop-target");
      target.appendChild(indicator);
      dropIndicators.add(indicator);
    };
    target.addEventListener("dragover", (event) => {
      if (!event.dataTransfer?.types.includes(VIEW_DRAG_TYPE)) return;
      event.preventDefault();
      event.stopPropagation?.();
      show(orderAt(event, draggingViewId), draggingViewId);
    });
    target.addEventListener("drop", (event) => {
      const viewId = viewIdFromEvent(event);
      if (viewId) {
        event.preventDefault();
        event.stopPropagation?.();
        onDrop(viewId, orderAt(event, viewId));
      }
      clearViewDropIndicators();
    });
  };

  const shellFor = (view: ViewContribution): ViewShell => {
    let shell = viewShells.get(view.id);
    if (shell) return shell;

    const section = document.createElement("section");
    section.className = "workbench-view";
    section.dataset.viewId = view.id;
    const header = document.createElement("header");
    header.className = "workbench-view-header";
    bindViewDrag(header, view.id);
    const collapse = createButton("view-collapse", `Toggle ${view.titleKey}`, "›");
    collapse.addEventListener("click", () => workbench.toggleViewCollapsed(view.id));
    const title = document.createElement("span");
    title.className = "view-title";
    const more = createButton("view-more view-close", `${t("workbench.moveView")} ${t(view.titleKey)}`, "...");
    more.addEventListener("click", (event) => openViewMenu(view.id, more, event));
    const close = createButton("view-close", `Close ${view.titleKey}`, "×");
    close.addEventListener("click", () => workbench.closeView(view.id));
    header.appendChild(collapse);
    header.appendChild(title);
    header.appendChild(close);
    header.appendChild(more);
    const body = document.createElement("div");
    body.className = "workbench-view-body";
    body.style.overflow = "auto";
    section.appendChild(header);
    section.appendChild(body);
    shell = { section, header, title, collapse, more, close, body };
    viewShells.set(view.id, shell);
    return shell;
  };

  const renderView = (view: ViewContribution, mountVisible = true, ignoreCollapsed = false): HTMLElement => {
    const layout = state.views[view.id];
    const shell = shellFor(view);
    const title = t(view.titleKey);
    const collapsed = layout.collapsed && !ignoreCollapsed;
    shell.title.textContent = title;
    shell.section.classList.toggle("hidden", !layout.visible);
    shell.section.classList.toggle("collapsed", collapsed);
    shell.collapse.setAttribute("aria-expanded", String(!collapsed));
    const collapseLabel = `${t(collapsed ? "view.expand" : "view.collapse")} ${title}`;
    shell.collapse.setAttribute("aria-label", collapseLabel);
    shell.collapse.title = collapseLabel;
    const closeLabel = `${t("view.close")} ${title}`;
    shell.close.setAttribute("aria-label", closeLabel);
    shell.close.title = closeLabel;
    const moreLabel = `${t("workbench.moveView")} ${title}`;
    shell.more.setAttribute("aria-label", moreLabel);
    shell.more.title = moreLabel;
    shell.body.classList.toggle("hidden", collapsed);
    if (view.id === "outline") {
      shell.section.style.setProperty("--outline-height", `${layout.size ?? OUTLINE_DEFAULT_SIZE}px`);
    }
    if (layout.visible && mountVisible) {
      const instance = options.registry.resolveView(view.id);
      shell.body.appendChild(instance.element);
    }
    return shell.section;
  };

  const renderViewGroup = (
    containerId: WorkbenchContainerId,
    groupId: string,
    visible: boolean,
    panelStyle: boolean,
  ): HTMLElement => {
    const group = state.viewGroups[containerId].groups[groupId];
    const views = group.viewIds.map((viewId) => contributions().find((view) => view.id === viewId)).filter((view): view is ViewContribution => Boolean(view));
    const visibleViews = views.filter((view) => state.views[view.id].visible);
    const activeViewId = visibleViews.some((view) => view.id === group.activeViewId) ? group.activeViewId : visibleViews[0]?.id ?? null;
    const wrapper = document.createElement("section");
    wrapper.className = "view-group";
    wrapper.dataset.groupId = groupId;
    wrapper.dataset.containerId = containerId;
    if (detachedGroups.has(groupKey(containerId, groupId))) {
      wrapper.classList.add("hidden");
      return wrapper;
    }
    renderedGroups.set(groupKey(containerId, groupId), { containerId, groupId, element: wrapper });

    const splitDrop = (event: DragEvent): void => {
      const viewId = viewIdFromEvent(event);
      if (!viewId) return;
      event.preventDefault();
      event.stopPropagation?.();
      const rect = wrapper.getBoundingClientRect();
      const x = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
      const y = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;
      const edges = [
        { distance: x, direction: "row" as const, side: "before" as const },
        { distance: 1 - x, direction: "row" as const, side: "after" as const },
        { distance: y, direction: "column" as const, side: "before" as const },
        { distance: 1 - y, direction: "column" as const, side: "after" as const },
      ].sort((a, b) => a.distance - b.distance);
      if (edges[0].distance < 0.25) {
        workbench.splitViewGroup(viewId, containerId, groupId, edges[0].direction, edges[0].side);
      } else {
        workbench.moveViewToGroup(viewId, containerId, groupId);
      }
      clearViewDropIndicators();
    };
    wrapper.addEventListener("dragover", (event) => {
      if (!event.dataTransfer?.types.includes(VIEW_DRAG_TYPE)) return;
      event.preventDefault();
      event.stopPropagation?.();
      wrapper.classList.add("view-group-drop-target");
    });
    wrapper.addEventListener("dragleave", () => wrapper.classList.remove("view-group-drop-target"));
    wrapper.addEventListener("drop", splitDrop);

    if (!panelStyle && views.length === 1) {
      wrapper.classList.add("single-view-group");
      wrapper.dataset.singleViewId = views[0].id;
      wrapper.classList.toggle("collapsed", state.views[views[0].id].collapsed);
      if (views[0].id === "outline") {
        const size = state.views.outline.size ?? OUTLINE_DEFAULT_SIZE;
        wrapper.style.setProperty("--outline-height", `${size}px`);
        const resizer = document.createElement("div");
        outlineResizer = resizer;
        resizer.className = "outline-view-resizer";
        resizer.dataset.resizesView = "outline";
        resizer.setAttribute("role", "separator");
        resizer.setAttribute("aria-orientation", "horizontal");
        resizer.setAttribute("aria-label", t("workbench.resizeOutline"));
        resizer.setAttribute("aria-valuemin", "64");
        resizer.setAttribute("aria-valuemax", String(outlineMax()));
        resizer.setAttribute("aria-valuenow", String(size));
        resizer.classList.toggle("hidden", !state.views.outline.visible || state.views.outline.collapsed);
        resizer.addEventListener("pointerdown", (event) => onOutlinePointerDown(resizer, event));
        wrapper.appendChild(resizer);
      }
      wrapper.appendChild(renderView(views[0], visible));
      return wrapper;
    }

    const tabs = document.createElement("div");
    tabs.className = panelStyle ? "panel-tabs" : "view-group-tabs";
    tabs.dataset.groupId = groupId;
    if (options.nativeDocking) {
      const groupHandle = createButton(
        `${panelStyle ? "panel" : "view-group"}-drag-handle view-group-drag-handle`,
        `${t("workbench.moveView")}: ${views.map((view) => t(view.titleKey)).join(", ")}`,
        "⠿",
      );
      groupHandle.dataset.groupId = groupId;
      bindDockPointer(groupHandle, () => groupDockPayload(containerId, groupId));
      tabs.appendChild(groupHandle);
    }
    const tabsByViewId = new Map<WorkbenchViewId, HTMLElement>();
    for (const view of visibleViews) {
      const item = document.createElement("div");
      item.className = panelStyle ? "panel-tab-item" : "view-group-tab-item";
      item.dataset.viewId = view.id;
      const tab = createButton(panelStyle ? "panel-tab" : "view-group-tab", t(view.titleKey), t(view.titleKey));
      tab.dataset.viewId = view.id;
      bindViewDrag(tab, view.id);
      tab.classList.toggle("active", view.id === activeViewId);
      tab.addEventListener("click", () => commit(activateLayoutViewGroup(state, containerId, groupId, view.id)));
      tab.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        openViewMenu(view.id, tab, event);
      });
      const close = createButton(panelStyle ? "panel-tab-close" : "view-group-tab-close", `${t("view.close")} ${t(view.titleKey)}`, "×");
      close.addEventListener("click", () => workbench.closeView(view.id));
      const more = createButton(panelStyle ? "panel-tab-more" : "view-group-tab-more", `${t("workbench.moveView")} ${t(view.titleKey)}`, "...");
      more.addEventListener("click", (event) => openViewMenu(view.id, more, event));
      item.appendChild(tab);
      item.appendChild(close);
      item.appendChild(more);
      tabsByViewId.set(view.id, item);
      tabs.appendChild(item);
    }
    renderedTabs.set(groupKey(containerId, groupId), {
      containerId,
      groupId,
      strip: tabs,
      tabs: [...tabsByViewId.values()],
    });
    bindDropTarget(
      tabs,
      containerId,
      "x",
      () => visibleViews,
      (view) => tabsByViewId.get(view.id),
      (viewId, order) => workbench.moveViewToGroup(viewId, containerId, groupId, order),
    );
    const body = document.createElement("div");
    body.className = panelStyle ? "panel-body" : "view-group-body";
    if (activeViewId) {
      const active = visibleViews.find((view) => view.id === activeViewId);
      if (active) body.appendChild(renderView(active, visible, true));
    }
    wrapper.appendChild(tabs);
    wrapper.appendChild(body);
    return wrapper;
  };

  const renderViewGroupTree = (
    containerId: WorkbenchContainerId,
    node: ViewGroupLayoutNode,
    visible: boolean,
    panelStyle: boolean,
  ): HTMLElement => {
    if (node.type === "group") return renderViewGroup(containerId, node.groupId, visible, panelStyle);
    const split = document.createElement("div");
    split.className = "view-group-split";
    split.dataset.direction = node.direction;
    node.children.forEach((child, index) => {
      const element = renderViewGroupTree(containerId, child, visible, panelStyle);
      element.style.setProperty("--view-group-ratio", String(node.ratios[index] ?? 1));
      split.appendChild(element);
    });
    return split;
  };

  const renderActivityBar = (): void => {
    const primaryContainers = options.registry.containers()
      .filter((container) => state.containers[container.id].part === "primarySidebar")
      .sort((a, b) => state.containers[a.id].order - state.containers[b.id].order || a.id.localeCompare(b.id));
    options.activityBar.replaceChildren(...primaryContainers.map((container) => {
      const button = createButton("activitybar-button", t(container.titleKey), container.icon);
      button.dataset.containerId = container.id;
      const active = state.parts.primarySidebar.activeContainerId === container.id;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active && state.parts.primarySidebar.visible));
      button.addEventListener("click", () => {
        if (active && state.parts.primarySidebar.visible) {
          workbench.togglePrimarySidebar();
        } else {
          workbench.activateContainer(container.id);
        }
      });
      return button;
    }));
  };

  const renderPrimarySidebar = (): void => {
    const part = state.parts.primarySidebar;
    const fit = horizontalFit();
    const maxSize = fit.primaryMax;
    outlineResizer = null;
    options.primarySidebar.classList.toggle("hidden", !part.visible);
    options.primaryResizer.classList.toggle("hidden", !part.visible);
    options.primarySidebar.setAttribute("aria-hidden", String(!part.visible));
    options.primarySidebar.style.setProperty("--primary-sidebar-width", `${fit.primarySize}px`);
    options.primaryResizer.setAttribute("aria-valuemin", "96");
    options.primaryResizer.setAttribute("aria-valuemax", String(maxSize));
    options.primaryResizer.setAttribute("aria-valuenow", String(fit.primarySize));

    const contribution = options.registry.containers().find((container) => container.id === part.activeContainerId);
    if (!contribution) {
      primaryContainerTitlebar = null;
      outlineResizer = null;
      options.primarySidebar.replaceChildren();
      return;
    }
    const views = viewsIn(contribution.id);
    const container = document.createElement("section");
    container.className = "view-container";
    container.dataset.containerId = contribution.id;
    const titlebar = document.createElement("header");
    titlebar.className = "view-container-titlebar";
    const title = document.createElement("h2");
    title.textContent = t(contribution.titleKey);
    titlebar.appendChild(title);
    for (const view of views.filter((candidate) => !state.views[candidate.id].visible)) {
      const viewTitle = t(view.titleKey);
      const restore = createButton("view-restore", `${t("view.open")} ${viewTitle}`, viewTitle);
      restore.dataset.viewId = view.id;
      restore.addEventListener("click", () => workbench.openView(view.id));
      titlebar.appendChild(restore);
    }
    const body = document.createElement("div");
    body.className = "view-container-body";
    body.replaceChildren(renderViewGroupTree(contribution.id, state.viewGroups[contribution.id].root, true, false));
    renderedContainers.set(contribution.id, body);
    bindDropTarget(body, contribution.id, "y", () => views.filter((view) => state.views[view.id].visible));
    container.appendChild(titlebar);
    container.appendChild(body);
    options.primarySidebar.replaceChildren(container);
    primaryContainerTitlebar = titlebar;
  };

  const renderPart = (
    partId: WorkbenchPartId,
    host: HTMLElement,
    resizer: HTMLElement,
    autoHidden = false,
    renderedSize = state.parts[partId].size,
  ): void => {
    const part = state.parts[partId];
    const contribution = options.registry.containers()
      .find((container) => container.id === part.activeContainerId);
    const views = contribution ? viewsIn(contribution.id) : [];
    const visible = !autoHidden && part.visible && views.some((view) => state.views[view.id].visible);
    host.dataset.partId = partId;
    resizer.dataset.partId = partId;
    host.classList.toggle("hidden", !visible);
    resizer.classList.toggle("hidden", !visible);
    host.setAttribute("aria-hidden", String(!visible));
    resizer.setAttribute("aria-valuemin", "96");
    resizer.setAttribute("aria-valuemax", String(partId === "panel" ? 600 : 720));
    resizer.setAttribute("aria-valuenow", String(renderedSize));
    if (!contribution) {
      host.replaceChildren();
      return;
    }
    const container = document.createElement("section");
    container.className = "view-container";
    container.dataset.partId = partId;
    container.dataset.containerId = contribution.id;
    if (partId === "panel") {
      container.appendChild(renderViewGroupTree(contribution.id, state.viewGroups[contribution.id].root, visible, true));
      renderedContainers.set(contribution.id, container);
      host.replaceChildren(container);
      return;
    }
    const titlebar = document.createElement("header");
    titlebar.className = "view-container-titlebar";
    const title = document.createElement("h2");
    title.textContent = t(contribution.titleKey);
    titlebar.appendChild(title);
    for (const view of views.filter((candidate) => !state.views[candidate.id].visible)) {
      const viewTitle = t(view.titleKey);
      const restore = createButton("view-restore", `${t("view.open")} ${viewTitle}`, viewTitle);
      restore.dataset.viewId = view.id;
      restore.addEventListener("click", () => workbench.openView(view.id));
      titlebar.appendChild(restore);
    }
    const body = document.createElement("div");
    body.className = "view-container-body";
    body.replaceChildren(renderViewGroupTree(contribution.id, state.viewGroups[contribution.id].root, visible, false));
    renderedContainers.set(contribution.id, body);
    bindDropTarget(body, contribution.id, "y", () => views.filter((view) => state.views[view.id].visible));
    container.appendChild(titlebar);
    container.appendChild(body);
    host.replaceChildren(container);
  };

  const renderOtherParts = (): void => {
    const fit = horizontalFit();
    options.secondarySidebar.style.setProperty("--secondary-sidebar-width", `${fit.secondarySize}px`);
    options.panel.style.setProperty("--panel-height", `${fit.panelSize}px`);
    options.panel.style.setProperty("--panel-width", `${fit.panelSize}px`);
    renderPart("secondarySidebar", options.secondarySidebar, options.secondaryResizer, fit.hideSecondary, fit.secondarySize);
    renderPart("panel", options.panel, options.panelResizer, fit.hidePanel, fit.panelSize);
  };

  const renderStructuralLabels = (): void => {
    options.activityBar.setAttribute("aria-label", t("workbench.activityBar"));
    options.primarySidebar.setAttribute("aria-label", t("workbench.primarySidebar"));
    options.primaryResizer.setAttribute("aria-label", t("workbench.resizePrimarySidebar"));
    options.secondarySidebar.setAttribute("aria-label", t("workbench.secondarySidebar"));
    options.secondaryResizer.setAttribute("aria-label", t("workbench.resizeSecondarySidebar"));
    options.panel.setAttribute("aria-label", t("workbench.panel"));
    options.panelResizer.setAttribute("aria-label", t("workbench.resizePanel"));
  };

  const render = (): void => {
    state = boundState(state);
    renderedGroups.clear();
    renderedTabs.clear();
    renderedContainers.clear();
    const body = options.activityBar.parentElement;
    body?.setAttribute("data-primary-sidebar-position", state.positions.primarySidebar);
    options.panel.parentElement?.setAttribute("data-panel-position", state.positions.panel);
    options.primaryResizer.setAttribute("aria-orientation", "vertical");
    options.secondaryResizer.setAttribute("aria-orientation", "vertical");
    options.panelResizer.setAttribute("aria-orientation", state.positions.panel === "bottom" ? "horizontal" : "vertical");
    renderStructuralLabels();
    renderActivityBar();
    renderPrimarySidebar();
    renderOtherParts();
  };

  const commit = (nextState: WorkbenchLayoutSnapshot, emitChange = true): void => {
    state = boundState(nextState);
    dockRevision += 1;
    render();
    if (!emitChange) return;
    const snapshot = normalizeWorkbenchLayout(state);
    for (const listener of changeListeners) listener(snapshot);
  };

  const workbench: Workbench = {
    snapshot: () => normalizeWorkbenchLayout(state),
    dockWorkspaceSnapshot: (viewWindows, windowLabels) => ({
      revision: dockRevision,
      workbench: normalizeWorkbenchLayout(state),
      viewWindows: structuredClone(viewWindows),
      ...(windowLabels ? { windowLabels: [...windowLabels] } : {}),
    }),
    commitDockWorkspaceSnapshot: (snapshot) => {
      state = boundState(snapshot.workbench);
      dockRevision = snapshot.revision;
      render();
      const next = normalizeWorkbenchLayout(state);
      for (const listener of changeListeners) listener(next);
    },
    dockSurface: (metrics, revision) => {
      const zones = [];
      for (const [containerId, element] of renderedContainers) {
        const rect = logicalRectForElement(element);
        if (rect) zones.push(containerDockZone(
          metrics.windowLabel,
          containerId,
          viewsIn(containerId).filter((view) => state.views[view.id].visible).length,
          rect,
        ));
      }
      for (const { containerId, groupId, element } of renderedGroups.values()) {
        const rect = logicalRectForElement(element);
        if (rect) zones.push(...groupDockZones(metrics.windowLabel, containerId, groupId, rect));
      }
      for (const { containerId, groupId, strip, tabs } of renderedTabs.values()) {
        const stripRect = logicalRectForElement(strip);
        if (!stripRect) continue;
        const tabRects = tabs.flatMap((tab) => {
          const rect = logicalRectForElement(tab);
          return rect ? [rect] : [];
        });
        zones.push(...tabDockZones(metrics.windowLabel, containerId, groupId, stripRect, tabRects));
      }
      return {
        windowLabel: metrics.windowLabel,
        revision,
        metrics,
        viewport: { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight },
        zones,
      };
    },
    showDockPreview: (preview) => renderDockPreview(preview),
    restore: (snapshot, restoreOptions) => commit(normalizeWorkbenchLayout(snapshot), restoreOptions?.emitChange !== false),
    onDidChange: (listener) => {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    openView: (id) => {
      commit(openLayoutView(state, id));
      options.registry.resolveView(id).focus?.();
    },
    closeView: (id) => {
      const ownedFocus = viewShells.get(id)?.section.contains(document.activeElement) ?? false;
      commit(closeLayoutView(state, id));
      if (ownedFocus) options.focusEditor();
    },
    toggleView: (id) => {
      const view = state.views[id];
      const part = state.parts[state.containers[view.containerId].part];
      if (view.visible && part.visible && part.activeContainerId === view.containerId) workbench.closeView(id);
      else workbench.openView(id);
    },
    toggleViewCollapsed: (id) => commit(toggleLayoutViewCollapsed(state, id)),
    togglePrimarySidebar: () => {
      const next = normalizeWorkbenchLayout(state);
      next.parts.primarySidebar.visible = !next.parts.primarySidebar.visible;
      commit(next);
    },
    moveView: (viewId, containerId, order) => commit(moveLayoutView(state, viewId, containerId, order)),
    moveViewToGroup: (viewId, containerId, groupId, order) => commit(moveLayoutViewToGroup(state, viewId, containerId, groupId, order)),
    splitViewGroup: (viewId, containerId, targetGroupId, direction, side) => {
      let newGroupId = `${containerId}:${viewId}:group-${++groupIdSequence}`;
      while (state.viewGroups[containerId].groups[newGroupId]) newGroupId = `${containerId}:${viewId}:group-${++groupIdSequence}`;
      commit(splitLayoutViewGroup(state, viewId, containerId, targetGroupId, newGroupId, direction, side));
    },
    setViewGroupDetached: (containerId, groupId, detached) => {
      const key = groupKey(containerId, groupId);
      if (detached) detachedGroups.add(key);
      else detachedGroups.delete(key);
      render();
    },
    togglePart: (partId) => {
      const next = normalizeWorkbenchLayout(state);
      next.parts[partId].visible = !next.parts[partId].visible;
      commit(next);
    },
    setPrimarySidebarPosition: (position) => commit(setLayoutPrimarySidebarPosition(state, position)),
    setPanelPosition: (position) => commit(setLayoutPanelPosition(state, position)),
    resetViewLocations: () => commit(resetLayoutViewLocations(state)),
    activateContainer: (id) => {
      commit(activateLayoutContainer(state, id));
      const view = viewsIn(id).find((candidate) => state.views[candidate.id].visible);
      if (view) options.registry.resolveView(view.id).focus?.();
    },
    resetViewVisibility: () => commit(resetLayoutViewVisibility(state)),
    setPrimarySidebarSize: (size) => commit(setPartSize(state, "primarySidebar", size)),
    reflow: (reflowOptions) => {
      const previousPrimary = state.parts.primarySidebar.size;
      const previousOutline = state.views.outline.size;
      const next = boundState(state);
      if (next.parts.primarySidebar.size !== previousPrimary || next.views.outline.size !== previousOutline) {
        if (reflowOptions?.emitChange === false) {
          state = next;
          render();
        } else {
          commit(next);
        }
      } else {
        render();
      }
    },
    relabel: () => {
      options.registry.relabel();
      render();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      changeListeners.clear();
      if (resizing) {
        moved = false;
        finishResize();
      }
      if (outlineResizing) {
        outlineMoved = false;
        finishOutlineResize();
      }
      options.primaryResizer.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      window.removeEventListener("blur", finishResize);
      disposePartResizers.forEach((dispose) => dispose());
      window.removeEventListener("pointermove", onOutlinePointerMove);
      window.removeEventListener("pointerup", finishOutlineResize);
      window.removeEventListener("pointercancel", finishOutlineResize);
      window.removeEventListener("blur", finishOutlineResize);
      if (options.nativeDocking) {
        window.removeEventListener("pointermove", onDockPointerMove);
        window.removeEventListener("pointerup", onDockPointerUp);
        window.removeEventListener("pointercancel", onDockPointerCancel);
        window.removeEventListener("keydown", onDockKeyDown);
        window.removeEventListener("blur", onDockPointerCancel);
        dockDragCoordinator?.cancel();
        clearDockPreview();
      } else {
        window.removeEventListener("blur", finishViewDrag);
      }
      finishViewDrag();
      window.removeEventListener("resize", onWindowResize);
      options.activityBar.replaceChildren();
      options.primarySidebar.replaceChildren();
      options.secondarySidebar.replaceChildren();
      options.panel.replaceChildren();
      options.registry.dispose();
    },
  };

  const clearDockPreview = (): void => {
    dockGhost?.remove();
    dockOverlay?.remove();
    dockGhost = null;
    dockOverlay = null;
    document.body.classList.remove("dock-drag-active");
  };

  const renderDockPreview = (preview: DockDragPreview | null): void => {
    clearDockPreview();
    if (!preview || !dockMetrics) return;
    const clientX = (preview.point.x - dockMetrics.innerOrigin.x) / dockMetrics.scaleFactor;
    const clientY = (preview.point.y - dockMetrics.innerOrigin.y) / dockMetrics.scaleFactor;
    dockGhost = document.createElement("div");
    dockGhost.className = "dock-drag-ghost";
    dockGhost.setAttribute("aria-hidden", "true");
    dockGhost.textContent = preview.payload.kind === "view"
      ? preview.payload.viewId
      : `${preview.payload.viewIds.length} views`;
    dockGhost.style.setProperty("--dock-drag-x", `${clientX}px`);
    dockGhost.style.setProperty("--dock-drag-y", `${clientY}px`);
    dockOverlay = document.createElement("div");
    dockOverlay.className = `dock-target-overlay dock-target-${preview.zone?.target.kind ?? "invalid"}`;
    dockOverlay.setAttribute("aria-hidden", "true");
    const targetIsLocal = preview.zone?.target.kind !== "new-window"
      && preview.zone?.target.windowLabel === dockMetrics.windowLabel;
    const rect = targetIsLocal && preview.zone
      ? preview.zone.rect
      : { left: clientX - 9, top: clientY - 9, width: 18, height: 18 };
    dockOverlay.style.setProperty("--dock-target-left", `${rect.left}px`);
    dockOverlay.style.setProperty("--dock-target-top", `${rect.top}px`);
    dockOverlay.style.setProperty("--dock-target-width", `${rect.width}px`);
    dockOverlay.style.setProperty("--dock-target-height", `${rect.height}px`);
    document.body.appendChild(dockGhost);
    document.body.appendChild(dockOverlay);
    document.body.classList.add("dock-drag-active");
  };

  if (options.nativeDocking) {
    dockDragCoordinator = createDockDragCoordinator({
      snapshot: () => {
        const workspace = options.nativeDocking?.workspace?.();
        return workbench.dockWorkspaceSnapshot(
          workspace?.viewWindows ?? EMPTY_VIEW_WINDOW_LAYOUT,
          workspace?.windowLabels,
        );
      },
      surfaces: () => dockMetrics ? [
        workbench.dockSurface(dockMetrics, dockRevision),
        ...(options.nativeDocking?.registeredSurfaces?.() ?? []),
      ] : [],
      preview: renderDockPreview,
      commit: async ({ snapshot, effects }) => {
        if (effects.length > 0 && !options.nativeDocking?.commitEffects) {
          throw new Error("Cross-window dock effects require the Task 6 transport");
        }
        await options.nativeDocking?.commitEffects?.(effects, snapshot);
        workbench.commitDockWorkspaceSnapshot(snapshot);
      },
      requestNewWindow: options.nativeDocking.requestNewWindow,
    });
  }

  const dockScreenPoint = (event: PointerEvent): { x: number; y: number } | null =>
    dockMetrics ? logicalClientPointToPhysicalScreen(dockMetrics, { x: event.clientX, y: event.clientY }) : null;
  const onDockPointerMove = (event: PointerEvent): void => {
    if (!dockDragCoordinator || !dockMetrics) return;
    dockDragCoordinator.move({
      pointerId: event.pointerId,
      client: { x: event.clientX, y: event.clientY },
      screen: dockScreenPoint(event)!,
    });
    if (dockDragCoordinator.state() === "dragging") event.preventDefault();
  };
  const onDockPointerUp = (event: PointerEvent): void => {
    if (!dockDragCoordinator) return;
    const point = dockScreenPoint(event);
    if (!point) {
      dockDragCoordinator.cancel();
      return;
    }
    const wasDragging = dockDragCoordinator.state() === "dragging";
    void dockDragCoordinator.drop({ pointerId: event.pointerId, screen: point });
    if (wasDragging) event.preventDefault();
  };
  const onDockPointerCancel = (): void => { dockDragCoordinator?.cancel(); };
  const onDockKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && dockDragCoordinator?.cancel()) event.preventDefault();
  };

  let resizing = false;
  let activePointerId: number | null = null;
  let startX = 0;
  let startSize = state.parts.primarySidebar.size;
  let liveSize = startSize;
  let moved = false;
  const finishResize = (): void => {
    if (!resizing) return;
    if (activePointerId !== null && options.primaryResizer.hasPointerCapture(activePointerId)) {
      options.primaryResizer.releasePointerCapture(activePointerId);
    }
    resizing = false;
    activePointerId = null;
    options.primaryResizer.classList.remove("dragging");
    document.body.classList.remove("resizing-sidebar");
    if (moved) commit(setPartSize(state, "primarySidebar", liveSize));
  };
  const onPointerMove = (event: PointerEvent): void => {
    if (!resizing) return;
    moved = true;
    liveSize = horizontalFit(
      setPartSize(state, "primarySidebar", startSize + event.clientX - startX),
    ).primarySize;
    options.primarySidebar.style.setProperty("--primary-sidebar-width", `${liveSize}px`);
    options.primaryResizer.setAttribute("aria-valuenow", String(liveSize));
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    resizing = true;
    activePointerId = event.pointerId;
    startX = event.clientX;
    startSize = horizontalFit().primarySize;
    liveSize = startSize;
    moved = false;
    options.primaryResizer.classList.add("dragging");
    document.body.classList.add("resizing-sidebar");
    try {
      options.primaryResizer.setPointerCapture(event.pointerId);
    } catch {
      activePointerId = null;
    }
    event.preventDefault();
  };

  const bindPartResize = (
    partId: "secondarySidebar" | "panel",
    handle: HTMLElement,
    config: () => {
      axis: "x" | "y";
      sizeProperty: "--secondary-sidebar-width" | "--panel-height" | "--panel-width";
      direction: number;
    },
  ): (() => void) => {
    let active = false;
    let pointerId: number | null = null;
    let start = 0;
    let startSize = state.parts[partId].size;
    let liveSize = startSize;
    let movedPart = false;
    let resizeConfig = config();
    const finish = (): void => {
      if (!active) return;
      if (pointerId !== null && handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      active = false;
      pointerId = null;
      handle.classList.remove("dragging");
      document.body.classList.remove("resizing-sidebar", "resizing-panel");
      if (movedPart) commit(setPartSize(state, partId, liveSize));
    };
    const move = (event: PointerEvent): void => {
      if (!active) return;
      movedPart = true;
      const position = resizeConfig.axis === "x" ? event.clientX : event.clientY;
      const next = setPartSize(state, partId, startSize + resizeConfig.direction * (position - start));
      const fit = horizontalFit(next);
      liveSize = partId === "secondarySidebar"
        ? fit.secondarySize
        : state.positions.panel === "bottom" ? next.parts.panel.size : fit.panelSize;
      (partId === "secondarySidebar" ? options.secondarySidebar : options.panel).style.setProperty(resizeConfig.sizeProperty, `${liveSize}px`);
      handle.setAttribute("aria-valuenow", String(liveSize));
    };
    const down = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      active = true;
      pointerId = event.pointerId;
      resizeConfig = config();
      start = resizeConfig.axis === "x" ? event.clientX : event.clientY;
      const fit = horizontalFit();
      startSize = partId === "secondarySidebar"
        ? fit.secondarySize
        : state.positions.panel === "bottom" ? state.parts.panel.size : fit.panelSize;
      liveSize = startSize;
      movedPart = false;
      handle.classList.add("dragging");
      document.body.classList.add(partId === "panel" ? "resizing-panel" : "resizing-sidebar");
      try { handle.setPointerCapture(event.pointerId); } catch { pointerId = null; }
      event.preventDefault();
    };
    handle.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
    return () => {
      handle.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
    };
  };

  const disposePartResizers = [
    bindPartResize("secondarySidebar", options.secondaryResizer, () => ({
      axis: "x", sizeProperty: "--secondary-sidebar-width", direction: state.positions.primarySidebar === "left" ? -1 : 1,
    })),
    bindPartResize("panel", options.panelResizer, () => state.positions.panel === "bottom"
      ? { axis: "y", sizeProperty: "--panel-height", direction: -1 }
      : { axis: "x", sizeProperty: "--panel-width", direction: state.positions.panel === "left" ? 1 : -1 }),
  ];

  let outlineResizing = false;
  let outlinePointerId: number | null = null;
  let outlineResizeHandle: HTMLElement | null = null;
  let outlineStartY = 0;
  let outlineStartSize = state.views.outline.size ?? OUTLINE_DEFAULT_SIZE;
  let outlineMoved = false;
  const finishOutlineResize = (): void => {
    if (!outlineResizing) return;
    if (outlineResizeHandle && outlinePointerId !== null && outlineResizeHandle.hasPointerCapture(outlinePointerId)) {
      outlineResizeHandle.releasePointerCapture(outlinePointerId);
    }
    outlineResizing = false;
    outlinePointerId = null;
    outlineResizeHandle?.classList.remove("dragging");
    outlineResizeHandle = null;
    document.body.classList.remove("resizing-outline");
    if (outlineMoved) commit(state);
  };
  const onOutlinePointerMove = (event: PointerEvent): void => {
    if (!outlineResizing) return;
    outlineMoved = true;
    const next = normalizeWorkbenchLayout(state);
    next.views.outline.size = outlineStartSize + outlineStartY - event.clientY;
    state = boundState(next);
    const size = state.views.outline.size ?? OUTLINE_DEFAULT_SIZE;
    viewShells.get("outline")?.section.style.setProperty("--outline-height", `${size}px`);
    viewShells.get("outline")?.section.parentElement?.style.setProperty("--outline-height", `${size}px`);
    outlineResizeHandle?.setAttribute("aria-valuenow", String(size));
  };
  const onOutlinePointerDown = (handle: HTMLElement, event: PointerEvent): void => {
    if (event.button !== 0) return;
    outlineResizing = true;
    outlinePointerId = event.pointerId;
    outlineResizeHandle = handle;
    outlineStartY = event.clientY;
    outlineStartSize = state.views.outline.size ?? OUTLINE_DEFAULT_SIZE;
    outlineMoved = false;
    handle.classList.add("dragging");
    document.body.classList.add("resizing-outline");
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      outlinePointerId = null;
    }
    event.preventDefault();
  };

  const onWindowResize = (): void => {
    workbench.reflow();
  };

  options.primaryResizer.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", finishResize);
  window.addEventListener("pointercancel", finishResize);
  window.addEventListener("blur", finishResize);
  window.addEventListener("pointermove", onOutlinePointerMove);
  window.addEventListener("pointerup", finishOutlineResize);
  window.addEventListener("pointercancel", finishOutlineResize);
  window.addEventListener("blur", finishOutlineResize);
  if (options.nativeDocking) {
    window.addEventListener("pointermove", onDockPointerMove);
    window.addEventListener("pointerup", onDockPointerUp);
    window.addEventListener("pointercancel", onDockPointerCancel);
    window.addEventListener("keydown", onDockKeyDown);
    window.addEventListener("blur", onDockPointerCancel);
  } else {
    window.addEventListener("blur", finishViewDrag);
  }
  window.addEventListener("resize", onWindowResize);
  render();
  return workbench;
}
