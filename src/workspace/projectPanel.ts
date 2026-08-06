import { t } from "../i18n/i18n";
import {
  activePublishingProfile,
  addPublishingProfile,
  createProject,
  deletePublishingProfile,
  markPublishingSuccessful,
  moveProjectFile,
  normalizeProjectPath,
  parseProject,
  replacePublishingProfile,
  serializeProject,
  setActivePublishingProfile,
  setProjectFileIncluded,
  updateProjectTitle,
  validateProject,
  type PublishingProfile,
  type RuneProject,
} from "../project/project";
import { loadProjectManifest, saveProjectManifest } from "../project/projectManifest";
import { hasFatalProjectDiagnostics, type ProjectDiagnostic } from "../project/projectPreflight";
import { promptModal } from "./promptModal";

export interface ProjectChoice {
  path: string;
  included: boolean;
  missing: boolean;
}

export interface ProjectPanel {
  refresh(root: string | null, files: { path: string }[]): Promise<void>;
  focus(): void;
  publishAgain(): Promise<void>;
  relabel(): void;
  dispose(): void;
}

type ProfileNamePrompt = (title: string, value?: string) => Promise<string | null>;

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
  return normalizeProjectPath(relative);
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
  onPreview: (project: RuneProject, profile: PublishingProfile) => Promise<void>,
  onPublish: (project: RuneProject, profile: PublishingProfile) => Promise<boolean>,
  requestProfileName: ProfileNamePrompt = (title, value) => promptModal({ title, value }),
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
      const value = updateProjectTitle(project, titleInput?.value ?? project.title);
      parseProject(serializeProject(value));
      return value;
    } catch {
      message = t("project.invalidSettings");
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

  const persistProject = async (value: RuneProject, successMessage: string): Promise<boolean> => {
    const request = ++operation;
    const result = await saveProjectManifest(projectManifestPath(root!), value, manifestSource);
    if (request !== operation) return false;
    if (result.status === "saved") {
      manifestSource = result.source;
      project = value;
      message = successMessage;
      draw();
      return true;
    }
    message = t(result.status === "conflict" ? "project.manifestConflict" : "project.saveError");
    draw();
    return false;
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
    await persistProject(value, t("project.saved"));
  };

  const runPreflight = async (
    action?: (value: RuneProject, profile: PublishingProfile) => Promise<boolean | void>,
    profileId?: string,
    rememberSuccess = false,
  ): Promise<void> => {
    let value = currentProject();
    if (!value) return;
    if (profileId) value = setActivePublishingProfile(value, profileId);
    if (value.files.length === 0) {
      message = t("project.noFiles");
      diagnostics = [];
      draw();
      return;
    }
    const profile = activePublishingProfile(value);
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
      if (fatal || !action) return;
      const completed = await action(value, profile);
      if (request !== operation) return;
      if (completed === false) {
        message = t("project.publishFailed");
        draw();
        return;
      }
      if (!rememberSuccess) return;
      const published = markPublishingSuccessful(value, profile.id);
      await persistProject(published, t("project.published", { profile: profile.name }));
    } catch {
      if (request !== operation) return;
      message = t(action ? "project.exportError" : "project.preflightError");
      draw();
    }
  };

  const updateProfile = (change: (profile: PublishingProfile) => PublishingProfile): void => {
    if (!project) return;
    try {
      project = replacePublishingProfile(project, change(activePublishingProfile(project)));
      clearFeedback();
      draw();
    } catch {
      message = t("project.invalidSettings");
      draw();
    }
  };

  const editProfileName = async (mode: "new" | "rename" | "duplicate"): Promise<void> => {
    if (!project) return;
    const current = activePublishingProfile(project);
    const value = await requestProfileName(t(`project.profile.${mode}`), mode === "new" ? "" : current.name);
    if (!value?.trim() || !project) return;
    try {
      if (mode === "rename") project = replacePublishingProfile(project, { ...current, name: value.trim() });
      else project = addPublishingProfile(project, value, mode === "duplicate" ? current : undefined);
      clearFeedback();
      draw();
    } catch {
      message = t("project.invalidSettings");
      draw();
    }
  };

  const labeled = (labelText: string, control: HTMLElement): HTMLElement => {
    const label = document.createElement("label");
    label.className = "project-profile-field";
    const text = document.createElement("span");
    text.textContent = labelText;
    label.append(text, control);
    return label;
  };

  const select = (value: string, choices: { value: string; label: string }[], change: (value: string) => void): HTMLSelectElement => {
    const element = document.createElement("select");
    for (const choice of choices) {
      const option = document.createElement("option");
      option.value = choice.value;
      option.textContent = choice.label;
      element.appendChild(option);
    }
    element.value = value;
    element.addEventListener("change", () => change(element.value));
    return element;
  };

  const textInput = (value: string, change: (value: string) => void, type = "text"): HTMLInputElement => {
    const element = document.createElement("input");
    element.type = type;
    element.value = value;
    element.addEventListener("change", () => change(element.value));
    return element;
  };

  const checkbox = (checked: boolean, change: (checked: boolean) => void): HTMLInputElement => {
    const element = document.createElement("input");
    element.type = "checkbox";
    element.checked = checked;
    element.addEventListener("change", () => change(element.checked));
    return element;
  };

  const drawProfile = (): HTMLElement => {
    const container = document.createElement("section");
    container.className = "project-profile";
    const profile = activePublishingProfile(project!);
    const header = document.createElement("div");
    header.className = "project-profile-header";
    const picker = select(project!.publishing.activeProfileId, project!.publishing.profiles.map((item) => ({ value: item.id, label: item.name })), (id) => {
      project = setActivePublishingProfile(project!, id);
      clearFeedback();
      draw();
    });
    picker.setAttribute("aria-label", t("project.profile"));
    const profileActions = document.createElement("span");
    profileActions.className = "project-profile-actions";
    const remove = button(t("project.profile.delete"), () => {
      project = deletePublishingProfile(project!, profile.id);
      clearFeedback();
      draw();
    }, "−");
    remove.disabled = project!.publishing.profiles.length === 1;
    profileActions.append(
      button(t("project.profile.new"), () => { void editProfileName("new"); }, "+"),
      button(t("project.profile.rename"), () => { void editProfileName("rename"); }, "✎"),
      button(t("project.profile.duplicate"), () => { void editProfileName("duplicate"); }, "⧉"),
      remove,
    );
    header.append(picker, profileActions);

    const fields = document.createElement("div");
    fields.className = "project-profile-fields";
    fields.append(
      labeled(t("project.profile.format"), select(profile.format, [
        { value: "html", label: "HTML" }, { value: "pdf", label: "PDF" },
        { value: "docx", label: "DOCX" }, { value: "epub", label: "EPUB" },
      ], (value) => updateProfile((item) => ({ ...item, format: value as PublishingProfile["format"] })))),
      labeled(t("project.profile.outputDirectory"), textInput(profile.outputDirectory, (value) => updateProfile((item) => ({ ...item, outputDirectory: value })))),
      labeled(t("project.profile.theme"), select(profile.theme, [
        { value: "default", label: t("project.profile.theme.default") }, { value: "serif", label: t("project.profile.theme.serif") },
      ], (value) => updateProfile((item) => ({ ...item, theme: value as PublishingProfile["theme"] })))),
      labeled(t("project.profile.pageSize"), select(profile.pageSize, [
        { value: "A4", label: "A4" }, { value: "Letter", label: "Letter" },
      ], (value) => updateProfile((item) => ({ ...item, pageSize: value as PublishingProfile["pageSize"] })))),
      labeled(t("project.profile.toc"), checkbox(profile.tableOfContents, (checked) => updateProfile((item) => ({ ...item, tableOfContents: checked })))),
      labeled(t("project.profile.tocDepth"), textInput(String(profile.tableOfContentsDepth), (value) => updateProfile((item) => ({ ...item, tableOfContentsDepth: Number(value) })), "number")),
      labeled(t("project.profile.pageBreak"), checkbox(profile.pageBreakDocuments, (checked) => updateProfile((item) => ({ ...item, pageBreakDocuments: checked })))),
      labeled(t("project.profile.author"), textInput(profile.metadata.author, (value) => updateProfile((item) => ({ ...item, metadata: { ...item.metadata, author: value } })))),
      labeled(t("project.profile.subject"), textInput(profile.metadata.subject, (value) => updateProfile((item) => ({ ...item, metadata: { ...item.metadata, subject: value } })))),
    );
    const margins = document.createElement("div");
    margins.className = "project-profile-margins";
    for (const side of ["top", "right", "bottom", "left"] as const) {
      margins.append(labeled(t(`project.profile.margin.${side}`), textInput(String(profile.margins[side]), (value) => updateProfile((item) => ({
        ...item,
        margins: { ...item.margins, [side]: Number(value) },
      })), "number")));
    }
    fields.appendChild(margins);
    container.append(header, fields);
    return container;
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
      button(t("project.preview"), () => { void runPreflight(async (value, profile) => onPreview(value, profile)); }),
      button(t("project.publish"), () => { void runPreflight(onPublish, undefined, true); }),
      button(t("project.publishAgain"), () => { void panel.publishAgain(); }),
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
    host.append(title, drawProfile(), actions, list, diagnosticList, status);
  };

  const panel: ProjectPanel = {
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
      const result = await loadProjectManifest(projectManifestPath(root));
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
    async publishAgain() {
      const id = project?.publishing.lastSuccessfulProfileId;
      if (!id) {
        message = t("project.noPreviousPublish");
        draw();
        return;
      }
      await runPreflight(onPublish, id, true);
    },
    relabel: draw,
    dispose() { load++; operation++; host.replaceChildren(); },
  };
  return panel;
}
