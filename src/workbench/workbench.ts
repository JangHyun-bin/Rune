import {
  activateContainer as activateLayoutContainer,
  closeView as closeLayoutView,
  normalizeWorkbenchLayout,
  openView as openLayoutView,
  resetViewVisibility as resetLayoutViewVisibility,
  setPartSize,
  toggleViewCollapsed as toggleLayoutViewCollapsed,
  type WorkbenchContainerId,
  type WorkbenchLayoutSnapshot,
  type WorkbenchViewId,
} from "./workbenchLayout";
import type { ViewContribution, ViewRegistry } from "./viewRegistry";
import { t } from "../i18n/i18n";

export interface Workbench {
  snapshot(): WorkbenchLayoutSnapshot;
  restore(snapshot: WorkbenchLayoutSnapshot): void;
  openView(id: WorkbenchViewId): void;
  closeView(id: WorkbenchViewId): void;
  toggleView(id: WorkbenchViewId): void;
  toggleViewCollapsed(id: WorkbenchViewId): void;
  togglePrimarySidebar(): void;
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
  onDidChange: (snapshot: WorkbenchLayoutSnapshot) => void;
}): Workbench {
  let state = normalizeWorkbenchLayout(options.initialState);
  let destroyed = false;
  const viewShells = new Map<WorkbenchViewId, ViewShell>();
  let primaryContainerTitlebar: HTMLElement | null = null;
  let outlineResizer: HTMLElement | null = null;
  const OUTLINE_DEFAULT_SIZE = 220;
  const MIN_EDITOR_WIDTH = 220;
  const MIN_WORKSPACE_HEIGHT = 120;
  const ACTIVITY_BAR_FALLBACK_WIDTH = 48;
  const RESIZER_FALLBACK_SIZE = 6;

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

  const primarySidebarMax = (): number => {
    const rootWidth = outerSize(
      options.primarySidebar.parentElement,
      "width",
      measuredSize(
        options.primarySidebar.parentElement?.clientWidth ?? 0,
        measuredSize(window.innerWidth, 1024),
      ),
    );
    const activityBarWidth = outerSize(options.activityBar, "width", ACTIVITY_BAR_FALLBACK_WIDTH);
    const primaryResizerWidth = outerSize(options.primaryResizer, "width", RESIZER_FALLBACK_SIZE);
    const secondaryWidth = state.parts.secondarySidebar.visible
      ? outerSize(options.secondarySidebar, "width", state.parts.secondarySidebar.size)
        + outerSize(options.secondaryResizer, "width", RESIZER_FALLBACK_SIZE)
      : 0;
    const available = Math.floor(
      rootWidth - activityBarWidth - primaryResizerWidth - secondaryWidth - MIN_EDITOR_WIDTH,
    );
    return Math.max(96, Math.min(720, available));
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
    next.parts.primarySidebar.size = Math.min(next.parts.primarySidebar.size, primarySidebarMax());
    next.views.outline.size = Math.min(next.views.outline.size ?? OUTLINE_DEFAULT_SIZE, outlineMax());
    return normalizeWorkbenchLayout(next);
  };

  const contributions = (): ViewContribution[] => {
    const values = new Map<WorkbenchViewId, ViewContribution>();
    for (const container of options.registry.containers()) {
      for (const view of options.registry.views(container.id)) values.set(view.id, view);
    }
    return [...values.values()];
  };

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

  const shellFor = (view: ViewContribution): ViewShell => {
    let shell = viewShells.get(view.id);
    if (shell) return shell;

    const section = document.createElement("section");
    section.className = "workbench-view";
    section.dataset.viewId = view.id;
    const header = document.createElement("header");
    header.className = "workbench-view-header";
    const collapse = createButton("view-collapse", `Toggle ${view.titleKey}`, "›");
    collapse.addEventListener("click", () => workbench.toggleViewCollapsed(view.id));
    const title = document.createElement("span");
    title.className = "view-title";
    const close = createButton("view-close", `Close ${view.titleKey}`, "×");
    close.addEventListener("click", () => workbench.closeView(view.id));
    header.appendChild(collapse);
    header.appendChild(title);
    header.appendChild(close);
    const body = document.createElement("div");
    body.className = "workbench-view-body";
    body.style.overflow = "auto";
    section.appendChild(header);
    section.appendChild(body);
    shell = { section, header, title, collapse, close, body };
    viewShells.set(view.id, shell);
    return shell;
  };

  const renderView = (view: ViewContribution, mountVisible = true): HTMLElement => {
    const layout = state.views[view.id];
    const shell = shellFor(view);
    const title = t(view.titleKey);
    shell.title.textContent = title;
    shell.section.classList.toggle("hidden", !layout.visible);
    shell.section.classList.toggle("collapsed", layout.collapsed);
    shell.collapse.setAttribute("aria-expanded", String(!layout.collapsed));
    const collapseLabel = `${t(layout.collapsed ? "view.expand" : "view.collapse")} ${title}`;
    shell.collapse.setAttribute("aria-label", collapseLabel);
    shell.collapse.title = collapseLabel;
    const closeLabel = `${t("view.close")} ${title}`;
    shell.close.setAttribute("aria-label", closeLabel);
    shell.close.title = closeLabel;
    shell.body.classList.toggle("hidden", layout.collapsed);
    if (view.id === "outline") {
      shell.section.style.setProperty("--outline-height", `${layout.size ?? OUTLINE_DEFAULT_SIZE}px`);
    }
    if (layout.visible && mountVisible) {
      const instance = options.registry.resolveView(view.id);
      shell.body.appendChild(instance.element);
    }
    return shell.section;
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
    const maxSize = primarySidebarMax();
    let renderedOutlineResizer: HTMLElement | null = null;
    options.primarySidebar.classList.toggle("hidden", !part.visible);
    options.primaryResizer.classList.toggle("hidden", !part.visible);
    options.primarySidebar.setAttribute("aria-hidden", String(!part.visible));
    options.primarySidebar.style.setProperty("--primary-sidebar-width", `${part.size}px`);
    options.primaryResizer.setAttribute("aria-valuemin", "96");
    options.primaryResizer.setAttribute("aria-valuemax", String(maxSize));
    options.primaryResizer.setAttribute("aria-valuenow", String(part.size));

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
    const children: HTMLElement[] = [];
    for (const view of views) {
      if (view.id === "outline") {
        const size = state.views.outline.size ?? OUTLINE_DEFAULT_SIZE;
        const resizer = document.createElement("div");
        renderedOutlineResizer = resizer;
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
        children.push(resizer);
      }
      children.push(renderView(view));
    }
    body.replaceChildren(...children);
    container.appendChild(titlebar);
    container.appendChild(body);
    options.primarySidebar.replaceChildren(container);
    primaryContainerTitlebar = titlebar;
    outlineResizer = renderedOutlineResizer;
  };

  const renderContainerPart = (partId: "secondarySidebar" | "panel", host: HTMLElement): void => {
    const contribution = options.registry.containers()
      .find((container) => container.id === state.parts[partId].activeContainerId);
    if (!contribution) {
      host.replaceChildren();
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
    body.replaceChildren(...views.map((view) => renderView(view, state.parts[partId].visible)));
    container.appendChild(titlebar);
    container.appendChild(body);
    host.replaceChildren(container);
  };

  const renderOtherParts = (): void => {
    const secondaryVisible = state.parts.secondarySidebar.visible;
    options.secondarySidebar.classList.toggle("hidden", !secondaryVisible);
    options.secondaryResizer.classList.toggle("hidden", !secondaryVisible);
    options.secondarySidebar.setAttribute("aria-hidden", String(!secondaryVisible));
    options.secondarySidebar.style.setProperty("--secondary-sidebar-width", `${state.parts.secondarySidebar.size}px`);
    renderContainerPart("secondarySidebar", options.secondarySidebar);
    const panelVisible = state.parts.panel.visible;
    options.panel.classList.toggle("hidden", !panelVisible);
    options.panelResizer.classList.toggle("hidden", !panelVisible);
    options.panel.setAttribute("aria-hidden", String(!panelVisible));
    options.panel.style.setProperty("--panel-height", `${state.parts.panel.size}px`);
    renderContainerPart("panel", options.panel);
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
    renderStructuralLabels();
    renderActivityBar();
    renderPrimarySidebar();
    renderOtherParts();
  };

  const commit = (nextState: WorkbenchLayoutSnapshot): void => {
    state = boundState(nextState);
    render();
    options.onDidChange(normalizeWorkbenchLayout(state));
  };

  const workbench: Workbench = {
    snapshot: () => normalizeWorkbenchLayout(state),
    restore: (snapshot) => commit(normalizeWorkbenchLayout(snapshot)),
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
      window.removeEventListener("pointermove", onOutlinePointerMove);
      window.removeEventListener("pointerup", finishOutlineResize);
      window.removeEventListener("pointercancel", finishOutlineResize);
      window.removeEventListener("blur", finishOutlineResize);
      window.removeEventListener("resize", onWindowResize);
      options.activityBar.replaceChildren();
      options.primarySidebar.replaceChildren();
      options.registry.dispose();
    },
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
    liveSize = boundState(
      setPartSize(state, "primarySidebar", startSize + event.clientX - startX),
    ).parts.primarySidebar.size;
    options.primarySidebar.style.setProperty("--primary-sidebar-width", `${liveSize}px`);
    options.primaryResizer.setAttribute("aria-valuenow", String(liveSize));
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    resizing = true;
    activePointerId = event.pointerId;
    startX = event.clientX;
    startSize = state.parts.primarySidebar.size;
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
  window.addEventListener("resize", onWindowResize);
  render();
  return workbench;
}
