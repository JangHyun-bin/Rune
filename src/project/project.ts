export type ProjectOutputFormat = "html" | "pdf" | "docx" | "epub";
export type ProjectTheme = "default" | "serif";
export type ProjectPageSize = "A4" | "Letter";

export interface ProjectMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ProjectMetadata {
  author: string;
  subject: string;
  extras: Record<string, unknown>;
}

export interface PublishingProfile {
  id: string;
  name: string;
  format: ProjectOutputFormat;
  outputDirectory: string;
  theme: ProjectTheme;
  pageSize: ProjectPageSize;
  margins: ProjectMargins;
  tableOfContents: boolean;
  tableOfContentsDepth: number;
  pageBreakDocuments: boolean;
  csl: string;
  citationLocale: string;
  metadata: ProjectMetadata;
  extras: Record<string, unknown>;
}

export interface ProjectPublishing {
  profiles: PublishingProfile[];
  activeProfileId: string;
  lastSuccessfulProfileId: string | null;
  extras: Record<string, unknown>;
}

export interface RuneProject {
  version: 2;
  title: string;
  files: string[];
  bibliography: string[];
  publishing: ProjectPublishing;
  extras: Record<string, unknown>;
}

export interface ProjectIssue {
  kind: "duplicate" | "missing";
  path: string;
}

const DEFAULT_MARGINS: ProjectMargins = { top: 18, right: 18, bottom: 18, left: 18 };

export function normalizeProjectPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)
    || segments.some((segment) => !segment || segment === "." || segment === "..")
    || !/\.(md|markdown)$/i.test(normalized)) {
    throw new Error(`Invalid project file path: ${path}`);
  }
  return normalized;
}

export function normalizeOutputDirectory(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/").replace(/\/$/, "");
  if (normalized === ".") return normalized;
  const segments = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)
    || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Invalid publishing output directory: ${path}`);
  }
  return normalized;
}

export function normalizeProjectResourcePath(path: string, extension: ".bib" | ".csl"): string {
  const normalized = path.trim().replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)
    || segments.some((segment) => !segment || segment === "." || segment === "..")
    || !normalized.toLowerCase().endsWith(extension)) {
    throw new Error(`Invalid project resource path: ${path}`);
  }
  return normalized;
}

function stringValue(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) throw new Error(`Invalid ${label}`);
  return allowEmpty ? value.trim() : value.trim();
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value as Record<string, unknown>;
}

function extras(record: Record<string, unknown>, known: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !known.includes(key)));
}

function margin(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 5 || value > 50) throw new Error(`Invalid ${label}`);
  return value;
}

function defaultProfile(name = "Default", id = "default"): PublishingProfile {
  return {
    id,
    name,
    format: "html",
    outputDirectory: "exports",
    theme: "default",
    pageSize: "A4",
    margins: { ...DEFAULT_MARGINS },
    tableOfContents: true,
    tableOfContentsDepth: 3,
    pageBreakDocuments: true,
    csl: "",
    citationLocale: "",
    metadata: { author: "", subject: "", extras: {} },
    extras: {},
  };
}

function parseProfile(value: unknown): PublishingProfile {
  const record = recordValue(value, "publishing profile");
  const margins = recordValue(record.margins, "publishing margins");
  const metadata = recordValue(record.metadata ?? {}, "publishing metadata");
  const format = record.format;
  const theme = record.theme;
  const pageSize = record.pageSize;
  const depth = record.tableOfContentsDepth;
  const cslValue = stringValue(record.csl ?? "", "citation style", true);
  const citationLocale = stringValue(record.citationLocale ?? "", "citation locale", true);
  if (format !== "html" && format !== "pdf" && format !== "docx" && format !== "epub") {
    throw new Error("Invalid publishing format");
  }
  if (theme !== "default" && theme !== "serif") throw new Error("Invalid publishing theme");
  if (pageSize !== "A4" && pageSize !== "Letter") throw new Error("Invalid publishing page size");
  if (typeof record.tableOfContents !== "boolean" || !Number.isInteger(depth) || (depth as number) < 1 || (depth as number) > 6
    || typeof record.pageBreakDocuments !== "boolean") throw new Error("Invalid publishing profile options");
  if (citationLocale && !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(citationLocale)) {
    throw new Error("Invalid citation locale");
  }
  return {
    id: stringValue(record.id, "publishing profile id"),
    name: stringValue(record.name, "publishing profile name"),
    format,
    outputDirectory: normalizeOutputDirectory(stringValue(record.outputDirectory, "publishing output directory")),
    theme,
    pageSize,
    margins: {
      top: margin(margins.top, "top margin"),
      right: margin(margins.right, "right margin"),
      bottom: margin(margins.bottom, "bottom margin"),
      left: margin(margins.left, "left margin"),
    },
    tableOfContents: record.tableOfContents,
    tableOfContentsDepth: depth as number,
    pageBreakDocuments: record.pageBreakDocuments,
    csl: cslValue ? normalizeProjectResourcePath(cslValue, ".csl") : "",
    citationLocale,
    metadata: {
      author: stringValue(metadata.author ?? "", "author", true),
      subject: stringValue(metadata.subject ?? "", "subject", true),
      extras: extras(metadata, ["author", "subject"]),
    },
    extras: extras(record, [
      "id", "name", "format", "outputDirectory", "theme", "pageSize", "margins",
      "tableOfContents", "tableOfContentsDepth", "pageBreakDocuments", "csl", "citationLocale", "metadata",
    ]),
  };
}

function parsePublishing(value: unknown): ProjectPublishing {
  const record = recordValue(value, "publishing settings");
  if (!Array.isArray(record.profiles) || record.profiles.length === 0) throw new Error("Invalid publishing profiles");
  const profiles = record.profiles.map(parseProfile);
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) throw new Error("Duplicate publishing profile id");
  const activeProfileId = stringValue(record.activeProfileId, "active publishing profile");
  const lastSuccessfulProfileId = record.lastSuccessfulProfileId === null
    ? null
    : stringValue(record.lastSuccessfulProfileId, "last successful publishing profile");
  if (!profiles.some((profile) => profile.id === activeProfileId)
    || (lastSuccessfulProfileId !== null && !profiles.some((profile) => profile.id === lastSuccessfulProfileId))) {
    throw new Error("Publishing profile reference is missing");
  }
  return {
    profiles,
    activeProfileId,
    lastSuccessfulProfileId,
    extras: extras(record, ["profiles", "activeProfileId", "lastSuccessfulProfileId"]),
  };
}

function serializeProfile(profile: PublishingProfile): Record<string, unknown> {
  return {
    ...profile.extras,
    id: profile.id,
    name: profile.name,
    format: profile.format,
    outputDirectory: profile.outputDirectory,
    theme: profile.theme,
    pageSize: profile.pageSize,
    margins: { ...profile.margins },
    tableOfContents: profile.tableOfContents,
    tableOfContentsDepth: profile.tableOfContentsDepth,
    pageBreakDocuments: profile.pageBreakDocuments,
    csl: profile.csl,
    citationLocale: profile.citationLocale,
    metadata: { ...profile.metadata.extras, author: profile.metadata.author, subject: profile.metadata.subject },
  };
}

export function createProject(title: string, files: string[] = []): RuneProject {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) throw new Error("Project title is required");
  const profile = defaultProfile();
  return {
    version: 2,
    title: normalizedTitle,
    files: files.map(normalizeProjectPath),
    bibliography: [],
    publishing: { profiles: [profile], activeProfileId: profile.id, lastSuccessfulProfileId: null, extras: {} },
    extras: {},
  };
}

export function parseProject(source: string): RuneProject {
  const record = recordValue(JSON.parse(source) as unknown, "project manifest");
  if (typeof record.title !== "string" || !Array.isArray(record.files)
    || record.files.some((path) => typeof path !== "string")) throw new Error("Invalid project manifest");
  const base = createProject(record.title, record.files as string[]);
  if (record.version === 1) {
    return { ...base, extras: extras(record, ["version", "title", "files"]) };
  }
  if (record.version !== 2) throw new Error("Unsupported project manifest version");
  const bibliography = record.bibliography ?? [];
  if (!Array.isArray(bibliography) || bibliography.some((path) => typeof path !== "string")) {
    throw new Error("Invalid project bibliography");
  }
  return {
    ...base,
    bibliography: (bibliography as string[]).map((path) => normalizeProjectResourcePath(path, ".bib")),
    publishing: parsePublishing(record.publishing),
    extras: extras(record, ["version", "title", "files", "bibliography", "publishing"]),
  };
}

export function serializeProject(project: RuneProject): string {
  const validated = parseProject(JSON.stringify({
    ...project.extras,
    version: 2,
    title: project.title,
    files: project.files,
    bibliography: project.bibliography,
    publishing: {
      ...project.publishing.extras,
      profiles: project.publishing.profiles.map(serializeProfile),
      activeProfileId: project.publishing.activeProfileId,
      lastSuccessfulProfileId: project.publishing.lastSuccessfulProfileId,
    },
  }));
  return `${JSON.stringify({
    ...validated.extras,
    version: validated.version,
    title: validated.title,
    files: validated.files,
    bibliography: validated.bibliography,
    publishing: {
      ...validated.publishing.extras,
      profiles: validated.publishing.profiles.map(serializeProfile),
      activeProfileId: validated.publishing.activeProfileId,
      lastSuccessfulProfileId: validated.publishing.lastSuccessfulProfileId,
    },
  }, null, 2)}\n`;
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

export function updateProjectTitle(project: RuneProject, title: string): RuneProject {
  const normalized = title.trim();
  if (!normalized) throw new Error("Project title is required");
  return { ...project, title: normalized };
}

export function activePublishingProfile(project: RuneProject): PublishingProfile {
  return project.publishing.profiles.find((profile) => profile.id === project.publishing.activeProfileId)
    ?? project.publishing.profiles[0];
}

export function replacePublishingProfile(project: RuneProject, profile: PublishingProfile): RuneProject {
  parseProfile(serializeProfile(profile));
  if (!project.publishing.profiles.some((item) => item.id === profile.id)) throw new Error("Publishing profile is missing");
  return {
    ...project,
    publishing: {
      ...project.publishing,
      profiles: project.publishing.profiles.map((item) => item.id === profile.id ? profile : item),
    },
  };
}

function nextProfileId(project: RuneProject, name: string): string {
  const base = name.toLocaleLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-|-$/g, "") || "profile";
  const ids = new Set(project.publishing.profiles.map((profile) => profile.id));
  let id = base;
  for (let index = 2; ids.has(id); index++) id = `${base}-${index}`;
  return id;
}

export function addPublishingProfile(project: RuneProject, name: string, source?: PublishingProfile): RuneProject {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Publishing profile name is required");
  const profile = source
    ? { ...source, id: nextProfileId(project, trimmed), name: trimmed, margins: { ...source.margins }, metadata: { ...source.metadata, extras: { ...source.metadata.extras } }, extras: { ...source.extras } }
    : { ...defaultProfile(trimmed, nextProfileId(project, trimmed)) };
  return {
    ...project,
    publishing: {
      ...project.publishing,
      profiles: [...project.publishing.profiles, profile],
      activeProfileId: profile.id,
    },
  };
}

export function deletePublishingProfile(project: RuneProject, id: string): RuneProject {
  if (project.publishing.profiles.length === 1) return project;
  const profiles = project.publishing.profiles.filter((profile) => profile.id !== id);
  if (profiles.length === project.publishing.profiles.length) return project;
  return {
    ...project,
    publishing: {
      ...project.publishing,
      profiles,
      activeProfileId: project.publishing.activeProfileId === id ? profiles[0].id : project.publishing.activeProfileId,
      lastSuccessfulProfileId: project.publishing.lastSuccessfulProfileId === id ? null : project.publishing.lastSuccessfulProfileId,
    },
  };
}

export function setActivePublishingProfile(project: RuneProject, id: string): RuneProject {
  if (!project.publishing.profiles.some((profile) => profile.id === id)) throw new Error("Publishing profile is missing");
  return { ...project, publishing: { ...project.publishing, activeProfileId: id } };
}

export function markPublishingSuccessful(project: RuneProject, id: string): RuneProject {
  if (!project.publishing.profiles.some((profile) => profile.id === id)) throw new Error("Publishing profile is missing");
  return { ...project, publishing: { ...project.publishing, lastSuccessfulProfileId: id } };
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
