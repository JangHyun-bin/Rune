# H4 Bibliography, Citation UX, and References View

**Goal:** Connect project bibliography settings to editing, diagnostics, publishing, and a movable References View without introducing a second workspace index or a mandatory external dependency.

**Architecture:** Extend the existing version-2 project manifest with project bibliography paths and per-profile CSL/locale settings. A small TypeScript citation module parses BibTeX and Pandoc-style citation groups, then feeds the existing preflight, CodeMirror extension, project publication, and Workbench View Registry. Rune renders a deterministic built-in author/year fallback for portable output; configured CSL files are validated and persisted as the handoff point for a later full CSL processor.

**Tech Stack:** TypeScript, CodeMirror 6, markdown-it, Vitest, existing Tauri file commands and Workbench registry.

## Task 1: Bibliography/CSL foundation

**Files:**
- Modify: `src/project/project.ts`
- Modify: `src/project/project.test.ts`
- Create: `src/project/citations.ts`
- Create: `src/project/citations.test.ts`
- Modify: `src/project/projectPreflight.ts`
- Modify: `src/project/projectPreflight.test.ts`
- Modify: `src/workspace/projectPanel.ts`
- Modify: `src/workspace/projectPanel.test.ts`
- Modify: `src/i18n/i18n.ts`

1. Add failing manifest tests for normalized `.bib` paths, per-profile `.csl` and locale fields, migration defaults, unknown-field preservation, and unsafe-path rejection.
2. Add failing parser tests for nested-brace/quoted BibTeX fields, duplicate keys, Unicode, and standard single-line Pandoc citation groups.
3. Implement only the manifest fields and parser needed by those tests.
4. Add failing preflight tests for missing/unreadable bibliography or CSL files, duplicate bibliography keys, and citations whose keys are absent.
5. Reuse existing Tauri `readFile`/`pathExists` calls and project-root path checks to make those tests pass.
6. Add bibliography, CSL, and locale controls to the existing Project View; preserve optimistic concurrency through the current manifest save path.

## Task 2: Citation input and portable publishing

**Files:**
- Create: `src/editor/citations.ts`
- Create: `src/editor/citations.test.ts`
- Modify: `src/main.ts`
- Modify: `src/project/projectExport.ts`
- Modify: `src/project/projectExport.test.ts`
- Modify: `src/export/exportDoc.ts`

1. Add failing pure tests for completion after `@` inside a Pandoc citation group, deterministic ranking, labels, and no completion for ordinary email/text.
2. Implement one CodeMirror autocomplete/lint extension backed by the current project citation library; do not add a second completion framework.
3. Reload the library when the folder, manifest, or bibliography changes and refresh editor diagnostics.
4. Add failing export tests proving `[@key]` groups become linked author/year citations, cited entries are appended once in first-use order, missing keys remain visible, and source Markdown is unchanged.
5. Implement deterministic built-in rendering through `buildProjectPublication`, so HTML/PDF/DOCX/EPUB all inherit the same result without requiring Pandoc for editor UX.

## Task 3: References View

**Files:**
- Create: `src/workspace/referencesPanel.ts`
- Create: `src/workspace/referencesPanel.test.ts`
- Modify: `src/workbench/workbenchLayout.ts`
- Modify: `src/workbench/workbenchLayout.test.ts`
- Modify: `src/main.ts`
- Modify: `src/styles.css`
- Modify: `src/i18n/i18n.ts`

1. Add failing tests that aggregate cited, uncited, and missing keys across project documents, prioritize the active document, and sort deterministically.
2. Implement the pure aggregation plus a small accessible panel using the existing Backlinks/Tags panel patterns.
3. Register `references` in the Workbench auxiliary container so it can be closed, reopened, moved, docked, and torn off through the existing layout system.
4. Wire row activation to the first citation occurrence via the existing `openPath` and `jumpToLine` flow.

## Task 4: Verification and handoff

1. Run focused Vitest files after every RED/GREEN cycle.
2. Run `npm test -- --run`, `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml`, and `git diff --check`.
3. Update only the local ignored long-term roadmap with the completed state; do not stage it.
4. Leave the feature branch uncommitted and unpushed until explicitly requested.

## Deliberate boundary

This milestone validates and persists CSL/locale configuration but does not implement the full CSL specification. Add a standards-compliant CSL processor only when style-faithful output becomes the next explicit milestone; the built-in fallback keeps current portable publishing and citation UX independent of an external runtime.
