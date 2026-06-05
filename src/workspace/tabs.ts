export interface Tab { id: string; path: string | null; savedText: string; currentText: string; }
export interface TabsState { tabs: Tab[]; activeId: string | null; }

let counter = 0;
function newId(): string { counter += 1; return "t" + counter; }

export function emptyTabs(): TabsState { return { tabs: [], activeId: null }; }
export function activeTab(s: TabsState): Tab | null { return s.tabs.find((t) => t.id === s.activeId) ?? null; }
export function tabDirty(t: Tab): boolean { return t.currentText !== t.savedText; }

export function openOrFocus(s: TabsState, path: string, text: string): TabsState {
  const existing = s.tabs.find((t) => t.path === path);
  if (existing) return { ...s, activeId: existing.id };
  const tab: Tab = { id: newId(), path, savedText: text, currentText: text };
  return { tabs: [...s.tabs, tab], activeId: tab.id };
}

export function newUntitled(s: TabsState): TabsState {
  const tab: Tab = { id: newId(), path: null, savedText: "", currentText: "" };
  return { tabs: [...s.tabs, tab], activeId: tab.id };
}

export function setActive(s: TabsState, id: string): TabsState { return { ...s, activeId: id }; }

export function updateActiveText(s: TabsState, text: string): TabsState {
  return { ...s, tabs: s.tabs.map((t) => (t.id === s.activeId ? { ...t, currentText: text } : t)) };
}

/** 저장 스냅샷: savedText만 갱신(+path). currentText는 유지(TOCTOU 안전). */
export function markActiveSaved(s: TabsState, path: string, savedText: string): TabsState {
  return { ...s, tabs: s.tabs.map((t) => (t.id === s.activeId ? { ...t, path, savedText } : t)) };
}

export function closeTab(s: TabsState, id: string): TabsState {
  const idx = s.tabs.findIndex((t) => t.id === id);
  if (idx < 0) return s;
  const tabs = s.tabs.filter((t) => t.id !== id);
  let activeId = s.activeId;
  if (s.activeId === id) activeId = (tabs[idx] ?? tabs[idx - 1])?.id ?? null;
  return { tabs, activeId };
}

export function nextTabId(s: TabsState): string | null {
  if (s.tabs.length === 0) return null;
  const i = s.tabs.findIndex((t) => t.id === s.activeId);
  return s.tabs[(i + 1) % s.tabs.length].id;
}

export function prevTabId(s: TabsState): string | null {
  if (s.tabs.length === 0) return null;
  const i = s.tabs.findIndex((t) => t.id === s.activeId);
  return s.tabs[(i - 1 + s.tabs.length) % s.tabs.length].id;
}

/** 1-based: nthTabId(s, 1) is the first tab; out of range → null. */
export function nthTabId(s: TabsState, n: number): string | null {
  return s.tabs[n - 1]?.id ?? null;
}
