import type { PathChangePlan, Result, WorkspaceIndexStats } from "../ipc/bindings";
import { samePath } from "./paths";

export interface PathChangeDependencies {
  plan(root: string, source: string, destination: string): Promise<Result<PathChangePlan>>;
  apply(root: string, source: string, destination: string, planId: string): Promise<Result<WorkspaceIndexStats>>;
  dirtyPaths(): string[];
  preview(plan: PathChangePlan): Promise<boolean>;
  synchronize(plan: PathChangePlan): Promise<void>;
  showError(message: string): void;
  dirtyMessage: string;
}

export type PathChangeResult = "applied" | "blocked" | "canceled" | "error";

export async function runPathChange(
  root: string,
  source: string,
  destination: string,
  dependencies: PathChangeDependencies,
): Promise<PathChangeResult> {
  const planned = await dependencies.plan(root, source, destination);
  if (planned.status === "error") {
    dependencies.showError(planned.error);
    return "error";
  }
  const plan = planned.data;
  const affected = [
    ...plan.pathChanges.map((change) => change.from),
    ...plan.edits.map((edit) => edit.path),
  ];
  if (dependencies.dirtyPaths().some((dirty) => affected.some((path) => samePath(path, dirty)))) {
    dependencies.showError(dependencies.dirtyMessage);
    return "blocked";
  }
  if (!(await dependencies.preview(plan))) return "canceled";

  const applied = await dependencies.apply(root, source, destination, plan.planId);
  if (applied.status === "error") {
    dependencies.showError(applied.error);
    return "error";
  }
  await dependencies.synchronize(plan);
  return "applied";
}
