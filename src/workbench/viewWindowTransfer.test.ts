import { describe, expect, it } from "vitest";
import {
  normalizeDockProtocolMessage,
  normalizeViewWindowTransfer,
  type DockProtocolMessage,
  type ViewWindowTransfer,
} from "./viewWindowTransfer";

const transfer: ViewWindowTransfer = {
  version: 2,
  transferId: "transfer-1",
  sourceWindowLabel: "main",
  targetWindowLabel: "view-1",
  groups: [{
    containerId: "explorer",
    group: {
      id: "explorer:workspace",
      viewIds: ["workspace", "outline"],
      activeViewId: "outline",
    },
  }],
  root: { type: "group", groupId: "explorer:workspace" },
  activeGroupId: "explorer:workspace",
  presentation: {
    theme: "dark",
    uiScale: 1.1,
    locale: "ko",
  },
};

describe("view window transfer", () => {
  it("clones a valid native view-group transfer", () => {
    const normalized = normalizeViewWindowTransfer(structuredClone(transfer));

    expect(normalized).toEqual(transfer);
    expect(normalized).not.toBe(transfer);
    expect(normalized?.groups).not.toBe(transfer.groups);
    expect(normalized?.groups[0].group).not.toBe(transfer.groups[0].group);
  });

  it("rejects duplicate views, invalid active views, labels, and presentation state", () => {
    expect(normalizeViewWindowTransfer({
      ...transfer,
      groups: [{ ...transfer.groups[0], group: { ...transfer.groups[0].group, viewIds: ["workspace", "workspace"] } }],
    })).toBeNull();
    expect(normalizeViewWindowTransfer({
      ...transfer,
      groups: [{ ...transfer.groups[0], group: { ...transfer.groups[0].group, activeViewId: "search" } }],
    })).toBeNull();
    expect(normalizeViewWindowTransfer({ ...transfer, targetWindowLabel: "unsafe label" })).toBeNull();
    expect(normalizeViewWindowTransfer({
      ...transfer,
      presentation: { ...transfer.presentation, uiScale: Number.NaN },
    })).toBeNull();
    expect(normalizeViewWindowTransfer({ ...transfer, documentBody: "# private draft" })).toBeNull();
  });

  it("normalizes an ordered multi-group detached tree", () => {
    const multi: ViewWindowTransfer = {
      ...structuredClone(transfer),
      groups: [
        transfer.groups[0],
        {
          containerId: "explorer",
          group: { id: "explorer:outline", viewIds: ["tags"], activeViewId: "tags" },
        },
      ],
      root: {
        type: "split",
        direction: "row",
        children: [
          { type: "group", groupId: "explorer:workspace" },
          { type: "group", groupId: "explorer:outline" },
        ],
        ratios: [0.45, 0.55],
      },
      activeGroupId: "explorer:outline",
    };

    expect(normalizeViewWindowTransfer(multi)).toEqual(multi);
  });

  const start: DockProtocolMessage = {
    type: "dock:start",
    version: 2,
    sessionId: "view-1:17",
    sourceWindowLabel: "view-1",
    payload: {
      kind: "view",
      viewId: "outline",
      source: { windowLabel: "view-1", containerId: "explorer", groupId: "explorer:outline" },
    },
    point: { x: -640, y: 360 },
  };

  it("normalizes every exact protocol v2 message shape", () => {
    const messages: DockProtocolMessage[] = [
      start,
      {
        type: "dock:surface",
        version: 2,
        sessionId: start.sessionId,
        sourceWindowLabel: "view-2",
        surface: {
          windowLabel: "view-2",
          revision: 8,
          metrics: {
            windowLabel: "view-2",
            windowInnerOrigin: { x: 100, y: 200 },
            webviewOffset: { x: 0, y: 28 },
            innerOrigin: { x: 100, y: 228 },
            scaleFactor: 1.25,
          },
          viewport: { left: 0, top: 0, width: 420, height: 640 },
          zones: [{
            id: "group:auxiliary:auxiliary:backlinks:center",
            rect: { left: 0, top: 0, width: 420, height: 640 },
            target: { kind: "combine", windowLabel: "view-2", containerId: "auxiliary", groupId: "auxiliary:backlinks" },
            priority: 10,
          }],
        },
      },
      {
        type: "dock:preview",
        version: 2,
        sessionId: start.sessionId,
        sourceWindowLabel: "main",
        targetWindowLabel: "view-2",
        payload: start.payload,
        zone: null,
        point: { x: 120, y: 240 },
      },
      {
        type: "dock:commit",
        version: 2,
        sessionId: start.sessionId,
        sourceWindowLabel: "main",
        target: { kind: "tabs", windowLabel: "main", containerId: "panel", groupId: "panel:references", index: 1 },
        revision: 9,
      },
      {
        type: "dock:result",
        version: 2,
        sessionId: start.sessionId,
        sourceWindowLabel: "view-2",
        ok: true,
        revision: 9,
        error: null,
      },
      {
        type: "dock:cancel",
        version: 2,
        sessionId: start.sessionId,
        sourceWindowLabel: "main",
        reason: "escape",
      },
    ];

    for (const message of messages) {
      const normalized = normalizeDockProtocolMessage(structuredClone(message), {
        sessionId: start.sessionId,
        sourceWindowLabel: message.sourceWindowLabel,
      });
      expect(normalized).toEqual(message);
      expect(normalized).not.toBe(message);
    }
  });

  it("rejects unknown keys, unsupported views, invalid labels, non-finite coordinates, duplicates, and session mismatches", () => {
    expect(normalizeDockProtocolMessage({ ...start, unexpected: true })).toBeNull();
    expect(normalizeDockProtocolMessage({
      ...start,
      payload: { ...start.payload, viewId: "editor" },
    })).toBeNull();
    expect(normalizeDockProtocolMessage({ ...start, sourceWindowLabel: "unsafe label" })).toBeNull();
    expect(normalizeDockProtocolMessage({ ...start, point: { x: Number.NaN, y: 1 } })).toBeNull();
    expect(normalizeDockProtocolMessage({
      ...start,
      payload: {
        kind: "group",
        viewIds: ["outline", "outline"],
        activeViewId: "outline",
        source: { windowLabel: "view-1", containerId: "explorer", groupId: "explorer:outline" },
      },
    })).toBeNull();
    expect(normalizeDockProtocolMessage(start, { sessionId: "view-1:18", sourceWindowLabel: "view-1" })).toBeNull();
    expect(normalizeDockProtocolMessage(start, { sessionId: start.sessionId, sourceWindowLabel: "view-2" })).toBeNull();
    expect(normalizeDockProtocolMessage({
      ...start,
      payload: {
        ...start.payload,
        source: { ...start.payload.source, unexpected: true },
      },
    })).toBeNull();
    expect(normalizeDockProtocolMessage({
      type: "dock:commit",
      version: 2,
      sessionId: start.sessionId,
      sourceWindowLabel: "main",
      target: { kind: "combine", windowLabel: "unsafe label", containerId: "explorer", groupId: "explorer:workspace" },
      revision: 9,
    })).toBeNull();
    expect(normalizeDockProtocolMessage({
      type: "dock:commit",
      version: 2,
      sessionId: start.sessionId,
      sourceWindowLabel: "main",
      target: { kind: "new-window", bounds: { x: 0, y: 0, width: 420, height: 640, unexpected: true } },
      revision: 9,
    })).toBeNull();
    expect(normalizeDockProtocolMessage({
      type: "dock:surface",
      version: 2,
      sessionId: start.sessionId,
      sourceWindowLabel: "view-2",
      surface: {
        windowLabel: "view-2",
        revision: 8,
        metrics: {
          windowLabel: "view-2",
          windowInnerOrigin: { x: 0, y: 0 },
          webviewOffset: { x: 0, y: 0 },
          innerOrigin: { x: Number.POSITIVE_INFINITY, y: 0 },
          scaleFactor: 1,
        },
        zones: [],
      },
    })).toBeNull();
  });
});
