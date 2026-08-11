import { describe, expect, it } from "vitest";
import type { DockSurface, DockZone, LogicalRect } from "./dockTypes";
import {
  hitDockZone,
  logicalRectForElement,
  measureDetachedDockSurface,
  measureDetachedDockTreeSurface,
  publishDetachedDockSurface,
  toPhysicalScreenRect,
} from "./dockGeometry";
import type { NativeDockWindowMetrics } from "./tauriDockDragAdapter";

const metrics = (scaleFactor: number): NativeDockWindowMetrics => ({
  windowLabel: "main",
  windowInnerOrigin: { x: -120, y: -80 },
  webviewOffset: { x: 20, y: 30 },
  innerOrigin: { x: -100, y: -50 },
  scaleFactor,
});

const logical: LogicalRect = { left: 8, top: 4, width: 20, height: 12 };

describe("dock geometry", () => {
  it.each([
    [1, { x: -92, y: -46, width: 20, height: 12 }],
    [1.25, { x: -90, y: -45, width: 25, height: 15 }],
    [1.5, { x: -88, y: -44, width: 30, height: 18 }],
    [2, { x: -84, y: -42, width: 40, height: 24 }],
  ])("converts logical rectangles at scale factor %s", (scaleFactor, expected) => {
    expect(toPhysicalScreenRect(logical, metrics(scaleFactor))).toEqual(expected);
  });

  it("rounds physical boundaries only after converting both edges", () => {
    expect(toPhysicalScreenRect(
      { left: 0.4, top: 0.4, width: 0.4, height: 0.4 },
      { ...metrics(1.25), innerOrigin: { x: 0, y: 0 } },
    )).toEqual({ x: 1, y: 1, width: 0, height: 0 });
  });

  it("selects the highest-priority overlapping target deterministically", () => {
    const zones: DockZone[] = [
      {
        id: "group-center",
        rect: { left: 0, top: 0, width: 100, height: 100 },
        target: { kind: "combine", windowLabel: "main", containerId: "explorer", groupId: "group" },
        priority: 10,
      },
      {
        id: "group-left",
        rect: { left: 0, top: 0, width: 30, height: 100 },
        target: {
          kind: "split",
          windowLabel: "main",
          containerId: "explorer",
          groupId: "group",
          direction: "row",
          side: "before",
        },
        priority: 20,
      },
    ];
    const surface: DockSurface = { windowLabel: "main", revision: 7, metrics: metrics(1), zones };

    expect(hitDockZone(surface, { x: -90, y: -20 })?.id).toBe("group-left");
    expect(hitDockZone(surface, { x: -40, y: -20 })?.id).toBe("group-center");
  });

  it("uses zone id as the stable tie-break and ignores zero-area zones", () => {
    const target = { kind: "container", windowLabel: "main", containerId: "panel", index: 0 } as const;
    const surface: DockSurface = {
      windowLabel: "main",
      revision: 1,
      metrics: { ...metrics(1), innerOrigin: { x: 0, y: 0 } },
      zones: [
        { id: "z-zone", rect: { left: 0, top: 0, width: 10, height: 10 }, target, priority: 5 },
        { id: "a-zone", rect: { left: 0, top: 0, width: 10, height: 10 }, target, priority: 5 },
        { id: "hidden-width", rect: { left: 0, top: 0, width: 0, height: 10 }, target, priority: 100 },
        { id: "hidden-height", rect: { left: 0, top: 0, width: 10, height: 0 }, target, priority: 100 },
      ],
    };

    expect(hitDockZone(surface, { x: 5, y: 5 })?.id).toBe("a-zone");
    expect(hitDockZone(surface, { x: 15, y: 5 })).toBeNull();
  });

  it("does not publish hidden or zero-sized DOM elements", () => {
    const visible = {
      hidden: false,
      getAttribute: () => null,
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 30, height: 40 }),
    } as unknown as HTMLElement;
    const hidden = { ...visible, hidden: true } as HTMLElement;
    const ariaHidden = { ...visible, getAttribute: () => "true" } as HTMLElement;
    const zero = {
      ...visible,
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 0, height: 40 }),
    } as unknown as HTMLElement;

    expect(logicalRectForElement(visible)).toEqual({ left: 10, top: 20, width: 30, height: 40 });
    expect(logicalRectForElement(hidden)).toBeNull();
    expect(logicalRectForElement(ariaHidden)).toBeNull();
    expect(logicalRectForElement(zero)).toBeNull();
  });

  it("publishes only tab insertion and center-combine zones for a detached group", () => {
    const element = (left: number, top: number, width: number, height: number) => ({
      hidden: false,
      classList: { contains: () => false },
      getAttribute: () => null,
      getBoundingClientRect: () => ({ left, top, width, height }),
    }) as unknown as HTMLElement;
    const surface = measureDetachedDockSurface({
      windowLabel: "view-3",
      revision: 0,
      metrics: { ...metrics(1.5), windowLabel: "view-3" },
      containerId: "auxiliary",
      groupId: "auxiliary:backlinks",
      groupElement: element(0, 0, 420, 640),
      tabStrip: element(0, 0, 420, 40),
      tabElements: [element(0, 0, 120, 40), element(120, 0, 140, 40)],
    });

    expect(surface.zones.map((zone) => zone.target)).toEqual([
      { kind: "combine", windowLabel: "view-3", containerId: "auxiliary", groupId: "auxiliary:backlinks" },
      { kind: "tabs", windowLabel: "view-3", containerId: "auxiliary", groupId: "auxiliary:backlinks", index: 0 },
      { kind: "tabs", windowLabel: "view-3", containerId: "auxiliary", groupId: "auxiliary:backlinks", index: 1 },
      { kind: "tabs", windowLabel: "view-3", containerId: "auxiliary", groupId: "auxiliary:backlinks", index: 2 },
    ]);
    expect(surface.zones.some((zone) => zone.target.kind === "split")).toBe(false);
  });

  it("publishes a freshly measured detached surface through the supplied boundary", async () => {
    const element = {
      hidden: false,
      classList: { contains: () => false },
      getAttribute: () => null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 200 }),
    } as unknown as HTMLElement;
    const published: DockSurface[] = [];

    const surface = await publishDetachedDockSurface({
      windowLabel: "view-4",
      revision: 2,
      metrics: async () => ({ ...metrics(2), windowLabel: "view-4" }),
      containerId: "explorer",
      groupId: "explorer:outline",
      groupElement: element,
      tabStrip: element,
      tabElements: [element],
      publish: (value) => { published.push(value); },
    });

    expect(published).toEqual([surface]);
    expect(surface).toMatchObject({ windowLabel: "view-4", revision: 2 });
  });

  it("publishes split edges for every group in a restored detached tree", () => {
    const element = (left: number) => ({
      hidden: false,
      classList: { contains: () => false },
      getAttribute: () => null,
      getBoundingClientRect: () => ({ left, top: 0, width: 200, height: 400 }),
    }) as unknown as HTMLElement;
    const first = element(0);
    const second = element(200);
    const surface = measureDetachedDockTreeSurface({
      windowLabel: "view-4",
      revision: 7,
      metrics: { ...metrics(1.25), windowLabel: "view-4" },
      groups: [
        {
          containerId: "explorer",
          groupId: "explorer:workspace",
          groupElement: first,
          tabStrip: first,
          tabElements: [first],
        },
        {
          containerId: "explorer",
          groupId: "explorer:outline",
          groupElement: second,
          tabStrip: second,
          tabElements: [second],
        },
      ],
    });

    const splitTargets = surface.zones.filter((zone) => zone.target.kind === "split");
    expect(splitTargets).toHaveLength(8);
    expect(new Set(splitTargets.map((zone) => zone.target.kind === "split" && zone.target.groupId))).toEqual(new Set([
      "explorer:workspace",
      "explorer:outline",
    ]));
  });
});
