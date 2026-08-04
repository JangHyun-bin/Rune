import { commands } from "../ipc/bindings";
import { serializeProject, type RuneProject } from "./project";

export type ProjectManifestLoadResult = { status: "ok"; source: string | null } | { status: "error" };
export type ProjectManifestSaveResult = { status: "saved"; source: string } | { status: "conflict" | "error" };

export async function loadProjectManifest(path: string): Promise<ProjectManifestLoadResult> {
  const exists = await commands.pathExists(path);
  if (exists.status === "error") return { status: "error" };
  if (!exists.data) return { status: "ok", source: null };
  const contents = await commands.readFile(path);
  return contents.status === "ok" ? { status: "ok", source: contents.data } : { status: "error" };
}

export async function saveProjectManifest(
  path: string,
  project: RuneProject,
  expectedSource: string | null,
): Promise<ProjectManifestSaveResult> {
  const source = serializeProject(project);
  const saved = await commands.writeFileIfUnchanged(path, expectedSource, source);
  if (saved.status === "error") return { status: "error" };
  return saved.data ? { status: "saved", source } : { status: "conflict" };
}
