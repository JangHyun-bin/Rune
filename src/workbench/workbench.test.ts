import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale, type Locale } from "../i18n/i18n";
import { DEFAULT_WORKBENCH_LAYOUT } from "./workbenchLayout";
import { createViewRegistry } from "./viewRegistry";
import { mountWorkbench } from "./workbench";
import { VIEW_DRAG_TYPE } from "./viewDrop";

type Listener = (event: Event) => void;

class TestElement {
  className = "";
  clientHeight = 0;
  clientWidth = 0;
  offsetHeight = 0;
  offsetWidth = 0;
  rectHeight = 0;
  rectLeft = 0;
  rectTop = 0;
  rectWidth = 0;
  scrollLeft = 0;
  scrollTop = 0;
  children: TestElement[] = [];
  dataset: Record<string, string> = {};
  parentElement: TestElement | null = null;
  style: Record<string, string> & { setProperty(name: string, value: string): void };
  tagName: string;
  private attributes = new Map<string, string>();
  private listeners = new Map<string, Listener[]>();
  private text = "";
  classList = {
    add: (...tokens: string[]) => {
      const current = new Set(this.className.split(/\s+/).filter(Boolean));
      for (const token of tokens) current.add(token);
      this.className = [...current].join(" ");
    },
    remove: (...tokens: string[]) => {
      const removed = new Set(tokens);
      this.className = this.className.split(/\s+/).filter((token) => token && !removed.has(token)).join(" ");
    },
    contains: (token: string) => this.className.split(/\s+/).includes(token),
    toggle: (token: string, force?: boolean) => {
      const shouldAdd = force ?? !this.classList.contains(token);
      if (shouldAdd) this.classList.add(token);
      else this.classList.remove(token);
      return shouldAdd;
    },
  };

  constructor(tagName: string) {
    this.tagName = tagName.toLowerCase();
    this.style = Object.assign(Object.create(null), {
      setProperty: (name: string, value: string) => {
        this.style[name] = value;
      },
    });
  }

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value: string | null) {
    this.text = value ?? "";
    this.replaceChildren();
  }

  appendChild(child: TestElement): TestElement {
    child.remove();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: TestElement[]): void {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    for (const child of children) this.appendChild(child);
  }

  remove(): void {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  contains(candidate: TestElement | null): boolean {
    return candidate === this || this.children.some((child) => child.contains(candidate));
  }

  focus(): void {
    testDocument.activeElement = this;
  }

  getBoundingClientRect(): DOMRect {
    return {
      bottom: this.rectTop + this.rectHeight,
      height: this.rectHeight,
      left: this.rectLeft,
      right: this.rectLeft + this.rectWidth,
      top: this.rectTop,
      width: this.rectWidth,
      x: this.rectLeft,
      y: this.rectTop,
      toJSON: () => ({}),
    };
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
  }

  dispatch(type: string, values: Record<string, unknown> = {}): void {
    const event = { type, preventDefault() {}, ...values } as unknown as Event;
    Object.defineProperty(event, "target", { value: this });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  setPointerCapture(): void {}
  releasePointerCapture(): void {}
  hasPointerCapture(): boolean { return true; }
}

class TestWindow {
  innerHeight = 820;
  innerWidth = 1024;
  private listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
  }

  dispatch(type: string, values: Record<string, unknown> = {}): void {
    const event = { type, ...values } as unknown as Event;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  listenerCount(type: string): number {
    return (this.listeners.get(type) ?? []).length;
  }
}

const testDocument = {
  activeElement: null as TestElement | null,
  body: new TestElement("body"),
  documentElement: new TestElement("html"),
  createElement: (tagName: string) => new TestElement(tagName),
};
let testWindow: TestWindow;
let testRootFontSize = 16;

function walk(root: TestElement): TestElement[] {
  return [root, ...root.children.flatMap(walk)];
}

function byClass(root: TestElement, className: string): TestElement[] {
  return walk(root).filter((element) => element.classList.contains(className));
}

function byData(root: TestElement, name: string, value: string): TestElement {
  const element = walk(root).find((candidate) => candidate.dataset[name] === value);
  if (!element) throw new Error(`Missing data-${name}="${value}"`);
  return element;
}

function viewById(root: TestElement, id: string): TestElement {
  const element = walk(root).find((candidate) =>
    candidate.classList.contains("workbench-view") && candidate.dataset.viewId === id);
  if (!element) throw new Error(`Missing workbench view "${id}"`);
  return element;
}

function setup({ rootWidth = 1024, sidebarHeight = 820, onViewMenu = vi.fn() } = {}) {
  const registry = createViewRegistry();
  const focusWorkspace = vi.fn();
  const focusOutline = vi.fn();
  const focusSearch = vi.fn();
  const focusBacklinks = vi.fn();
  const relabel = vi.fn();
  const createWorkspace = vi.fn(() => ({ element: document.createElement("div"), focus: focusWorkspace, relabel, dispose() {} }));
  const createOutline = vi.fn(() => ({ element: document.createElement("div"), focus: focusOutline, relabel, dispose() {} }));
  const createTags = vi.fn(() => ({ element: document.createElement("div"), relabel, dispose() {} }));
  const createProject = vi.fn(() => ({ element: document.createElement("div"), relabel, dispose() {} }));
  const createSearch = vi.fn(() => ({ element: document.createElement("div"), focus: focusSearch, relabel, dispose() {} }));
  const createBacklinks = vi.fn(() => ({ element: document.createElement("div"), focus: focusBacklinks, relabel, dispose() {} }));
  const createProperties = vi.fn(() => ({ element: document.createElement("div"), relabel, dispose() {} }));
  registry.registerContainer({ id: "explorer", titleKey: "view.explorer", icon: "files", order: 0 });
  registry.registerContainer({ id: "search", titleKey: "view.search", icon: "search", order: 1 });
  registry.registerContainer({ id: "auxiliary", titleKey: "view.auxiliary", icon: "aux", order: 0 });
  registry.registerContainer({ id: "panel", titleKey: "view.panel", icon: "panel", order: 0 });
  registry.registerView({ id: "workspace", titleKey: "view.workspace", defaultContainerId: "explorer", order: 0, create: createWorkspace });
  registry.registerView({ id: "outline", titleKey: "view.outline", defaultContainerId: "explorer", order: 1, create: createOutline });
  registry.registerView({ id: "tags", titleKey: "view.tags", defaultContainerId: "explorer", order: 2, create: createTags });
  registry.registerView({ id: "project", titleKey: "view.project", defaultContainerId: "explorer", order: 3, create: createProject });
  registry.registerView({ id: "search", titleKey: "view.search", defaultContainerId: "search", order: 0, create: createSearch });
  registry.registerView({ id: "backlinks", titleKey: "view.backlinks", defaultContainerId: "auxiliary", order: 0, create: createBacklinks });
  registry.registerView({ id: "properties", titleKey: "view.properties", defaultContainerId: "auxiliary", order: 1, create: createProperties });

  const hosts = {
    activityBar: document.createElement("nav"),
    primarySidebar: document.createElement("aside"),
    primaryResizer: document.createElement("div"),
    secondarySidebar: document.createElement("aside"),
    secondaryResizer: document.createElement("div"),
    panel: document.createElement("section"),
    panelResizer: document.createElement("div"),
  };
  const workbenchHost = document.createElement("div") as unknown as TestElement;
  workbenchHost.clientWidth = rootWidth;
  workbenchHost.clientHeight = sidebarHeight;
  workbenchHost.rectWidth = rootWidth;
  workbenchHost.rectHeight = sidebarHeight;
  (hosts.activityBar as unknown as TestElement).clientWidth = 48;
  (hosts.activityBar as unknown as TestElement).rectWidth = 48;
  (hosts.primaryResizer as unknown as TestElement).clientWidth = 6;
  (hosts.primaryResizer as unknown as TestElement).rectWidth = 6;
  (hosts.primarySidebar as unknown as TestElement).clientHeight = sidebarHeight;
  (hosts.primarySidebar as unknown as TestElement).rectHeight = sidebarHeight;
  for (const host of Object.values(hosts)) workbenchHost.appendChild(host as unknown as TestElement);
  const focusEditor = vi.fn();
  const onDidChange = vi.fn();
  const workbench = mountWorkbench({
    ...hosts,
    registry,
    initialState: DEFAULT_WORKBENCH_LAYOUT,
    focusEditor,
    onViewMenu,
  });
  workbench.onDidChange(onDidChange);

  return {
    ...hosts,
    workbenchHost,
    registry,
    workbench,
    focusEditor,
    onDidChange,
    onViewMenu,
    createWorkspace,
    createOutline,
    createSearch,
    createBacklinks,
    focusWorkspace,
    focusOutline,
    focusSearch,
    focusBacklinks,
    relabel,
  };
}

beforeEach(() => {
  setLocale("en");
  testDocument.activeElement = null;
  testDocument.body = new TestElement("body");
  testDocument.documentElement = new TestElement("html");
  testWindow = new TestWindow();
  testRootFontSize = 16;
  vi.stubGlobal("document", testDocument);
  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("getComputedStyle", () => ({ fontSize: `${testRootFontSize}px` }));
});

afterEach(() => vi.unstubAllGlobals());

describe("workbench", () => {
  it("mounts Workspace and Outline in Explorer order", () => {
    const { primarySidebar } = setup();
    const container = byData(primarySidebar as unknown as TestElement, "containerId", "explorer");
    const views = byClass(container, "workbench-view");

    expect(views.map((view) => view.dataset.viewId)).toEqual(["workspace", "outline", "tags", "project"]);
  });

  it("keeps long Outline content inside its own scroll container", () => {
    const { primarySidebar } = setup();
    const outline = viewById(primarySidebar as unknown as TestElement, "outline");
    const body = byClass(outline, "workbench-view-body")[0];

    expect(body.style.overflow).toBe("auto");
  });

  it("closes and reopens Outline without recreating its element", () => {
    const { primarySidebar, workbench, createOutline } = setup();
    const outline = byData(primarySidebar as unknown as TestElement, "viewId", "outline");
    const element = byClass(outline, "workbench-view-body")[0].children[0];

    workbench.closeView("outline");
    expect(outline.classList.contains("hidden")).toBe(true);
    expect(element.parentElement).not.toBeNull();
    byClass(primarySidebar as unknown as TestElement, "view-restore")[0].dispatch("click");
    workbench.closeView("outline");

    expect(createOutline).toHaveBeenCalledTimes(1);
    expect(byClass(viewById(primarySidebar as unknown as TestElement, "outline"), "workbench-view-body")[0].children[0]).toBe(element);
  });

  it("activates Search from the Activity Bar and mounts its view", () => {
    const { activityBar, primarySidebar, createSearch, focusWorkspace, focusSearch } = setup();

    expect(focusWorkspace).not.toHaveBeenCalled();
    byData(activityBar as unknown as TestElement, "containerId", "search").dispatch("click");

    expect(byData(primarySidebar as unknown as TestElement, "containerId", "search")).toBeDefined();
    expect(byData(primarySidebar as unknown as TestElement, "viewId", "search")).toBeDefined();
    expect(createSearch).toHaveBeenCalledTimes(1);
    expect(focusSearch).toHaveBeenCalledTimes(1);
  });

  it("opens and focuses an inactive visible Search view on first toggle", () => {
    const { workbench, focusSearch } = setup();

    expect(workbench.snapshot().views.search.visible).toBe(true);
    expect(workbench.snapshot().parts.primarySidebar.activeContainerId).toBe("explorer");

    workbench.toggleView("search");

    expect(workbench.snapshot().views.search.visible).toBe(true);
    expect(workbench.snapshot().parts.primarySidebar).toMatchObject({
      activeContainerId: "search",
      visible: true,
    });
    expect(focusSearch).toHaveBeenCalledTimes(1);
  });

  it("opens registered auxiliary views in the Secondary Sidebar", () => {
    const { secondarySidebar, workbench, createBacklinks, focusBacklinks } = setup();

    workbench.openView("backlinks");

    expect(workbench.snapshot().parts.secondarySidebar.visible).toBe(true);
    const container = byData(secondarySidebar as unknown as TestElement, "containerId", "auxiliary");
    expect(byClass(container, "workbench-view").map((view) => view.dataset.viewId)).toEqual([
      "backlinks",
      "properties",
    ]);
    expect(createBacklinks).toHaveBeenCalledTimes(1);
    expect(focusBacklinks).toHaveBeenCalledTimes(1);
  });

  it("reparents a cached Outline element into Auxiliary exactly once", () => {
    const { primarySidebar, secondarySidebar, secondaryResizer, workbench, createOutline } = setup();
    const outline = viewById(primarySidebar as unknown as TestElement, "outline");
    const element = byClass(outline, "workbench-view-body")[0].children[0];

    workbench.moveView("outline", "auxiliary");

    expect(byClass(viewById(secondarySidebar as unknown as TestElement, "outline"), "workbench-view-body")[0].children[0]).toBe(element);
    expect(createOutline).toHaveBeenCalledTimes(1);
    expect((secondarySidebar as unknown as TestElement).classList.contains("hidden")).toBe(false);
    expect((secondaryResizer as unknown as TestElement).classList.contains("hidden")).toBe(false);
  });

  it("moves a dragged view through the Workbench controller without recreating it", () => {
    const { primarySidebar, secondarySidebar, workbench, createOutline } = setup();
    const moveView = vi.spyOn(workbench, "moveView");
    const outline = viewById(primarySidebar as unknown as TestElement, "outline");
    const header = byClass(outline, "workbench-view-header")[0];
    const dataTransfer = {
      values: new Map<string, string>(),
      effectAllowed: "",
      setData(type: string, value: string) { this.values.set(type, value); },
      getData(type: string) { return this.values.get(type) ?? ""; },
    };

    expect((header as unknown as { draggable: boolean }).draggable).toBe(true);
    header.dispatch("dragstart", { dataTransfer });
    const target = byClass(secondarySidebar as unknown as TestElement, "view-container-body")[0];
    target.dispatch("drop", { clientY: 10, dataTransfer });

    expect(dataTransfer.values.get(VIEW_DRAG_TYPE)).toBe("outline");
    expect(dataTransfer.effectAllowed).toBe("move");
    expect(moveView).toHaveBeenCalledWith("outline", "auxiliary", 2);
    expect(workbench.snapshot().views.outline.containerId).toBe("auxiliary");
    expect(createOutline).toHaveBeenCalledTimes(1);
  });

  it("combines, reorders, closes, reopens, and splits view tab groups", () => {
    const { workbench } = setup();

    workbench.moveViewToGroup("outline", "explorer", "explorer:workspace");
    expect(workbench.snapshot().viewGroups.explorer.groups["explorer:workspace"].viewIds).toEqual(["workspace", "outline"]);
    expect(workbench.snapshot().viewGroups.explorer.groups["explorer:outline"]).toBeUndefined();

    workbench.moveViewToGroup("outline", "explorer", "explorer:workspace", 0);
    expect(workbench.snapshot().viewGroups.explorer.groups["explorer:workspace"].viewIds).toEqual(["outline", "workspace"]);
    workbench.closeView("outline");
    workbench.openView("outline");
    expect(workbench.snapshot().viewGroups.explorer.groups["explorer:workspace"]).toMatchObject({
      viewIds: ["outline", "workspace"],
      activeViewId: "outline",
    });

    workbench.splitViewGroup("outline", "explorer", "explorer:workspace", "row", "after");
    expect(workbench.snapshot().viewGroups.explorer.root).toMatchObject({ type: "split" });
    expect(Object.values(workbench.snapshot().viewGroups.explorer.groups).find((group) => group.viewIds[0] === "outline")?.id)
      .not.toBe("explorer:workspace");
  });

  it("splits a view group when a dragged header is dropped on its edge", () => {
    const { primarySidebar, workbench } = setup();
    const root = primarySidebar as unknown as TestElement;
    const outlineHeader = byClass(viewById(root, "outline"), "workbench-view-header")[0];
    const workspaceGroup = byData(root, "groupId", "explorer:workspace");
    workspaceGroup.rectLeft = 100;
    workspaceGroup.rectTop = 100;
    workspaceGroup.rectWidth = 200;
    workspaceGroup.rectHeight = 200;
    const values = new Map<string, string>();
    const dataTransfer = {
      types: [] as string[],
      effectAllowed: "",
      setData(type: string, value: string) { values.set(type, value); this.types = [...values.keys()]; },
      getData(type: string) { return values.get(type) ?? ""; },
    };

    outlineHeader.dispatch("dragstart", { dataTransfer });
    workspaceGroup.dispatch("drop", { clientX: 299, clientY: 200, dataTransfer });

    expect(workbench.snapshot().viewGroups.explorer.root).toMatchObject({ type: "split" });
    expect(workbench.snapshot().viewGroups.explorer.groups["explorer:outline"]).toBeUndefined();
    expect(Object.values(workbench.snapshot().viewGroups.explorer.groups).some((group) => group.viewIds[0] === "outline")).toBe(true);
  });

  it("temporarily detaches and reattaches a group without changing its persisted layout", () => {
    const { primarySidebar, workbench } = setup();
    const before = workbench.snapshot();

    workbench.setViewGroupDetached("explorer", "explorer:outline", true);
    expect(byClass(primarySidebar as unknown as TestElement, "workbench-view").some((view) => view.dataset.viewId === "outline")).toBe(false);
    expect(workbench.snapshot()).toEqual(before);

    workbench.setViewGroupDetached("explorer", "explorer:outline", false);
    expect(viewById(primarySidebar as unknown as TestElement, "outline")).toBeDefined();
    expect(workbench.snapshot()).toEqual(before);
  });

  it("accepts a protected dragover from its MIME type and reads the payload only on drop", () => {
    const { primarySidebar, secondarySidebar, workbench } = setup();
    const header = byClass(viewById(primarySidebar as unknown as TestElement, "outline"), "workbench-view-header")[0];
    const values = new Map<string, string>();
    let protectedPhase = false;
    const dataTransfer = {
      types: [] as string[],
      effectAllowed: "",
      setData(type: string, value: string) {
        values.set(type, value);
        this.types = [...values.keys()];
      },
      getData: vi.fn((type: string) => protectedPhase ? "" : values.get(type) ?? ""),
    };
    header.dispatch("dragstart", { dataTransfer });
    const target = byClass(secondarySidebar as unknown as TestElement, "view-container-body")[0];
    const preventDragover = vi.fn();

    protectedPhase = true;
    target.dispatch("dragover", { clientY: 10, dataTransfer, preventDefault: preventDragover });

    expect(preventDragover).toHaveBeenCalledTimes(1);
    expect(dataTransfer.getData).not.toHaveBeenCalled();
    expect(target.classList.contains("view-drop-target")).toBe(true);

    protectedPhase = false;
    target.dispatch("drop", { clientY: 10, dataTransfer });

    expect(dataTransfer.getData).toHaveBeenCalledTimes(1);
    expect(workbench.snapshot().views.outline.containerId).toBe("auxiliary");
  });

  it("hides the source part after its last visible view moves away", () => {
    const { workbench } = setup();

    workbench.closeView("properties");
    workbench.moveView("backlinks", "explorer");

    expect(workbench.snapshot().parts.secondarySidebar.visible).toBe(false);
  });

  it("renders a moved Search view as a Panel tab and body", () => {
    const { panel, workbench } = setup();

    workbench.moveView("search", "panel");

    expect(byClass(panel as unknown as TestElement, "panel-tab")[0].dataset.viewId).toBe("search");
    expect(byClass(panel as unknown as TestElement, "panel-body")[0].children[0].dataset.viewId).toBe("search");
  });

  it("keeps Panel movement available from the visible tab and More Actions", () => {
    const onViewMenu = vi.fn();
    const { panel, workbench } = setup({ onViewMenu });
    workbench.moveView("search", "panel");
    const root = panel as unknown as TestElement;
    const tab = byClass(root, "panel-tab")[0];
    const more = byClass(root, "panel-tab-more")[0];
    const dataTransfer = {
      types: [] as string[],
      effectAllowed: "",
      setData(type: string) { this.types = [type]; },
      getData() { return "search"; },
    };

    expect((tab as unknown as { draggable: boolean }).draggable).toBe(true);
    tab.dispatch("dragstart", { dataTransfer });
    expect(dataTransfer.types).toContain(VIEW_DRAG_TYPE);
    expect(dataTransfer.effectAllowed).toBe("move");

    more.dispatch("click", { clientX: 24, clientY: 32 });
    expect(more.getAttribute("aria-label")).toBe("Move View Search");
    expect(onViewMenu).toHaveBeenLastCalledWith("search", 24, 32);

    const preventContextMenu = vi.fn();
    tab.dispatch("contextmenu", { clientX: 40, clientY: 48, preventDefault: preventContextMenu });
    expect(preventContextMenu).toHaveBeenCalledTimes(1);
    expect(onViewMenu).toHaveBeenLastCalledWith("search", 40, 48);
  });

  it("uses the horizontal Panel tab strip as its drop target", () => {
    const { primarySidebar, panel, workbench } = setup();
    workbench.moveView("search", "panel");
    const header = byClass(viewById(primarySidebar as unknown as TestElement, "outline"), "workbench-view-header")[0];
    const values = new Map<string, string>();
    let protectedPhase = false;
    const dataTransfer = {
      types: [] as string[],
      effectAllowed: "",
      setData(type: string, value: string) {
        values.set(type, value);
        this.types = [...values.keys()];
      },
      getData(type: string) { return protectedPhase ? "" : values.get(type) ?? ""; },
    };
    header.dispatch("dragstart", { dataTransfer });
    const tabs = byClass(panel as unknown as TestElement, "panel-tabs")[0];
    const preventDragover = vi.fn();

    protectedPhase = true;
    tabs.dispatch("dragover", { clientX: 10, dataTransfer, preventDefault: preventDragover });
    expect(preventDragover).toHaveBeenCalledTimes(1);

    protectedPhase = false;
    tabs.dispatch("drop", { clientX: 10, dataTransfer });

    expect(workbench.snapshot().views.outline.containerId).toBe("panel");
  });

  it("places drop indicators at vertical header and horizontal tab insertion boundaries", () => {
    const protectedTransfer = () => {
      const values = new Map<string, string>();
      return {
        types: [] as string[],
        effectAllowed: "",
        setData(type: string, value: string) {
          values.set(type, value);
          this.types = [...values.keys()];
        },
        getData() { return ""; },
      };
    };
    const sidebarSetup = setup();
    const sidebarRoot = sidebarSetup.primarySidebar as unknown as TestElement;
    const sidebarTarget = byClass(sidebarRoot, "view-container-body")[0];
    sidebarTarget.rectTop = 100;
    const sidebarHeaders = byClass(sidebarRoot, "workbench-view-header");
    sidebarHeaders.forEach((header, index) => {
      header.rectTop = 110 + index * 40;
      header.rectHeight = 20;
    });
    const sidebarTransfer = protectedTransfer();
    sidebarHeaders[1].dispatch("dragstart", { dataTransfer: sidebarTransfer });

    sidebarTarget.dispatch("dragover", { clientY: 145, dataTransfer: sidebarTransfer });

    const verticalIndicator = byClass(sidebarTarget, "view-drop-indicator")[0];
    expect(verticalIndicator.dataset.axis).toBe("y");
    expect(verticalIndicator.style["--view-drop-offset"]).toBe("90px");

    const panelSetup = setup();
    panelSetup.workbench.moveView("search", "panel");
    panelSetup.workbench.moveView("workspace", "panel");
    const panelRoot = panelSetup.panel as unknown as TestElement;
    const tabs = byClass(panelRoot, "panel-tabs")[0];
    tabs.rectLeft = 200;
    const panelTabs = byClass(panelRoot, "panel-tab-item");
    panelTabs[0].rectLeft = 200;
    panelTabs[0].rectWidth = 60;
    panelTabs[1].rectLeft = 260;
    panelTabs[1].rectWidth = 80;
    const outlineHeader = byClass(viewById(panelSetup.primarySidebar as unknown as TestElement, "outline"), "workbench-view-header")[0];
    const panelTransfer = protectedTransfer();
    outlineHeader.dispatch("dragstart", { dataTransfer: panelTransfer });

    tabs.dispatch("dragover", { clientX: 270, dataTransfer: panelTransfer });

    const horizontalIndicator = byClass(tabs, "view-drop-indicator")[0];
    expect(horizontalIndicator.dataset.axis).toBe("x");
    expect(horizontalIndicator.style["--view-drop-offset"]).toBe("60px");
  });

  it("shows a collapsed view body after moving it into the Panel", () => {
    const { panel, workbench } = setup();

    workbench.moveView("tags", "panel");

    const tags = viewById(panel as unknown as TestElement, "tags");
    expect(tags.classList.contains("collapsed")).toBe(false);
    expect(byClass(tags, "workbench-view-body")[0].classList.contains("hidden")).toBe(false);
  });

  it("persists Panel height and side width in the same part size", () => {
    const { panel, panelResizer, workbench } = setup();
    workbench.moveView("search", "panel");
    workbench.setPanelPosition("bottom");

    (panelResizer as unknown as TestElement).dispatch("pointerdown", { button: 0, pointerId: 3, clientY: 300 });
    testWindow.dispatch("pointermove", { clientY: 240 });
    testWindow.dispatch("pointerup");
    expect(workbench.snapshot().parts.panel.size).toBe(280);
    expect((panel as unknown as TestElement).style["--panel-height"]).toBe("280px");

    workbench.setPanelPosition("left");
    (panelResizer as unknown as TestElement).dispatch("pointerdown", { button: 0, pointerId: 4, clientX: 300 });
    testWindow.dispatch("pointermove", { clientX: 360 });
    testWindow.dispatch("pointerup");
    expect(workbench.snapshot().parts.panel.size).toBe(340);
    expect((panel as unknown as TestElement).style["--panel-width"]).toBe("340px");
  });

  it("toggles a part without changing child view visibility", () => {
    const { workbench } = setup();
    workbench.moveView("search", "panel");
    const visible = workbench.snapshot().views.search.visible;

    workbench.togglePart("panel");

    expect(workbench.snapshot().parts.panel.visible).toBe(false);
    expect(workbench.snapshot().views.search.visible).toBe(visible);
  });

  it("opens the view menu from the accessible header action", () => {
    const onViewMenu = vi.fn();
    const { primarySidebar } = setup({ onViewMenu });
    const outline = viewById(primarySidebar as unknown as TestElement, "outline");
    const more = byClass(outline, "view-more")[0];

    more.dispatch("click", { clientX: 32, clientY: 48 });

    expect(more.getAttribute("aria-label")).toBe("Move View Outline");
    expect(onViewMenu).toHaveBeenCalledWith("outline", 32, 48);
  });

  it("returns focus to the editor when a focused Outline is closed", () => {
    const { primarySidebar, focusEditor } = setup();
    const outline = byData(primarySidebar as unknown as TestElement, "viewId", "outline");
    const element = byClass(outline, "workbench-view-body")[0].children[0];
    element.focus();

    byClass(outline, "view-close")[0].dispatch("click");

    expect(focusEditor).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the editor when the focused close button hides its view", () => {
    const { primarySidebar, focusEditor } = setup();
    const outline = byData(primarySidebar as unknown as TestElement, "viewId", "outline");
    const close = byClass(outline, "view-close")[0];
    close.focus();

    close.dispatch("click");

    expect(focusEditor).toHaveBeenCalledTimes(1);
  });

  it("emits the latest snapshot after every user action", () => {
    const { activityBar, primarySidebar, onDidChange } = setup();
    const outline = byData(primarySidebar as unknown as TestElement, "viewId", "outline");

    byClass(outline, "view-collapse")[0].dispatch("click");
    expect(outline.classList.contains("collapsed")).toBe(true);
    expect(byClass(outline, "view-collapse")[0].getAttribute("aria-expanded")).toBe("false");
    expect(byClass(outline, "workbench-view-body")[0].classList.contains("hidden")).toBe(true);
    byData(activityBar as unknown as TestElement, "containerId", "search").dispatch("click");
    byData(activityBar as unknown as TestElement, "containerId", "search").dispatch("click");

    expect(onDidChange).toHaveBeenCalledTimes(3);
    expect(onDidChange.mock.calls[0][0].views.outline.collapsed).toBe(true);
    expect(onDidChange.mock.calls[1][0].parts.primarySidebar).toMatchObject({
      activeContainerId: "search",
      visible: true,
    });
    expect(onDidChange.mock.calls[2][0].parts.primarySidebar.visible).toBe(false);
  });

  it("supports independently disposable layout persistence listeners", () => {
    const { workbench } = setup();
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = workbench.onDidChange(first);
    workbench.onDidChange(second);

    workbench.togglePart("panel");
    stopFirst();
    workbench.togglePart("panel");

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    expect(second.mock.calls[1][0].parts.panel.visible).toBe(false);
  });

  it("restores startup layout without marking persistence dirty", () => {
    const { workbench, onDidChange } = setup();
    const restored = {
      ...DEFAULT_WORKBENCH_LAYOUT,
      parts: {
        ...DEFAULT_WORKBENCH_LAYOUT.parts,
        primarySidebar: { ...DEFAULT_WORKBENCH_LAYOUT.parts.primarySidebar, visible: false },
      },
    };

    workbench.restore(restored, { emitChange: false });

    expect(workbench.snapshot().parts.primarySidebar.visible).toBe(false);
    expect(onDidChange).not.toHaveBeenCalled();
  });

  it("toggles the Primary Sidebar through the public API", () => {
    const { primarySidebar, primaryResizer, workbench, onDidChange } = setup();

    workbench.togglePrimarySidebar();

    expect(workbench.snapshot().parts.primarySidebar.visible).toBe(false);
    expect((primarySidebar as unknown as TestElement).classList.contains("hidden")).toBe(true);
    expect((primaryResizer as unknown as TestElement).classList.contains("hidden")).toBe(true);

    workbench.togglePrimarySidebar();

    expect(workbench.snapshot().parts.primarySidebar.visible).toBe(true);
    expect(onDidChange).toHaveBeenCalledTimes(2);
  });

  it("persists one Primary Sidebar size change on pointer release", () => {
    const { primarySidebar, primaryResizer, workbench, onDidChange } = setup();

    (primaryResizer as unknown as TestElement).dispatch("pointerdown", { button: 0, pointerId: 1, clientX: 100 });
    testWindow.dispatch("pointermove", { clientX: 180 });

    expect((primarySidebar as unknown as TestElement).style["--primary-sidebar-width"]).toBe("320px");
    expect(onDidChange).not.toHaveBeenCalled();

    testWindow.dispatch("pointerup");

    expect(workbench.snapshot().parts.primarySidebar.size).toBe(320);
    expect(onDidChange).toHaveBeenCalledTimes(1);
  });

  it("relabels resolved views without emitting a layout change", () => {
    const { workbench, relabel, onDidChange } = setup();

    workbench.relabel();

    expect(relabel).toHaveBeenCalledTimes(4);
    expect(onDidChange).not.toHaveBeenCalled();
  });

  it("relabels Workbench controls in every supported locale", () => {
    const labels: Record<Locale, { explorer: string; outline: string; open: string; close: string; collapse: string; expand: string }> = {
      en: { explorer: "Explorer", outline: "Outline", open: "Open", close: "Close", collapse: "Collapse", expand: "Expand" },
      ko: { explorer: "탐색기", outline: "개요", open: "열기", close: "닫기", collapse: "접기", expand: "펼치기" },
      ja: { explorer: "エクスプローラー", outline: "アウトライン", open: "開く", close: "閉じる", collapse: "折りたたむ", expand: "展開" },
      "zh-Hans": { explorer: "资源管理器", outline: "大纲", open: "打开", close: "关闭", collapse: "折叠", expand: "展开" },
    };
    const { activityBar, primarySidebar, workbench } = setup();
    const root = primarySidebar as unknown as TestElement;

    workbench.closeView("outline");
    for (const [locale, expected] of Object.entries(labels) as [Locale, typeof labels[Locale]][]) {
      setLocale(locale);
      workbench.relabel();
      expect(byData(activityBar as unknown as TestElement, "containerId", "explorer").getAttribute("aria-label")).toBe(expected.explorer);
      expect(walk(root).find((element) => element.tagName === "h2")?.textContent).toBe(expected.explorer);
      expect(byClass(root, "view-restore")[0].getAttribute("aria-label")).toBe(`${expected.open} ${expected.outline}`);
    }

    workbench.openView("outline");
    for (const [locale, expected] of Object.entries(labels) as [Locale, typeof labels[Locale]][]) {
      setLocale(locale);
      workbench.relabel();
      expect(byClass(viewById(root, "outline"), "view-collapse")[0].getAttribute("aria-label")).toBe(`${expected.collapse} ${expected.outline}`);
    }
    workbench.toggleViewCollapsed("outline");
    for (const [locale, expected] of Object.entries(labels) as [Locale, typeof labels[Locale]][]) {
      setLocale(locale);
      workbench.relabel();
      const outline = viewById(root, "outline");
      expect(byClass(outline, "view-title")[0].textContent).toBe(expected.outline);
      expect(byClass(outline, "view-collapse")[0].getAttribute("aria-label")).toBe(`${expected.expand} ${expected.outline}`);
      expect(byClass(outline, "view-close")[0].getAttribute("aria-label")).toBe(`${expected.close} ${expected.outline}`);
    }
  });

  it("relabels structural regions and separators in every supported locale", () => {
    const labels: Record<Locale, string[]> = {
      en: ["Activity Bar", "Primary Sidebar", "Resize Primary Sidebar", "Secondary Sidebar", "Resize Secondary Sidebar", "Panel", "Resize Panel", "Resize Outline"],
      ko: ["활동 표시줄", "기본 사이드바", "기본 사이드바 크기 조절", "보조 사이드바", "보조 사이드바 크기 조절", "패널", "패널 크기 조절", "개요 크기 조절"],
      ja: ["アクティビティバー", "プライマリサイドバー", "プライマリサイドバーのサイズを変更", "セカンダリサイドバー", "セカンダリサイドバーのサイズを変更", "パネル", "パネルのサイズを変更", "アウトラインのサイズを変更"],
      "zh-Hans": ["活动栏", "主侧边栏", "调整主侧边栏大小", "辅助侧边栏", "调整辅助侧边栏大小", "面板", "调整面板大小", "调整大纲大小"],
    };
    const {
      activityBar,
      primarySidebar,
      primaryResizer,
      secondarySidebar,
      secondaryResizer,
      panel,
      panelResizer,
      workbench,
    } = setup();

    for (const [locale, expected] of Object.entries(labels) as [Locale, string[]][]) {
      setLocale(locale);
      workbench.relabel();
      const outlineResizer = byClass(primarySidebar as unknown as TestElement, "outline-view-resizer")[0];
      const actual = [activityBar, primarySidebar, primaryResizer, secondarySidebar, secondaryResizer, panel, panelResizer, outlineResizer]
        .map((element) => (element as unknown as TestElement).getAttribute("aria-label"));
      expect(actual).toEqual(expected);
      expect(actual).not.toContain("workbench.activityBar");
    }
  });

  it("bounds the rendered Primary Sidebar without overwriting its stored size", () => {
    const { primarySidebar, primaryResizer, workbench, onDidChange } = setup({ rootWidth: 500 });
    const restored = workbench.snapshot();
    restored.parts.primarySidebar.size = 720;

    workbench.restore(restored);

    expect(workbench.snapshot().parts.primarySidebar.size).toBe(720);
    expect((primarySidebar as unknown as TestElement).style["--primary-sidebar-width"]).toBe("226px");
    expect((primaryResizer as unknown as TestElement).getAttribute("aria-valuemax")).toBe("226");
    expect((primaryResizer as unknown as TestElement).getAttribute("aria-valuenow")).toBe("226");
    expect(onDidChange.mock.calls.at(-1)?.[0].parts.primarySidebar.size).toBe(720);
  });

  it("starts a narrow-window Primary Sidebar resize from its rendered bound", () => {
    const { primarySidebar, primaryResizer, workbench, onDidChange } = setup({ rootWidth: 500 });
    const restored = workbench.snapshot();
    restored.parts.primarySidebar.size = 720;
    workbench.restore(restored);
    onDidChange.mockClear();

    (primaryResizer as unknown as TestElement).dispatch("pointerdown", { button: 0, pointerId: 7, clientX: 100 });
    testWindow.dispatch("pointermove", { clientX: 90 });

    expect((primarySidebar as unknown as TestElement).style["--primary-sidebar-width"]).toBe("216px");
    testWindow.dispatch("pointerup");
    expect(workbench.snapshot().parts.primarySidebar.size).toBe(216);
    expect(onDidChange).toHaveBeenCalledTimes(1);
  });

  it("uses bordered outer widths when reserving editor space", () => {
    const { activityBar, primarySidebar, primaryResizer, workbench } = setup({ rootWidth: 500 });
    (activityBar as unknown as TestElement).rectWidth = 50;
    (primaryResizer as unknown as TestElement).rectWidth = 8;
    const restored = workbench.snapshot();
    restored.parts.primarySidebar.size = 720;

    workbench.restore(restored);

    expect(workbench.snapshot().parts.primarySidebar.size).toBe(720);
    expect((primarySidebar as unknown as TestElement).style["--primary-sidebar-width"]).toBe("222px");
    expect((primaryResizer as unknown as TestElement).getAttribute("aria-valuemax")).toBe("222");
  });

  it("temporarily hides horizontal auxiliary parts at 390px and restores their stored sizes", () => {
    const { workbenchHost, primarySidebar, secondarySidebar, panel, workbench, onDidChange } = setup({ rootWidth: 390 });
    workbench.openView("backlinks");
    workbench.moveView("search", "panel");
    workbench.setPanelPosition("left");
    const saved = workbench.snapshot();
    saved.parts.secondarySidebar.size = 300;
    saved.parts.panel.size = 260;
    workbench.restore(saved);
    onDidChange.mockClear();

    expect((secondarySidebar as unknown as TestElement).classList.contains("hidden")).toBe(true);
    expect((panel as unknown as TestElement).classList.contains("hidden")).toBe(true);
    expect((primarySidebar as unknown as TestElement).style["--primary-sidebar-width"]).toBe("116px");
    expect(workbench.snapshot().parts.secondarySidebar).toMatchObject({ visible: true, size: 300 });
    expect(workbench.snapshot().parts.panel).toMatchObject({ visible: true, size: 260 });

    (workbenchHost as unknown as TestElement).clientWidth = 1400;
    (workbenchHost as unknown as TestElement).rectWidth = 1400;
    testWindow.dispatch("resize");

    expect((secondarySidebar as unknown as TestElement).classList.contains("hidden")).toBe(false);
    expect((panel as unknown as TestElement).classList.contains("hidden")).toBe(false);
    expect((secondarySidebar as unknown as TestElement).style["--secondary-sidebar-width"]).toBe("300px");
    expect((panel as unknown as TestElement).style["--panel-width"]).toBe("260px");
    expect(onDidChange).not.toHaveBeenCalled();
  });

  it("clamps Outline height to preserve Workspace and shell controls in a short sidebar", () => {
    const { primarySidebar, workbench, onDidChange } = setup({ sidebarHeight: 400 });
    const restored = workbench.snapshot();
    restored.views.outline.size = 600;

    workbench.restore(restored);

    const root = primarySidebar as unknown as TestElement;
    const resizer = byClass(root, "outline-view-resizer")[0];
    expect(workbench.snapshot().views.outline.size).toBe(180);
    expect(resizer.getAttribute("aria-valuemax")).toBe("180");
    expect(resizer.getAttribute("aria-valuenow")).toBe("180");
    expect(viewById(root, "outline").style["--outline-height"]).toBe("180px");
    expect(onDidChange.mock.calls.at(-1)?.[0].views.outline.size).toBe(180);
  });

  it("uses scaled outer chrome heights when bounding Outline", () => {
    const { primarySidebar, workbench } = setup({ sidebarHeight: 400 });
    const root = primarySidebar as unknown as TestElement;
    byClass(root, "view-container-titlebar")[0].rectHeight = 51;
    viewById(root, "workspace").children[0].rectHeight = 45;
    viewById(root, "outline").children[0].rectHeight = 45;
    byClass(root, "outline-view-resizer")[0].rectHeight = 6;
    const restored = workbench.snapshot();
    restored.views.outline.size = 600;

    workbench.restore(restored);

    expect(workbench.snapshot().views.outline.size).toBe(133);
    expect(byClass(root, "outline-view-resizer")[0].getAttribute("aria-valuemax")).toBe("133");
  });

  it("uses the scaled root font for unmeasured Outline chrome fallbacks", () => {
    testRootFontSize = 24;

    const { workbench } = setup({ sidebarHeight: 400 });

    expect(workbench.snapshot().views.outline.size).toBe(133);
  });

  it("bounds a null Outline size through the default before render and ARIA", () => {
    const { primarySidebar, workbench, onDidChange } = setup({ sidebarHeight: 400 });
    const restored = workbench.snapshot();
    restored.views.outline.size = null;

    workbench.restore(restored);

    const root = primarySidebar as unknown as TestElement;
    const resizer = byClass(root, "outline-view-resizer")[0];
    expect(workbench.snapshot().views.outline.size).toBe(180);
    expect(resizer.getAttribute("aria-valuenow")).toBe("180");
    expect(viewById(root, "outline").style["--outline-height"]).toBe("180px");
    expect(onDidChange.mock.calls.at(-1)?.[0].views.outline.size).toBe(180);
  });

  it("reflows scaled chrome through the public Workbench API and persists one changed bound", () => {
    const { primarySidebar, workbench, onDidChange } = setup({ sidebarHeight: 400 });
    const root = primarySidebar as unknown as TestElement;
    byClass(root, "view-container-titlebar")[0].rectHeight = 51;
    viewById(root, "workspace").children[0].rectHeight = 45;
    viewById(root, "outline").children[0].rectHeight = 45;
    byClass(root, "outline-view-resizer")[0].rectHeight = 6;

    workbench.reflow();

    expect(workbench.snapshot().views.outline.size).toBe(133);
    expect(onDidChange).toHaveBeenCalledTimes(1);
    expect(onDidChange.mock.calls[0][0].views.outline.size).toBe(133);
  });

  it("does not persist an unchanged public reflow or window resize", () => {
    const { workbench, onDidChange } = setup();

    workbench.reflow();
    testWindow.dispatch("resize");

    expect(onDidChange).not.toHaveBeenCalled();
  });

  it("silently applies final 80% geometry before restoring a size valid only at that scale", () => {
    const { primarySidebar, workbench, onDidChange } = setup();
    (primarySidebar as unknown as TestElement).rectHeight = 400;
    testRootFontSize = 12.8;

    workbench.reflow({ emitChange: false });

    expect(workbench.snapshot().views.outline.size).toBe(198);
    expect(onDidChange).not.toHaveBeenCalled();

    const saved = workbench.snapshot();
    saved.views.outline.size = 190;
    workbench.restore(saved);

    expect(workbench.snapshot().views.outline.size).toBe(190);
    expect(onDidChange).toHaveBeenCalledTimes(1);
    expect(onDidChange.mock.calls[0][0].views.outline.size).toBe(190);
  });

  it("removes the Workbench resize listener when destroyed", () => {
    const { secondarySidebar, panel, workbench } = setup();
    workbench.openView("backlinks");
    workbench.moveView("search", "panel");
    expect(testWindow.listenerCount("resize")).toBe(1);

    workbench.destroy();

    expect(testWindow.listenerCount("resize")).toBe(0);
    expect((secondarySidebar as unknown as TestElement).children).toHaveLength(0);
    expect((panel as unknown as TestElement).children).toHaveLength(0);
  });

  it("restores and persists one clamped Outline size on pointer release", () => {
    const { primarySidebar, workbench, onDidChange } = setup();
    const restored = workbench.snapshot();
    restored.views.outline.size = 144;
    workbench.restore(restored);
    onDidChange.mockClear();

    const root = primarySidebar as unknown as TestElement;
    const outline = viewById(root, "outline");
    const resizers = byClass(root, "outline-view-resizer");
    expect(resizers).toHaveLength(1);
    const resizer = resizers[0];
    expect(resizer.getAttribute("role")).toBe("separator");
    expect(resizer.getAttribute("aria-orientation")).toBe("horizontal");
    expect(resizer.getAttribute("aria-valuemin")).toBe("64");
    expect(resizer.getAttribute("aria-valuemax")).toBe("600");
    expect(resizer.getAttribute("aria-valuenow")).toBe("144");
    expect(outline.style["--outline-height"]).toBe("144px");

    resizer.dispatch("pointerdown", { button: 0, pointerId: 2, clientY: 100 });
    testWindow.dispatch("pointermove", { clientY: -1000 });

    expect(workbench.snapshot().views.outline.size).toBe(600);
    expect(outline.style["--outline-height"]).toBe("600px");
    expect(resizer.getAttribute("aria-valuenow")).toBe("600");
    expect(onDidChange).not.toHaveBeenCalled();

    testWindow.dispatch("pointerup");

    expect(onDidChange).toHaveBeenCalledTimes(1);
    expect(onDidChange.mock.calls[0][0].views.outline.size).toBe(600);
  });
});
