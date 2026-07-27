import type { WorkbenchContainerId, WorkbenchViewId } from "./workbenchLayout";

export interface WorkbenchView {
  element: HTMLElement;
  focus?(): void;
  relabel?(): void;
  dispose(): void;
}

export interface ViewContainerContribution {
  id: WorkbenchContainerId;
  titleKey: string;
  icon: string;
  order: number;
}

export interface ViewContribution {
  id: WorkbenchViewId;
  titleKey: string;
  defaultContainerId: WorkbenchContainerId;
  order: number;
  create(): WorkbenchView;
}

export interface ViewRegistry {
  registerContainer(value: ViewContainerContribution): void;
  registerView(value: ViewContribution): void;
  containers(): ViewContainerContribution[];
  views(containerId: WorkbenchContainerId): ViewContribution[];
  view(id: WorkbenchViewId): ViewContribution;
  resolveView(id: WorkbenchViewId): WorkbenchView;
  relabel(): void;
  dispose(): void;
}

export function createViewRegistry(): ViewRegistry {
  const containerContributions = new Map<WorkbenchContainerId, ViewContainerContribution>();
  const viewContributions = new Map<WorkbenchViewId, ViewContribution>();
  const createdViews = new Map<WorkbenchViewId, WorkbenchView>();
  let disposed = false;
  const byOrderThenId = <T extends { id: string; order: number }>(a: T, b: T) => a.order - b.order || a.id.localeCompare(b.id);

  return {
    registerContainer(value) {
      if (containerContributions.has(value.id)) throw new Error(`Duplicate view container: ${value.id}`);
      containerContributions.set(value.id, value);
    },
    registerView(value) {
      if (viewContributions.has(value.id)) throw new Error(`Duplicate view: ${value.id}`);
      viewContributions.set(value.id, value);
    },
    containers() {
      return [...containerContributions.values()].sort(byOrderThenId);
    },
    views(containerId) {
      return [...viewContributions.values()].filter((value) => value.defaultContainerId === containerId).sort(byOrderThenId);
    },
    view(id) {
      const contribution = viewContributions.get(id);
      if (!contribution) throw new Error(`Unknown view: ${id}`);
      return contribution;
    },
    resolveView(id) {
      let instance = createdViews.get(id);
      if (!instance) {
        instance = this.view(id).create();
        createdViews.set(id, instance);
      }
      return instance;
    },
    relabel() {
      for (const view of createdViews.values()) view.relabel?.();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const view of createdViews.values()) view.dispose();
    },
  };
}
