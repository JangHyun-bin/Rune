import { readFile } from "node:fs/promises";

const settingsPath = process.env.RUNE_WDIO_SETTINGS_PATH;
const hotExitPath = process.env.RUNE_WDIO_HOT_EXIT_PATH;

if (!settingsPath || !hotExitPath) {
  throw new Error("RUNE_WDIO_SETTINGS_PATH and RUNE_WDIO_HOT_EXIT_PATH are required");
}

const readJson = async (path, label) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label} fixture at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const settings = await readJson(settingsPath, "settings");
const hotExit = await readJson(hotExitPath, "Hot Exit");
const windows = Array.isArray(settings?.viewWindowLayout?.windows)
  ? settings.viewWindowLayout.windows
  : [];
const panes = Array.isArray(hotExit?.panes) ? hotExit.panes : [];
const dirtyTabs = panes.flatMap((pane) => Array.isArray(pane?.tabs) ? pane.tabs : []);
const summary = {
  viewWindowLayout: {
    version: settings?.viewWindowLayout?.version ?? null,
    sessionState: settings?.viewWindowLayout?.sessionState ?? null,
    windows: windows.map((window) => ({
      containerId: window?.containerId ?? null,
      groupId: window?.groupId ?? null,
      activeViewId: window?.activeViewId ?? null,
      bounds: window?.bounds ?? null,
      monitor: window?.monitor ?? null,
    })),
  },
  hotExit: {
    version: hotExit?.version ?? null,
    paneCount: panes.length,
    dirtyTabCount: dirtyTabs.length,
    hasDirtyBufferSentinel: JSON.stringify(hotExit).includes("RC dirty buffer sentinel"),
  },
};

console.log(`Workbench recovery fixture: ${JSON.stringify(summary)}`);

if (windows.length !== 1) {
  throw new Error(`Expected one persisted detached window before restart, found ${windows.length}`);
}
const bounds = windows[0]?.bounds;
if (!bounds || !Number.isFinite(bounds.width) || bounds.width < 200
  || !Number.isFinite(bounds.height) || bounds.height < 120) {
  throw new Error(`Expected valid persisted detached-window bounds before restart, found ${JSON.stringify(bounds ?? null)}`);
}
if (!summary.hotExit.hasDirtyBufferSentinel) {
  throw new Error("Expected the dirty editor buffer in the Hot Exit fixture before restart");
}
