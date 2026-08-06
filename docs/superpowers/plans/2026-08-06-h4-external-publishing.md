# H4 External Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Rune publish an existing multi-document project as DOCX or EPUB through an installed Pandoc executable without weakening the current HTML/PDF or source-file safety guarantees.

**Architecture:** Extend the existing version 2 publishing profile with two formats and continue to build one `ProjectPublication` through Rune's current renderer. The frontend materializes that HTML with staged asset paths, while a small Rust module detects and invokes Pandoc without a shell, stages inputs, and atomically promotes only a successful binary output inside the open workspace.

**Tech Stack:** TypeScript 5.6, Vitest, Tauri 2 IPC, Rust standard library process/filesystem APIs, installed Pandoc CLI.

## Global Constraints

- Plain Markdown files and `.rune-project.json` remain the only source of truth; publishing must not modify project documents.
- Reuse `ProjectPublication`, project preflight, publishing profiles, and the existing protected-source list.
- Do not add a JavaScript, Rust, or shell dependency.
- Invoke `pandoc` directly with `std::process::Command`; never interpolate arguments into a shell command.
- Accept only `docx` and `epub` as external output formats and only destinations contained by the open workspace.
- A missing Pandoc executable must produce an actionable user-facing error and must not change `lastSuccessfulProfileId`.
- Conversion failure, output collision, symlink traversal, or asset staging failure must preserve the previous output and every source file.
- Do not bundle Pandoc, add bibliography/CSL, reference-doc templates, custom EPUB CSS, or background cancellation in this milestone.
- Do not commit, push, merge, release, edit `.ua/`, edit `bench-tmp.mjs`, or add `docs/RUNE_LONG_TERM_INTEGRATION_ROADMAP.local.md` to Git without explicit user approval.

---

### Task 1: Extend publishing profiles and output-path selection

**Files:**
- Modify: `src/project/project.ts`
- Modify: `src/project/project.test.ts`
- Modify: `src/project/projectExport.ts`
- Modify: `src/project/projectExport.test.ts`
- Modify: `src/workspace/projectPanel.ts`
- Modify: `src/workspace/projectPanel.test.ts`

**Interfaces:**
- Consumes: existing `PublishingProfile`, version 2 manifest parsing, and Project View profile editor.
- Produces: `ProjectOutputFormat = "html" | "pdf" | "docx" | "epub"` and `projectOutputPath(root, outputDirectory, title, format): string`.

- [ ] **Step 1: Write failing manifest and path tests**

```ts
it.each(["docx", "epub"] as const)("roundtrips the %s publishing format", (format) => {
  const manifest = JSON.parse(serializeProject(createProject("Book", ["one.md"])));
  manifest.publishing.profiles[0].format = format;
  expect(activePublishingProfile(parseProject(JSON.stringify(manifest))).format).toBe(format);
});

it("builds safe external publication paths on Windows and POSIX", () => {
  expect(projectOutputPath("C:\\book", "exports", "My: Book", "docx"))
    .toBe("C:\\book\\exports\\My_ Book.docx");
  expect(projectOutputPath("/book", ".", "My Book", "epub"))
    .toBe("/book/My Book.epub");
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- src/project/project.test.ts src/project/projectExport.test.ts`

Expected: profile parsing rejects `docx`/`epub`, and `projectOutputPath` is not exported.

- [ ] **Step 3: Add the two formats and the pure path helper**

```ts
export type ProjectOutputFormat = "html" | "pdf" | "docx" | "epub";

export function projectOutputPath(
  root: string,
  outputDirectory: string,
  title: string,
  format: ProjectOutputFormat,
): string {
  const separator = root.includes("\\") ? "\\" : "/";
  const directory = outputDirectory === "."
    ? root.replace(/[\\/]$/, "")
    : `${root.replace(/[\\/]$/, "")}${separator}${outputDirectory.replace(/[\\/]/g, separator)}`;
  const name = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").trim() || "publication";
  return `${directory}${separator}${name}.${format}`;
}
```

Update `parseProfile` to accept the two exact new literals and no other value.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `npm test -- src/project/project.test.ts src/project/projectExport.test.ts`

Expected: both files pass.

- [ ] **Step 5: Write a failing Project View test for saving DOCX**

Change the format selector to `docx`, save, and assert the serialized version 2 profile contains `"format": "docx"`. This catches a missing selector option or a lossy manifest save.

- [ ] **Step 6: Run the Project View test and verify RED**

Run: `npm test -- src/workspace/projectPanel.test.ts`

Expected: the selector cannot select/save DOCX through the real panel behavior.

- [ ] **Step 7: Add DOCX and EPUB to the existing format selector**

```ts
[
  { value: "html", label: "HTML" },
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "DOCX" },
  { value: "epub", label: "EPUB" },
]
```

- [ ] **Step 8: Run the Project View test and verify GREEN**

Run: `npm test -- src/workspace/projectPanel.test.ts`

Expected: the Project View test file passes.

- [ ] **Step 9: Review checkpoint**

Run `git diff --check` and inspect only the six Task 1 files. Do not commit without explicit approval.

---

### Task 2: Add safe Pandoc detection and binary output promotion

**Files:**
- Create: `src-tauri/src/publishing.rs`
- Modify: `src-tauri/src/fs_ops.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `fs_ops::PublishAsset`, workspace containment rules, protected source paths, and the Rust standard library.
- Produces: `publishing::pandoc_available() -> bool` and `publishing::publish_with_pandoc(root, path, html, assets, protected_paths) -> Result<(), String>`.

- [ ] **Step 1: Write failing Rust tests around the converter seam**

Add tests inside `publishing.rs` for these real filesystem outcomes:

```rust
#[test]
fn successful_conversion_atomically_replaces_the_previous_output() {
    // Existing Book.docx contains "old".
    // The injected converter writes "new" to its output path.
    // Assert Book.docx is "new" and all staging/backup paths are gone.
}

#[test]
fn failed_conversion_preserves_the_previous_output() {
    // Existing Book.epub contains "old".
    // The injected converter returns Err("conversion failed").
    // Assert Book.epub remains "old" and no temp output remains.
}

#[test]
fn external_publish_rejects_outputs_outside_the_workspace_and_source_overwrites() {
    // Assert both paths return Err and the protected source bytes are unchanged.
}

#[test]
fn external_publish_stages_assets_under_the_output_stem() {
    // The injected converter reads input HTML and staged Book.assets/cover.png.
    // It succeeds only when both contain the hand-written fixture bytes.
}
```

The injected converter is a private generic closure used only to replace the external process in unit tests; assertions remain on real staged/promoted files.

- [ ] **Step 2: Register the empty module and verify RED**

Add `mod publishing;` to `src-tauri/src/lib.rs`, then run `cargo test publishing::tests --lib` from `src-tauri`.

Expected: compilation fails because the declared production functions do not exist.

- [ ] **Step 3: Extract the existing shared output trust-boundary checks**

Move only the common output checks from `publish_html` into:

```rust
pub(crate) fn validate_publish_output(
    root: &Path,
    path: &Path,
    extensions: &[&str],
    protected_paths: &[String],
) -> Result<(), String>
```

It must validate the exact extension, resolve the nearest existing parent, reject paths outside the canonical workspace, reject output symlinks, reject a canonical protected-source match, create the parent, and re-check the canonical created parent. Keep HTML asset-directory checks in `publish_html`.

- [ ] **Step 4: Implement the minimum safe external publisher**

`publish_external_with` must:

1. accept only `.docx` or `.epub`;
2. create a unique sibling staging directory using process ID plus an atomic counter;
3. write `input.html` and copy each workspace-contained asset to `<stem>.assets/<relativePath>`;
4. ask the converter to write a unique sibling temporary output;
5. reject a missing or empty converter output;
6. move an existing output to a backup, promote the temporary output, and roll back on promotion failure;
7. remove staging, temporary, and backup artifacts on every handled path.

The real converter must execute without a shell:

```rust
Command::new("pandoc")
    .current_dir(staging_dir)
    .arg(input_path)
    .arg("--from=html")
    .arg(format!("--to={format}"))
    .arg("--output")
    .arg(temp_output)
    .output()
```

On `NotFound`, return `Pandoc is not installed or is not available on PATH.` On non-zero exit, include the trimmed stderr text. `pandoc_available` runs `pandoc --version` and returns true only for a successful exit.

- [ ] **Step 5: Run the new Rust tests and verify GREEN**

Run: `cargo test publishing::tests --lib`

Expected: all new publishing tests pass without requiring Pandoc to be installed.

- [ ] **Step 6: Run existing filesystem tests for regression coverage**

Run: `cargo test fs_ops::tests --lib`

Expected: all existing atomic HTML publishing and source-protection tests still pass.

- [ ] **Step 7: Review checkpoint**

Run `cargo fmt --check` and `git diff --check`; inspect only `publishing.rs`, `fs_ops.rs`, and the module declaration. Do not commit without explicit approval.

---

### Task 3: Wire Tauri IPC and the existing project publication flow

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/ipc/bindings.ts`
- Modify: `src/main.ts`
- Modify: `src/i18n/i18n.ts`
- Modify: `src/i18n/parity.test.ts`

**Interfaces:**
- Consumes: Task 1 `projectOutputPath`, Task 2 `pandoc_available` and `publish_with_pandoc`, existing `ProjectPublication`, and `commands.call` result wrapping.
- Produces: `commands.pandocAvailable()` and `commands.publishProjectExternal(...)`, plus DOCX/EPUB branches in `publishProject`.

- [ ] **Step 1: Add failing frontend contract coverage**

Extend a pure publication-path test to assert HTML, DOCX, and EPUB use their own suffix and PDF remains on the print branch. Extend i18n parity fixtures with `project.pandocUnavailable` so a missing translation fails parity.

- [ ] **Step 2: Run focused frontend tests and verify RED**

Run: `npm test -- src/project/projectExport.test.ts src/i18n/parity.test.ts`

Expected: the new i18n key is missing and/or the external route contract is absent.

- [ ] **Step 3: Add Tauri commands**

```rust
#[tauri::command]
pub async fn pandoc_available() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(crate::publishing::pandoc_available)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn publish_project_external(/* existing publish payload */) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::publishing::publish_with_pandoc(/* PathBuf values and slices */)
    })
    .await
    .map_err(|error| error.to_string())?
}
```

Register both in `generate_handler!`. Mirror the current HTML payload in `bindings.ts` so source protection and assets are identical.

- [ ] **Step 4: Route DOCX and EPUB through the new command**

In `publishProject`:

1. build the publication and preflight exactly once;
2. keep PDF on `window.print()`;
3. derive the output path with Task 1's helper;
4. keep HTML on `publishProjectHtml`;
5. for DOCX/EPUB, call `pandocAvailable`; if false, throw the localized `project.pandocUnavailable` message;
6. call `publishProjectExternal` with `materializeProjectHtmlForOutput(publication, outputPath)`, the existing asset list, and the existing protected document paths;
7. return true only after the IPC result is `ok` so Project View alone records success.

- [ ] **Step 5: Add all four translations**

Use concise actionable text equivalent to: `Pandoc is required for DOCX and EPUB. Install Pandoc, restart Rune, and try again.` Add English, Korean, Japanese, and Simplified Chinese values under the same key.

- [ ] **Step 6: Run focused frontend tests and verify GREEN**

Run: `npm test -- src/project/project.test.ts src/project/projectExport.test.ts src/workspace/projectPanel.test.ts src/i18n/parity.test.ts`

Expected: all focused files pass.

- [ ] **Step 7: Run focused Rust tests and verify GREEN**

Run: `cargo test publishing::tests fs_ops::tests --lib`

If Cargo accepts only one filter, run `cargo test publishing::tests --lib` and `cargo test fs_ops::tests --lib` separately.

- [ ] **Step 8: Review checkpoint**

Run `cargo fmt --check` and `git diff --check`. Confirm no shell command construction, no absolute output escape, and no success-state update before IPC success. Do not commit without explicit approval.

---

### Task 4: Full verification and manual Pandoc smoke test

**Files:**
- Modify only if a verified defect requires a narrow fix in the files already listed.

**Interfaces:**
- Consumes: complete Task 1-3 implementation.
- Produces: fresh evidence for frontend, Rust, build, and optional real-Pandoc behavior.

- [ ] **Step 1: Run all frontend tests**

Run: `npm test -- --run`

Expected: all test files and tests pass with zero failures.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: TypeScript and Vite exit 0.

- [ ] **Step 3: Run all Rust tests**

Run from `src-tauri`: `cargo test`

Expected: all non-ignored tests pass.

- [ ] **Step 4: Check whether Pandoc is installed**

Run: `pandoc --version`

If present, create a disposable fixture under the OS temporary directory, exercise `publish_with_pandoc` through a targeted Rust smoke test or the app command, and verify non-empty `.docx` and `.epub` outputs. If absent, report that real converter execution is unverified while keeping the deterministic fake-converter tests as the automated boundary proof.

- [ ] **Step 5: Verify repository scope**

Run: `git status --short --branch`, `git diff --stat`, and `git diff --check`.

Expected: only this plan and the implementation/test files listed above are changed; no `.ua/`, `bench-tmp.mjs`, version, release, or roadmap file is staged.

## Self-Review

- **Spec coverage:** The plan covers profile persistence, DOCX/EPUB selection, installed-Pandoc detection, shell-free invocation, existing publication reuse, asset staging, workspace/source protection, failure preservation, IPC, localization, and full verification.
- **Deliberate deferrals:** Pandoc bundling, citations, CSL, reference templates, EPUB styling, and cancellation are excluded by the accepted roadmap ordering rather than left as placeholders.
- **Type consistency:** `ProjectOutputFormat`, `projectOutputPath`, `pandocAvailable`, `publishProjectExternal`, and the Rust publishing functions have one spelling and one payload shape throughout all tasks.
- **Mutation check:** Tests fail if formats are rejected, suffixes are wrong, asset staging is omitted, converter failure overwrites output, containment checks are removed, or Project View loses the chosen format.
