import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition, PhysicalSize, availableMonitors, primaryMonitor } from "@tauri-apps/api/window";
import type { ViewWindowAdapter, ViewWindowHandle } from "./viewWindowHost";

export const tauriViewWindowAdapter: ViewWindowAdapter = {
  async create(label, options): Promise<ViewWindowHandle> {
    const { bounds, ...windowOptions } = options;
    const window = new WebviewWindow(label, windowOptions);
    await new Promise<void>((resolve, reject) => {
      void window.once("tauri://created", () => resolve());
      void window.once("tauri://error", (event) => reject(new Error(String(event.payload))));
    });
    if (bounds) {
      try {
        await window.setSize(new PhysicalSize(bounds.width, bounds.height));
        await window.setPosition(new PhysicalPosition(bounds.x, bounds.y));
      } catch (error) {
        await window.close().catch(() => {});
        throw error;
      }
    }
    return {
      label,
      close: () => window.close(),
      focus: () => window.setFocus(),
      onClosed(listener) {
        let active = true;
        void window.once("tauri://destroyed", () => { if (active) listener(); });
        return () => { active = false; };
      },
      async capture() {
        const [position, size, monitors] = await Promise.all([window.outerPosition(), window.outerSize(), availableMonitors()]);
        const center = { x: position.x + size.width / 2, y: position.y + size.height / 2 };
        const monitor = monitors.find((item) => center.x >= item.workArea.position.x && center.y >= item.workArea.position.y
          && center.x < item.workArea.position.x + item.workArea.size.width
          && center.y < item.workArea.position.y + item.workArea.size.height) ?? monitors[0];
        const workArea = monitor?.workArea;
        return {
          bounds: { x: position.x, y: position.y, width: size.width, height: size.height },
          monitor: {
            name: monitor?.name ?? null,
            scaleFactor: monitor?.scaleFactor ?? 1,
            x: workArea?.position.x ?? 0,
            y: workArea?.position.y ?? 0,
            width: workArea?.size.width ?? size.width,
            height: workArea?.size.height ?? size.height,
          },
        };
      },
      async onGeometryChanged(listener) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const notify = () => { if (timer) clearTimeout(timer); timer = setTimeout(listener, 150); };
        const [stopMove, stopResize] = await Promise.all([window.onMoved(notify), window.onResized(notify)]);
        return () => { if (timer) clearTimeout(timer); stopMove(); stopResize(); };
      },
    };
  },
  emitTo,
  async listen(event, listener) {
    return listen(event, ({ payload }) => listener(payload));
  },
  async screen() {
    const [monitors, primary] = await Promise.all([availableMonitors(), primaryMonitor()]);
    return {
      primaryName: primary?.name ?? null,
      monitors: monitors.map((monitor) => ({
        name: monitor.name,
        scaleFactor: monitor.scaleFactor,
        workArea: {
          x: monitor.workArea.position.x,
          y: monitor.workArea.position.y,
          width: monitor.workArea.size.width,
          height: monitor.workArea.size.height,
        },
      })),
    };
  },
};
