import { renderBody } from "../export/render";

export interface SplitPreview {
  element: HTMLElement;
  bindSourceScroller(sourceScroller: HTMLElement): void;
  update(markdown: string): void;
  destroy(): void;
}

type ScrollBox = Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">;

export function scrollRatio(element: ScrollBox): number {
  const maxScroll = element.scrollHeight - element.clientHeight;
  if (maxScroll <= 0) return 0;
  return Math.min(1, Math.max(0, element.scrollTop / maxScroll));
}

export function scrollTopForRatio(element: Pick<ScrollBox, "scrollHeight" | "clientHeight">, ratio: number): number {
  const maxScroll = element.scrollHeight - element.clientHeight;
  if (maxScroll <= 0) return 0;
  return Math.round(Math.min(1, Math.max(0, ratio)) * maxScroll);
}

export function mountSplitPreview(parent: HTMLElement): SplitPreview {
  const element = document.createElement("div");
  element.className = "split-preview";
  parent.appendChild(element);

  let seq = 0;
  let timer: number | undefined;
  let sourceScroller: HTMLElement | null = null;
  let unbindScroll: (() => void) | null = null;
  let syncingScroll = false;

  function syncScroll(from: HTMLElement, to: HTMLElement): void {
    if (syncingScroll) return;
    syncingScroll = true;
    to.scrollTop = scrollTopForRatio(to, scrollRatio(from));
    window.requestAnimationFrame(() => { syncingScroll = false; });
  }

  function bindSourceScroller(source: HTMLElement): void {
    unbindScroll?.();
    sourceScroller = source;
    const onSourceScroll = () => syncScroll(source, element);
    const onPreviewScroll = () => syncScroll(element, source);
    source.addEventListener("scroll", onSourceScroll, { passive: true });
    element.addEventListener("scroll", onPreviewScroll, { passive: true });
    unbindScroll = () => {
      source.removeEventListener("scroll", onSourceScroll);
      element.removeEventListener("scroll", onPreviewScroll);
      if (sourceScroller === source) sourceScroller = null;
    };
    syncScroll(source, element);
  }

  function update(markdown: string): void {
    if (timer !== undefined) window.clearTimeout(timer);
    const id = ++seq;
    timer = window.setTimeout(() => {
      timer = undefined;
      void renderBody(markdown).then((html) => {
        if (id === seq) {
          element.innerHTML = html;
          if (sourceScroller) syncScroll(sourceScroller, element);
        }
      });
    }, 120);
  }

  function destroy(): void {
    seq++;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    unbindScroll?.();
    unbindScroll = null;
    element.remove();
  }

  return { element, bindSourceScroller, update, destroy };
}
