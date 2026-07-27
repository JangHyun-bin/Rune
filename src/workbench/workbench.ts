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

export interface Workbench {
  snapshot(): WorkbenchLayoutSnapshot;
  restore(snapshot: WorkbenchLayoutSnapshot): void;
  openView(id: WorkbenchViewId): void;
  closeView(id: WorkbenchViewId): void;
  toggleView(id: WorkbenchViewId): void;
  toggleViewCollapsed(id: WorkbenchViewId): void;
  activateContainer(id: WorkbenchContainerId): void;
  resetViewVisibility(): void;
  setPrimarySidebarSize(size: number): void;
  relabel(): void;
  destroy(): void;
}

interface ViewShell {
  section: HTMLElement;
  title: HTMLElement;
  collapse: HTMLButtonElement;
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
  const OUTLINE_DEFAULT_SIZE = 220;

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
    section.appendChild(header);
    section.appendChild(body);
    shell = { section, title, collapse, body };
    viewShells.set(view.id, shell);
    return shell;
  };

  const renderView = (view: ViewContribution): HTMLElement => {
    const layout = state.views[view.id];
    const shell = shellFor(view);
    shell.title.textContent = view.titleKey;
    shell.section.classList.toggle("hidden", !layout.visible);
    shell.section.classList.toggle("collapsed", layout.collapsed);
    shell.collapse.setAttribute("aria-expanded", String(!layout.collapsed));
    shell.body.classList.toggle("hidden", layout.collapsed);
    if (view.id === "outline") {
      shell.section.style.setProperty("--outline-height", `${layout.size ?? OUTLINE_DEFAULT_SIZE}px`);
    }
    if (layout.visible) {
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
      const button = createButton("activitybar-button", container.titleKey, container.icon);
      button.dataset.containerId = container.id;
      const active = state.parts.primarySidebar.activeContainerId === container.id;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active && state.parts.primarySidebar.visible));
      button.addEventListener("click", () => {
        if (active && state.parts.primarySidebar.visible) {
          const next = normalizeWorkbenchLayout(state);
          next.parts.primarySidebar.visible = false;
          commit(next);
        } else {
          workbench.activateContainer(container.id);
        }
      });
      return button;
    }));
  };

  const renderPrimarySidebar = (): void => {
    const part = state.parts.primarySidebar;
    options.primarySidebar.classList.toggle("hidden", !part.visible);
    options.primaryResizer.classList.toggle("hidden", !part.visible);
    options.primarySidebar.setAttribute("aria-hidden", String(!part.visible));
    options.primarySidebar.style.setProperty("--primary-sidebar-width", `${part.size}px`);
    options.primaryResizer.setAttribute("aria-valuenow", String(part.size));

    const contribution = options.registry.containers().find((container) => container.id === part.activeContainerId);
    if (!contribution) {
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
    title.textContent = contribution.titleKey;
    titlebar.appendChild(title);
    for (const view of views.filter((candidate) => !state.views[candidate.id].visible)) {
      const restore = createButton("view-restore", `Open ${view.titleKey}`, view.titleKey);
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
        resizer.className = "outline-view-resizer";
        resizer.dataset.resizesView = "outline";
        resizer.setAttribute("role", "separator");
        resizer.setAttribute("aria-orientation", "horizontal");
        resizer.setAttribute("aria-label", "Resize Outline");
        resizer.setAttribute("aria-valuemin", "64");
        resizer.setAttribute("aria-valuemax", "600");
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
  };

  const renderOtherParts = (): void => {
    const secondaryVisible = state.parts.secondarySidebar.visible;
    options.secondarySidebar.classList.toggle("hidden", !secondaryVisible);
    options.secondaryResizer.classList.toggle("hidden", !secondaryVisible);
    options.secondarySidebar.style.setProperty("--secondary-sidebar-width", `${state.parts.secondarySidebar.size}px`);
    const panelVisible = state.parts.panel.visible;
    options.panel.classList.toggle("hidden", !panelVisible);
    options.panelResizer.classList.toggle("hidden", !panelVisible);
    options.panel.style.setProperty("--panel-height", `${state.parts.panel.size}px`);
  };

  const render = (): void => {
    renderActivityBar();
    renderPrimarySidebar();
    renderOtherParts();
  };

  const commit = (nextState: WorkbenchLayoutSnapshot): void => {
    state = normalizeWorkbenchLayout(nextState);
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
    activateContainer: (id) => {
      commit(activateLayoutContainer(state, id));
      const view = viewsIn(id).find((candidate) => state.views[candidate.id].visible);
      if (view) options.registry.resolveView(view.id).focus?.();
    },
    resetViewVisibility: () => commit(resetLayoutViewVisibility(state)),
    setPrimarySidebarSize: (size) => commit(setPartSize(state, "primarySidebar", size)),
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
    liveSize = setPartSize(state, "primarySidebar", startSize + event.clientX - startX).parts.primarySidebar.size;
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
    state = normalizeWorkbenchLayout(next);
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

  options.primaryResizer.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", finishResize);
  window.addEventListener("pointercancel", finishResize);
  window.addEventListener("blur", finishResize);
  window.addEventListener("pointermove", onOutlinePointerMove);
  window.addEventListener("pointerup", finishOutlineResize);
  window.addEventListener("pointercancel", finishOutlineResize);
  window.addEventListener("blur", finishOutlineResize);
  render();
  return workbench;
}
