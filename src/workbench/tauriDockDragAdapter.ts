import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";

export interface NativeDockWindowMetrics {
  windowLabel: string;
  windowInnerOrigin: { x: number; y: number };
  windowOuterOrigin: { x: number; y: number };
  frameInsets: { x: number; y: number };
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
  outerPosition(): Promise<{ x: number; y: number }>;
  innerSize(): Promise<{ width: number; height: number }>;
  outerSize(): Promise<{ width: number; height: number }>;
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
    outerPosition: () => window.outerPosition(),
    innerSize: () => window.innerSize(),
    outerSize: () => window.outerSize(),
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
      const [windowInnerOrigin, windowOuterOrigin, innerSize, outerSize, webviewOffset, scaleFactor] = await Promise.all([
        facade.innerPosition(),
        facade.outerPosition(),
        facade.innerSize(),
        facade.outerSize(),
        facade.webviewPosition(),
        facade.scaleFactor(),
      ]);
      const sideInset = Math.max(0, Math.floor((outerSize.width - innerSize.width) / 2));
      const frameInsets = {
        x: sideInset,
        y: Math.max(0, outerSize.height - innerSize.height - sideInset),
      };
      return {
        windowLabel: facade.windowLabel(),
        windowInnerOrigin,
        windowOuterOrigin,
        frameInsets,
        webviewOffset,
        innerOrigin: {
          x: windowOuterOrigin.x + frameInsets.x + webviewOffset.x,
          y: windowOuterOrigin.y + frameInsets.y + webviewOffset.y,
        },
        scaleFactor,
      };
    },
    cursor: () => facade.cursorPosition(),
    startNativeWindowDrag: () => facade.startDragging(),
    onWindowMoved: (listener) => facade.onMoved(listener),
  };
}
