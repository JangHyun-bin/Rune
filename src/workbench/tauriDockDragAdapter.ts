import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";

export interface NativeDockWindowMetrics {
  windowLabel: string;
  innerOrigin: { x: number; y: number };
  scaleFactor: number;
}

export interface NativeDockDragAdapter {
  metrics(): Promise<NativeDockWindowMetrics>;
  cursor(): Promise<{ x: number; y: number }>;
  startNativeWindowDrag(): Promise<void>;
  onWindowMoved(listener: () => void): Promise<() => void>;
}

export interface TauriDockDragFacade {
  windowLabel(): string;
  innerPosition(): Promise<{ x: number; y: number }>;
  scaleFactor(): Promise<number>;
  cursorPosition(): Promise<{ x: number; y: number }>;
  startDragging(): Promise<void>;
  onMoved(listener: () => void): Promise<() => void>;
}

export function logicalClientPointToPhysicalScreen(
  metrics: NativeDockWindowMetrics,
  point: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: metrics.innerOrigin.x + point.x * metrics.scaleFactor,
    y: metrics.innerOrigin.y + point.y * metrics.scaleFactor,
  };
}

function nativeFacade(): TauriDockDragFacade {
  const window = getCurrentWindow();
  return {
    windowLabel: () => window.label,
    innerPosition: () => window.innerPosition(),
    scaleFactor: () => window.scaleFactor(),
    cursorPosition,
    startDragging: () => window.startDragging(),
    onMoved: (listener) => window.onMoved(() => listener()),
  };
}

export function createTauriDockDragAdapter(
  facade: TauriDockDragFacade = nativeFacade(),
): NativeDockDragAdapter {
  return {
    async metrics() {
      const [innerOrigin, scaleFactor] = await Promise.all([
        facade.innerPosition(),
        facade.scaleFactor(),
      ]);
      return { windowLabel: facade.windowLabel(), innerOrigin, scaleFactor };
    },
    cursor: () => facade.cursorPosition(),
    startNativeWindowDrag: () => facade.startDragging(),
    onWindowMoved: (listener) => facade.onMoved(listener),
  };
}
