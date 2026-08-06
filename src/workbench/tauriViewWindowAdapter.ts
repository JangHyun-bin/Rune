import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { ViewWindowAdapter, ViewWindowHandle } from "./viewWindowHost";

export const tauriViewWindowAdapter: ViewWindowAdapter = {
  async create(label, options): Promise<ViewWindowHandle> {
    const window = new WebviewWindow(label, options);
    await new Promise<void>((resolve, reject) => {
      void window.once("tauri://created", () => resolve());
      void window.once("tauri://error", (event) => reject(new Error(String(event.payload))));
    });
    return {
      label,
      close: () => window.close(),
      focus: () => window.setFocus(),
      onClosed(listener) {
        let active = true;
        void window.once("tauri://destroyed", () => { if (active) listener(); });
        return () => { active = false; };
      },
    };
  },
  emitTo,
  async listen(event, listener) {
    return listen(event, ({ payload }) => listener(payload));
  },
};
