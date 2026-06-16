import { renderBody } from "../export/render";

export interface SplitPreview {
  element: HTMLElement;
  update(markdown: string): void;
  destroy(): void;
}

export function mountSplitPreview(parent: HTMLElement): SplitPreview {
  const element = document.createElement("div");
  element.className = "split-preview";
  parent.appendChild(element);

  let seq = 0;
  let timer: number | undefined;

  function update(markdown: string): void {
    if (timer !== undefined) window.clearTimeout(timer);
    const id = ++seq;
    timer = window.setTimeout(() => {
      timer = undefined;
      void renderBody(markdown).then((html) => {
        if (id === seq) element.innerHTML = html;
      });
    }, 120);
  }

  function destroy(): void {
    seq++;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = undefined;
    element.remove();
  }

  return { element, update, destroy };
}
