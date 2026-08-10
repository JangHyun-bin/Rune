import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";

export interface NativeDockWindowMetrics {
  windowLabel: string;
  windowInnerOrigin: { x: number; y: number };
  webviewOffset: { x: number; y: number };
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
  webviewPosition(): Promise<{ x: number; y: number }>;
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
  const webview = getCurrentWebview();
  return {
    windowLabel: () => window.label,
    innerPosition: () => window.innerPosition(),
    webviewPosition: () => webview.position(),
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
      const [windowInnerOrigin, webviewOffset, scaleFactor] = await Promise.all([
        facade.innerPosition(),
        facade.webviewPosition(),
        facade.scaleFactor(),
      ]);
      return {
        windowLabel: facade.windowLabel(),
        windowInnerOrigin,
        webviewOffset,
        innerOrigin: {
          x: windowInnerOrigin.x + webviewOffset.x,
          y: windowInnerOrigin.y + webviewOffset.y,
        },
        scaleFactor,
      };
    },
    cursor: () => facade.cursorPosition(),
    startNativeWindowDrag: () => facade.startDragging(),
    onWindowMoved: (listener) => facade.onMoved(listener),
  };
}
