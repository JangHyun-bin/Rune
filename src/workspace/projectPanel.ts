import { t } from "../i18n/i18n";
import {
  createProject,
  moveProjectFile,
  parseProject,
  setProjectFileIncluded,
  validateProject,
  type RuneProject,
} from "../project/project";
import { loadProjectManifest, saveProjectManifest } from "../project/projectManifest";
import { hasFatalProjectDiagnostics, type ProjectDiagnostic } from "../project/projectPreflight";

export interface ProjectChoice {
  path: string;
  included: boolean;
  missing: boolean;
}

export interface ProjectPanel {
  refresh(root: string | null, files: { path: string }[]): Promise<void>;
  focus(): void;
  relabel(): void;
  dispose(): void;
}

export function projectManifestPath(root: string): string {
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]$/, "")}${separator}.rune-project.json`;
}

export function projectRelativePath(root: string, absolutePath: string): string {
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedPath = absolutePath.replace(/\\/g, "/");
  const windowsPath = /^[A-Za-z]:\//.test(normalizedRoot);
  const comparableRoot = windowsPath ? normalizedRoot.toLowerCase() : normalizedRoot;
  const comparablePath = windowsPath ? normalizedPath.toLowerCase() : normalizedPath;
  const prefix = `${comparableRoot}/`;
  if (!comparablePath.startsWith(prefix)) throw new Error(`Project file is outside workspace: ${absolutePath}`);
  const relative = normalizedPath.slice(normalizedRoot.length + 1);
  return createProject("Project", [relative]).files[0];
}

export function buildProjectChoices(project: RuneProject, availableFiles: string[]): ProjectChoice[] {
  const available = new Set(availableFiles);
  const selected = new Set(project.files);
  return [
    ...project.files.filter((path, index) => project.files.indexOf(path) === index)
      .map((path) => ({ path, included: true, missing: !available.has(path) })),
    ...availableFiles.filter((path) => !selected.has(path)).sort((a, b) => a.localeCompare(b))
      .map((path) => ({ path, included: false, missing: false })),
  ];
}

function folderName(path: string): string {
  return path.replace(/[\\/]$/, "").split(/[\\/]/).pop() || "Project";
}

export function mountProjectPanel(
  host: HTMLElement,
  onPreflight: (project: RuneProject) => Promise<ProjectDiagnostic[]>,
  onPreview: (project: RuneProject) => Promise<void>,
  onExport: (project: RuneProject) => Promise<void>,
): ProjectPanel {
  host.className = "project-panel";
  let root: string | null = null;
  let availableFiles: string[] = [];
  let project: RuneProject | null = null;
  let state: "noFolder" | "loading" | "ready" | "invalid" = "noFolder";
  let message = "";
  let diagnostics: ProjectDiagnostic[] = [];
  let manifestSource: string | null = null;
  let load = 0;
  let operation = 0;
  let titleInput: HTMLInputElement | null = null;
  let diagnosticList: HTMLElement | null = null;
  let statusElement: HTMLParagraphElement | null = null;

  const button = (label: string, action: () => void, text = label): HTMLButtonElement => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "btn btn-secondary project-action";
    element.textContent = text;
    element.setAttribute("aria-label", label);
    element.addEventListener("click", action);
    return element;
  };

  const currentProject = (): RuneProject | null => {
    if (!project) return null;
    try {
      return createProject(titleInput?.value ?? project.title, project.files);
    } catch {
      message = t("project.titleRequired");
      draw();
      return null;
    }
  };

  const clearFeedback = (): void => {
    operation++;
    diagnostics = [];
    message = "";
    diagnosticList?.replaceChildren();
    if (statusElement) statusElement.textContent = "";
  };

  const saveProject = async (): Promise<void> => {
    const value = currentProject();
    if (!value) return;
    const issues = validateProject(value, availableFiles);
    if (issues.length || value.files.length === 0) {
      message = issues.length ? t("project.invalidFiles") : t("project.noFiles");
      draw();
      return;
    }
    const request = ++operation;
    const result = await saveProjectManifest(projectManifestPath(root!), value, manifestSource);
    if (request !== operation) return;
    if (result.status === "saved") {
      manifestSource = result.source;
      project = value;
      message = t("project.saved");
    } else {
      message = t(result.status === "conflict" ? "project.manifestConflict" : "project.saveError");
    }
    draw();
  };

  const runPreflight = async (action?: (value: RuneProject) => Promise<void>): Promise<void> => {
    const value = currentProject();
    if (!value) return;
    if (value.files.length === 0) {
      message = t("project.noFiles");
      diagnostics = [];
      draw();
      return;
    }
    const request = ++operation;
    project = value;
    message = "";
    diagnostics = [];
    draw();
    try {
      const nextDiagnostics = await onPreflight(value);
      if (request !== operation) return;
      diagnostics = nextDiagnostics;
      const fatal = hasFatalProjectDiagnostics(diagnostics);
      message = fatal ? t("project.publishBlocked") : diagnostics.length === 0 ? t("project.diagnosticsClean") : "";
      draw();
      if (!fatal && action) await action(value);
    } catch {
      if (request !== operation) return;
      message = t("project.preflightError");
      draw();
    }
  };

  const draw = (): void => {
    host.replaceChildren();
    titleInput = null;
    diagnosticList = null;
    statusElement = null;
    if (state !== "ready" || !project) {
      const empty = document.createElement("p");
      empty.className = "project-empty";
      empty.textContent = t(state === "noFolder" ? "project.noFolder" : state === "invalid" ? "project.invalid" : "project.loading");
      host.appendChild(empty);
      return;
    }

    const title = document.createElement("input");
    title.type = "text";
    title.className = "project-title";
    title.value = project.title;
    title.placeholder = t("project.title");
    title.setAttribute("aria-label", t("project.title"));
    title.addEventListener("input", () => { project = { ...project!, title: title.value }; clearFeedback(); });
    titleInput = title;

    const actions = document.createElement("div");
    actions.className = "project-actions";
    actions.append(
      button(t("project.save"), () => { void saveProject(); }),
      button(t("project.preflight"), () => { void runPreflight(); }),
      button(t("project.preview"), () => { void runPreflight(onPreview); }),
      button(t("project.exportHtml"), () => { void runPreflight(onExport); }),
    );

    const list = document.createElement("div");
    list.className = "project-files";
    for (const choice of buildProjectChoices(project, availableFiles)) {
      const row = document.createElement("div");
      row.className = `project-file${choice.missing ? " missing" : ""}`;
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = choice.included;
      check.setAttribute("aria-label", choice.path);
      check.addEventListener("change", () => {
        project = setProjectFileIncluded(project!, choice.path, check.checked);
        clearFeedback();
        draw();
      });
      const label = document.createElement("span");
      label.textContent = choice.missing ? `${choice.path} · ${t("project.missing")}` : choice.path;
      row.append(check, label);
      if (choice.included) {
        const controls = document.createElement("span");
        controls.className = "project-file-order";
        controls.append(
          button(t("project.moveUp"), () => { project = moveProjectFile(project!, choice.path, -1); clearFeedback(); draw(); }, "↑"),
          button(t("project.moveDown"), () => { project = moveProjectFile(project!, choice.path, 1); clearFeedback(); draw(); }, "↓"),
        );
        row.appendChild(controls);
      }
      list.appendChild(row);
    }

    diagnosticList = document.createElement("div");
    diagnosticList.className = "project-diagnostics";
    diagnosticList.setAttribute("role", "list");
    diagnosticList.setAttribute("aria-label", t("project.diagnostics"));
    for (const diagnostic of diagnostics) {
      const item = document.createElement("div");
      item.className = `project-diagnostic ${diagnostic.severity}`;
      item.setAttribute("role", "listitem");
      const location = document.createElement("strong");
      location.textContent = diagnostic.line === null
        ? diagnostic.path
        : `${diagnostic.path} · ${t("pathChange.line", { line: diagnostic.line })}`;
      const detail = document.createElement("span");
      detail.textContent = `${t(`project.${diagnostic.severity}`)} · ${t(`project.diagnostic.${diagnostic.kind}`, { value: diagnostic.value })}`;
      item.append(location, detail);
      diagnosticList.appendChild(item);
    }

    const status = document.createElement("p");
    status.className = "project-status";
    status.textContent = message;
    status.setAttribute("aria-live", "polite");
    statusElement = status;
    host.append(title, actions, list, diagnosticList, status);
  };

  return {
    async refresh(nextRoot, files) {
      const request = ++load;
      if (root === nextRoot && state === "ready" && project) {
        availableFiles = files.map((file) => projectRelativePath(root!, file.path));
        draw();
        return;
      }
      root = nextRoot;
      operation++;
      diagnostics = [];
      manifestSource = null;
      if (!root) {
        availableFiles = [];
        project = null;
        state = "noFolder";
        draw();
        return;
      }
      state = "loading";
      draw();
      availableFiles = files.map((file) => projectRelativePath(root!, file.path));
      const manifestPath = projectManifestPath(root);
      const result = await loadProjectManifest(manifestPath);
      if (request !== load) return;
      try {
        if (result.status === "error") throw new Error("Project manifest unavailable");
        manifestSource = result.source;
        project = result.source === null ? createProject(folderName(root)) : parseProject(result.source);
        state = "ready";
        message = "";
      } catch {
        project = null;
        state = "invalid";
      }
      draw();
    },
    focus() { titleInput?.focus(); },
    relabel: draw,
    dispose() { load++; operation++; host.replaceChildren(); },
  };
}
