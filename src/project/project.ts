export interface RuneProject {
  version: 1;
  title: string;
  files: string[];
}

export interface ProjectIssue {
  kind: "duplicate" | "missing";
  path: string;
}

function normalizeProjectPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)
    || segments.some((segment) => !segment || segment === "." || segment === "..")
    || !/\.(md|markdown)$/i.test(normalized)) {
    throw new Error(`Invalid project file path: ${path}`);
  }
  return normalized;
}

export function createProject(title: string, files: string[] = []): RuneProject {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) throw new Error("Project title is required");
  return { version: 1, title: normalizedTitle, files: files.map(normalizeProjectPath) };
}

export function parseProject(source: string): RuneProject {
  const value: unknown = JSON.parse(source);
  if (!value || typeof value !== "object") throw new Error("Invalid project manifest");
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.title !== "string" || !Array.isArray(record.files)
    || record.files.some((path) => typeof path !== "string")) {
    throw new Error("Invalid project manifest");
  }
  return createProject(record.title, record.files as string[]);
}

export function serializeProject(project: RuneProject): string {
  return `${JSON.stringify(createProject(project.title, project.files), null, 2)}\n`;
}

export function validateProject(project: RuneProject, availableFiles: string[]): ProjectIssue[] {
  const available = new Set(availableFiles.map(normalizeProjectPath));
  const seen = new Set<string>();
  const issues: ProjectIssue[] = [];
  for (const path of project.files) {
    if (!available.has(path)) issues.push({ kind: "missing", path });
    if (seen.has(path)) issues.push({ kind: "duplicate", path });
    seen.add(path);
  }
  return issues;
}

export function setProjectFileIncluded(project: RuneProject, path: string, included: boolean): RuneProject {
  const normalized = normalizeProjectPath(path);
  const files = included
    ? project.files.includes(normalized) ? [...project.files] : [...project.files, normalized]
    : project.files.filter((file) => file !== normalized);
  return { ...project, files };
}

export function moveProjectFile(project: RuneProject, path: string, offset: -1 | 1): RuneProject {
  const normalized = normalizeProjectPath(path);
  const from = project.files.indexOf(normalized);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= project.files.length) return { ...project, files: [...project.files] };
  const files = [...project.files];
  [files[from], files[to]] = [files[to], files[from]];
  return { ...project, files };
}
