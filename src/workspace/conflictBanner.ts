export interface ConflictBanner { show(): void; hide(): void; }

export function mountConflictBanner(
  container: HTMLElement,
  handlers: { onReload: () => void; onKeep: () => void },
): ConflictBanner {
  const bar = document.createElement("div");
  bar.className = "conflict-banner hidden";
  const msg = document.createElement("span");
  msg.className = "cb-msg";
  msg.textContent = "이 파일이 디스크에서 변경되었습니다.";
  const reload = document.createElement("button");
  reload.textContent = "디스크 버전 불러오기";
  const keep = document.createElement("button");
  keep.textContent = "내 변경 유지";
  bar.append(msg, reload, keep);
  container.prepend(bar);
  const show = () => bar.classList.remove("hidden");
  const hide = () => bar.classList.add("hidden");
  reload.addEventListener("click", () => { hide(); handlers.onReload(); });
  keep.addEventListener("click", () => { hide(); handlers.onKeep(); });
  return { show, hide };
}
