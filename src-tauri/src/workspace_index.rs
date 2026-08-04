use crate::search::{SearchHit, SearchResults};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    pub documents: usize,
    pub bytes: usize,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexedHeading {
    pub path: String,
    pub name: String,
    pub text: String,
    pub level: usize,
    pub line: usize,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LinkTargetHeading {
    pub text: String,
    pub level: usize,
    pub line: usize,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LinkTarget {
    pub path: String,
    pub relative_path: String,
    pub href: String,
    pub name: String,
    pub title: String,
    pub headings: Vec<LinkTargetHeading>,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Backlink {
    pub path: String,
    pub name: String,
    pub line: usize,
    pub href: String,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PathChange {
    pub from: String,
    pub to: String,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LinkReplacement {
    pub line: usize,
    pub old_href: String,
    pub new_href: String,
    pub byte_start: usize,
    pub byte_end: usize,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlannedDocumentEdit {
    pub path: String,
    pub resulting_path: String,
    pub replacements: Vec<LinkReplacement>,
}

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PathChangeIssueKind {
    DestinationExists,
    StaleIndex,
    UnreadableDocument,
    UnresolvedLink,
    UnsupportedLink,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PathChangeIssue {
    pub kind: PathChangeIssueKind,
    pub path: String,
    pub href: Option<String>,
    pub blocking: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PathChangePlan {
    pub plan_id: String,
    pub source: String,
    pub destination: String,
    pub can_apply: bool,
    pub path_changes: Vec<PathChange>,
    pub edits: Vec<PlannedDocumentEdit>,
    pub issues: Vec<PathChangeIssue>,
}

#[derive(Debug, Clone)]
struct DocumentHeading {
    text: String,
    level: usize,
    line: usize,
}

#[derive(Debug, Clone)]
struct IndexedDocument {
    path: PathBuf,
    #[allow(dead_code)]
    canonical_path: PathBuf,
    relative_path: String,
    name: String,
    #[allow(dead_code)]
    modified_millis: u128,
    title: String,
    #[allow(dead_code)]
    tags: Vec<String>,
    #[allow(dead_code)]
    outbound_links: Vec<OutboundLink>,
    body: String,
    headings: Vec<DocumentHeading>,
}

#[derive(Debug, Clone)]
pub struct WorkspaceIndex {
    root: PathBuf,
    documents: Vec<IndexedDocument>,
    bytes: usize,
}

impl WorkspaceIndex {
    pub fn build(root: &Path) -> Result<Self, String> {
        if !root.is_dir() {
            return Err(format!("not a folder: {}", root.display()));
        }
        let mut paths = markdown_paths(root);
        paths.sort();
        let documents: Vec<_> = paths
            .iter()
            .filter_map(|path| read_document(root, path))
            .collect();
        let bytes = documents.iter().map(|document| document.body.len()).sum();
        Ok(Self {
            root: root.to_path_buf(),
            documents,
            bytes,
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn stats(&self) -> IndexStats {
        IndexStats {
            documents: self.documents.len(),
            bytes: self.bytes,
        }
    }

    pub fn headings(&self) -> Vec<IndexedHeading> {
        self.documents
            .iter()
            .flat_map(|document| {
                document.headings.iter().map(|heading| IndexedHeading {
                    path: document.path.to_string_lossy().into_owned(),
                    name: document.name.clone(),
                    text: heading.text.clone(),
                    level: heading.level,
                    line: heading.line,
                })
            })
            .collect()
    }

    pub fn link_targets(&self, source_path: Option<&Path>) -> Vec<LinkTarget> {
        self.documents
            .iter()
            .map(|document| LinkTarget {
                path: document.path.to_string_lossy().into_owned(),
                relative_path: document.relative_path.replace('\\', "/"),
                href: relative_href(source_path, &document.path, &self.root),
                name: document.name.clone(),
                title: document.title.clone(),
                headings: document
                    .headings
                    .iter()
                    .map(|heading| LinkTargetHeading {
                        text: heading.text.clone(),
                        level: heading.level,
                        line: heading.line,
                    })
                    .collect(),
            })
            .collect()
    }

    pub fn backlinks(&self, target_path: &Path) -> Vec<Backlink> {
        let target = target_path
            .canonicalize()
            .unwrap_or_else(|_| target_path.to_path_buf());
        self.documents
            .iter()
            .flat_map(|document| {
                let target = target.clone();
                document.outbound_links.iter().filter_map(move |link| {
                    (resolve_link_path(&document.path, &link.href)? == target).then(|| Backlink {
                        path: document.path.to_string_lossy().into_owned(),
                        name: document.name.clone(),
                        line: link.line,
                        href: link.href.clone(),
                    })
                })
            })
            .collect()
    }

    pub fn plan_path_change(
        &self,
        source: &Path,
        destination: &Path,
    ) -> Result<PathChangePlan, String> {
        let root_identity = self.root.canonicalize().map_err(|error| {
            format!(
                "cannot resolve workspace '{}': {error}",
                self.root.display()
            )
        })?;
        let source_identity = source
            .canonicalize()
            .map_err(|error| format!("cannot resolve source '{}': {error}", source.display()))?;
        if source_identity == root_identity || !source_identity.starts_with(&root_identity) {
            return Err(format!("source is outside workspace: {}", source.display()));
        }
        if std::fs::symlink_metadata(source)
            .map_err(|error| format!("cannot inspect source '{}': {error}", source.display()))?
            .file_type()
            .is_symlink()
        {
            return Err(format!("source symlink is unsafe: {}", source.display()));
        }
        let destination_parent = destination.parent().ok_or_else(|| {
            format!(
                "destination is outside workspace: {}",
                destination.display()
            )
        })?;
        let destination_parent_identity = destination_parent.canonicalize().map_err(|error| {
            format!(
                "cannot resolve destination parent '{}': {error}",
                destination_parent.display()
            )
        })?;
        if destination.file_name().is_none()
            || !destination_parent_identity.starts_with(&root_identity)
        {
            return Err(format!(
                "destination is outside workspace: {}",
                destination.display()
            ));
        }
        if path_contains_symlink(&self.root, source)
            || path_contains_symlink(&self.root, destination_parent)
        {
            return Err("path change through a symlink is unsafe".into());
        }
        if source.is_dir() && destination_parent_identity.starts_with(&source_identity) {
            return Err(format!(
                "destination is inside source: {}",
                destination.display()
            ));
        }
        let path_changes: Vec<_> = self
            .documents
            .iter()
            .filter_map(|document| {
                remap_moved_path(&document.canonical_path, &source_identity, destination).map(
                    |to| PathChange {
                        from: document.path.to_string_lossy().into_owned(),
                        to: to.to_string_lossy().into_owned(),
                    },
                )
            })
            .collect();
        let mut edits = Vec::new();
        let mut link_issues = Vec::new();
        for document in &self.documents {
            let resulting_path =
                remap_moved_path(&document.canonical_path, &source_identity, destination)
                    .unwrap_or_else(|| document.path.clone());
            let source_moved = resulting_path != document.path;
            let replacements: Vec<_> = document
                .outbound_links
                .iter()
                .filter_map(|link| {
                    let Some(resolved) = resolve_link_path(&document.path, &link.href) else {
                        if let Some(kind) = unresolved_link_issue(&link.href) {
                            link_issues.push(PathChangeIssue {
                                kind,
                                path: document.path.to_string_lossy().into_owned(),
                                href: Some(link.href.clone()),
                                blocking: false,
                            });
                        }
                        return None;
                    };
                    let Some(target) = self
                        .documents
                        .iter()
                        .find(|candidate| candidate.canonical_path == resolved)
                    else {
                        if unresolved_link_issue(&link.href).is_some() {
                            link_issues.push(PathChangeIssue {
                                kind: PathChangeIssueKind::UnsupportedLink,
                                path: document.path.to_string_lossy().into_owned(),
                                href: Some(link.href.clone()),
                                blocking: false,
                            });
                        }
                        return None;
                    };
                    let moved_target =
                        remap_moved_path(&target.canonical_path, &source_identity, destination);
                    let resulting_target =
                        moved_target.clone().unwrap_or_else(|| target.path.clone());
                    let new_href = if source_moved && moved_target.is_some() {
                        link.href.clone()
                    } else {
                        moved_link_href(&resulting_path, &resulting_target, &link.href)
                    };
                    (new_href != link.href).then(|| LinkReplacement {
                        line: link.line,
                        old_href: link.href.clone(),
                        new_href,
                        byte_start: link.byte_start,
                        byte_end: link.byte_end,
                    })
                })
                .collect();
            if !replacements.is_empty() {
                edits.push(PlannedDocumentEdit {
                    path: document.path.to_string_lossy().into_owned(),
                    resulting_path: resulting_path.to_string_lossy().into_owned(),
                    replacements,
                });
            }
        }
        let mut issues = link_issues;
        for document in &self.documents {
            match std::fs::read_to_string(&document.path) {
                Ok(current) if current != document.body => issues.push(PathChangeIssue {
                    kind: PathChangeIssueKind::StaleIndex,
                    path: document.path.to_string_lossy().into_owned(),
                    href: None,
                    blocking: true,
                }),
                Err(_) => issues.push(PathChangeIssue {
                    kind: PathChangeIssueKind::UnreadableDocument,
                    path: document.path.to_string_lossy().into_owned(),
                    href: None,
                    blocking: true,
                }),
                _ => {}
            }
        }
        let indexed_paths: HashSet<_> = self
            .documents
            .iter()
            .map(|document| &document.path)
            .collect();
        let mut current_paths = markdown_paths(&self.root);
        current_paths.sort();
        issues.extend(
            current_paths
                .into_iter()
                .filter(|path| !indexed_paths.contains(path))
                .map(|path| PathChangeIssue {
                    kind: PathChangeIssueKind::UnreadableDocument,
                    path: path.to_string_lossy().into_owned(),
                    href: None,
                    blocking: true,
                }),
        );
        if destination.exists() {
            issues.push(PathChangeIssue {
                kind: PathChangeIssueKind::DestinationExists,
                path: destination.to_string_lossy().into_owned(),
                href: None,
                blocking: true,
            });
        }
        let plan_id = path_change_plan_id(
            source,
            destination,
            &self.documents,
            &path_changes,
            &edits,
            &issues,
        )?;
        Ok(PathChangePlan {
            plan_id,
            source: source.to_string_lossy().into_owned(),
            destination: destination.to_string_lossy().into_owned(),
            can_apply: !issues.iter().any(|issue| issue.blocking),
            path_changes,
            edits,
            issues,
        })
    }

    pub fn apply_path_change(
        &self,
        source: &Path,
        destination: &Path,
        expected_plan_id: &str,
    ) -> Result<Self, String> {
        self.apply_path_change_with(source, destination, expected_plan_id, |path, contents| {
            crate::fs_ops::write_text_file_atomic(path, contents)
        })
    }

    fn apply_path_change_with<F>(
        &self,
        source: &Path,
        destination: &Path,
        expected_plan_id: &str,
        mut write: F,
    ) -> Result<Self, String>
    where
        F: FnMut(&Path, &str) -> Result<(), String>,
    {
        let plan = self.plan_path_change(source, destination)?;
        if plan.plan_id != expected_plan_id {
            return Err("stale path change plan; refresh preview".into());
        }
        if !plan.can_apply {
            return Err("path change plan has blocking issues".into());
        }
        let writes: Vec<_> = plan
            .edits
            .iter()
            .map(|edit| {
                let body = std::fs::read_to_string(&edit.path)
                    .map_err(|error| format!("read failed '{}': {error}", edit.path))?;
                let rewritten = rewrite_document(&body, &edit.replacements)?;
                Ok((PathBuf::from(&edit.resulting_path), body, rewritten))
            })
            .collect::<Result<_, String>>()?;

        std::fs::rename(source, destination).map_err(|error| {
            format!(
                "rename failed '{}' -> '{}': {error}",
                source.display(),
                destination.display()
            )
        })?;
        for (written, (path, _, rewritten)) in writes.iter().enumerate() {
            if let Err(error) = write(path, rewritten) {
                let mut rollback_errors = Vec::new();
                for (written_path, original, _) in writes[..written].iter().rev() {
                    if let Err(rollback_error) =
                        crate::fs_ops::write_text_file_atomic(written_path, original)
                    {
                        rollback_errors.push(rollback_error);
                    }
                }
                if let Err(rollback_error) = std::fs::rename(destination, source) {
                    rollback_errors.push(format!("rename rollback failed: {rollback_error}"));
                }
                return Err(if rollback_errors.is_empty() {
                    format!("apply failed and was rolled back: {error}")
                } else {
                    format!(
                        "apply failed: {error}; rollback failed: {}",
                        rollback_errors.join("; ")
                    )
                });
            }
        }
        Self::build(&self.root)
    }

    pub fn search(&self, query: &str) -> SearchResults {
        self.search_under(query, None, None, || false)
    }

    pub fn updated(&self, changed_paths: &[PathBuf]) -> Result<Self, String> {
        let mut updated = self.clone();
        for path in changed_paths {
            if !path.starts_with(&self.root) {
                continue;
            }
            if path.is_dir() {
                return Self::build(&self.root);
            }
            if !path.exists() && !is_markdown_path(path) {
                updated
                    .documents
                    .retain(|document| !document.path.starts_with(path));
                continue;
            }
            if !is_markdown_path(path) {
                continue;
            }
            updated.documents.retain(|document| document.path != *path);
            if let Some(document) = read_document(&self.root, path) {
                updated.documents.push(document);
            }
        }
        updated.documents.sort_by(|a, b| a.path.cmp(&b.path));
        updated.bytes = updated
            .documents
            .iter()
            .map(|document| document.body.len())
            .sum();
        Ok(updated)
    }

    pub fn search_under(
        &self,
        query: &str,
        scope_root: Option<&Path>,
        active_path: Option<&Path>,
        mut is_canceled: impl FnMut() -> bool,
    ) -> SearchResults {
        let query = query.to_lowercase();
        if query.trim().is_empty() {
            return SearchResults {
                hits: Vec::new(),
                truncated: false,
            };
        }
        let mut documents = Vec::new();
        for document in self
            .documents
            .iter()
            .filter(|document| scope_root.is_none_or(|scope| document.path.starts_with(scope)))
        {
            if is_canceled() {
                return SearchResults {
                    hits: Vec::new(),
                    truncated: false,
                };
            }
            let mut hits = Vec::new();
            for (line_index, line) in document.body.lines().enumerate() {
                if is_canceled() {
                    return SearchResults {
                        hits: documents
                            .into_iter()
                            .flat_map(|(_, hits, _, _)| hits)
                            .take(200)
                            .collect(),
                        truncated: false,
                    };
                }
                if !line.to_lowercase().contains(&query) {
                    continue;
                }
                hits.push(SearchHit {
                    path: document.path.to_string_lossy().into_owned(),
                    line: line_index + 1,
                    snippet: line.trim().chars().take(160).collect(),
                });
            }
            if hits.is_empty() {
                continue;
            }
            let exact_name = document.name.eq_ignore_ascii_case(&query)
                || document.title.eq_ignore_ascii_case(&query)
                || Path::new(&document.name)
                    .file_stem()
                    .is_some_and(|stem| stem.to_string_lossy().eq_ignore_ascii_case(&query));
            let heading_match = document
                .headings
                .iter()
                .any(|heading| heading.text.to_lowercase().contains(&query));
            documents.push((document, hits, exact_name, heading_match));
        }
        documents.sort_by(|a, b| {
            let a_active = active_path.is_some_and(|path| a.0.path == path);
            let b_active = active_path.is_some_and(|path| b.0.path == path);
            b_active
                .cmp(&a_active)
                .then_with(|| b.2.cmp(&a.2))
                .then_with(|| b.3.cmp(&a.3))
                .then_with(|| b.1.len().cmp(&a.1.len()))
                .then_with(|| a.1[0].line.cmp(&b.1[0].line))
                .then_with(|| {
                    a.0.relative_path
                        .to_lowercase()
                        .cmp(&b.0.relative_path.to_lowercase())
                })
        });
        let total = documents
            .iter()
            .map(|(_, hits, _, _)| hits.len())
            .sum::<usize>();
        SearchResults {
            hits: documents
                .into_iter()
                .flat_map(|(_, hits, _, _)| hits)
                .take(200)
                .collect(),
            truncated: total > 200,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct OutboundLink {
    href: String,
    line: usize,
    byte_start: usize,
    byte_end: usize,
}

fn rewrite_document(body: &str, replacements: &[LinkReplacement]) -> Result<String, String> {
    let mut ordered: Vec<_> = replacements.iter().collect();
    ordered.sort_by_key(|replacement| replacement.byte_start);
    let mut rewritten = String::with_capacity(body.len());
    let mut cursor = 0;
    for replacement in ordered {
        if replacement.byte_start < cursor
            || replacement.byte_end > body.len()
            || body.get(replacement.byte_start..replacement.byte_end)
                != Some(replacement.old_href.as_str())
        {
            return Err(format!(
                "stale link replacement at line {}",
                replacement.line
            ));
        }
        rewritten.push_str(&body[cursor..replacement.byte_start]);
        rewritten.push_str(&replacement.new_href);
        cursor = replacement.byte_end;
    }
    rewritten.push_str(&body[cursor..]);
    Ok(rewritten)
}

fn path_change_plan_id(
    source: &Path,
    destination: &Path,
    documents: &[IndexedDocument],
    path_changes: &[PathChange],
    edits: &[PlannedDocumentEdit],
    issues: &[PathChangeIssue],
) -> Result<String, String> {
    let mut hash = Sha256::new();
    hash.update(source.to_string_lossy().as_bytes());
    hash.update([0]);
    hash.update(destination.to_string_lossy().as_bytes());
    hash.update([0]);
    for document in documents {
        hash.update(document.path.to_string_lossy().as_bytes());
        hash.update([0]);
        hash.update(document.body.as_bytes());
        hash.update([0]);
    }
    hash.update(
        serde_json::to_vec(&(path_changes, edits, issues)).map_err(|error| error.to_string())?,
    );
    Ok(hash
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn relative_href(source_path: Option<&Path>, target: &Path, root: &Path) -> String {
    let base = source_path.and_then(Path::parent).unwrap_or(root);
    let base_components: Vec<_> = base.components().collect();
    let target_components: Vec<_> = target.components().collect();
    let common = base_components
        .iter()
        .zip(&target_components)
        .take_while(|(left, right)| left == right)
        .count();
    let mut parts = vec!["..".to_string(); base_components.len().saturating_sub(common)];
    parts.extend(
        target_components[common..]
            .iter()
            .map(|component| component.as_os_str().to_string_lossy().into_owned()),
    );
    parts.join("/")
}

fn moved_link_href(source_path: &Path, target: &Path, old_href: &str) -> String {
    let relative = relative_href(Some(source_path), target, Path::new(""));
    let fragment = old_href
        .find('#')
        .map(|index| &old_href[index..])
        .unwrap_or_default();
    format!("{}{}", percent_encode_path(&relative), fragment)
}

fn remap_moved_path(
    identity_path: &Path,
    source_identity: &Path,
    destination: &Path,
) -> Option<PathBuf> {
    let suffix = identity_path.strip_prefix(source_identity).ok()?;
    Some(if suffix.as_os_str().is_empty() {
        destination.to_path_buf()
    } else {
        destination.join(suffix)
    })
}

fn path_contains_symlink(root: &Path, path: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    let mut current = root.to_path_buf();
    for component in relative.components() {
        current.push(component);
        if std::fs::symlink_metadata(&current)
            .is_ok_and(|metadata| metadata.file_type().is_symlink())
        {
            return true;
        }
    }
    false
}

fn percent_encode_path(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(*byte, b'/' | b'.' | b'-' | b'_' | b'~') {
            encoded.push(*byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
        })
}

fn read_document(root: &Path, path: &Path) -> Option<IndexedDocument> {
    if path.symlink_metadata().ok()?.file_type().is_symlink() {
        return None;
    }
    let body = std::fs::read_to_string(path).ok()?;
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let relative_path = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned();
    let modified_millis = path
        .metadata()
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let headings = parse_headings(&body);
    let title = headings
        .iter()
        .find(|heading| heading.level == 1)
        .map(|heading| heading.text.clone())
        .unwrap_or_else(|| {
            path.file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned()
        });
    Some(IndexedDocument {
        path: path.to_path_buf(),
        canonical_path: path.canonicalize().unwrap_or_else(|_| path.to_path_buf()),
        relative_path,
        name,
        modified_millis,
        title,
        tags: parse_frontmatter_tags(&body),
        outbound_links: parse_outbound_links(&body),
        headings,
        body,
    })
}

fn markdown_paths(root: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name();
            if name.to_string_lossy().starts_with('.')
                || matches!(name.to_str(), Some("node_modules" | "target"))
            {
                continue;
            }
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                stack.push(path);
            } else if is_markdown_path(&path) {
                paths.push(path);
            }
        }
    }
    paths
}

fn parse_headings(markdown: &str) -> Vec<DocumentHeading> {
    let mut headings = Vec::new();
    let mut in_fence = false;
    for (line_index, line) in markdown.lines().enumerate() {
        let start = line.trim_start();
        if start.starts_with("```") || start.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let level = line.bytes().take_while(|byte| *byte == b'#').count();
        if !(1..=6).contains(&level) || !matches!(line.as_bytes().get(level), Some(b' ' | b'\t')) {
            continue;
        }
        let mut text = line[level + 1..].trim();
        if let Some(split) = text.rfind([' ', '\t']) {
            if text[split..].trim().bytes().all(|byte| byte == b'#') {
                text = text[..split].trim();
            }
        }
        if !text.is_empty() {
            headings.push(DocumentHeading {
                text: text.into(),
                level,
                line: line_index + 1,
            });
        }
    }
    headings
}

fn parse_frontmatter_tags(markdown: &str) -> Vec<String> {
    let mut lines = markdown.lines();
    if lines.next().map(str::trim) != Some("---") {
        return Vec::new();
    }
    let mut tags = Vec::new();
    let mut tag_list = false;
    for line in lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            break;
        }
        if let Some(value) = trimmed
            .strip_prefix("tags:")
            .or_else(|| trimmed.strip_prefix("tag:"))
        {
            tag_list = value.trim().is_empty();
            let value = value.trim().trim_start_matches('[').trim_end_matches(']');
            tags.extend(
                value
                    .split(',')
                    .map(clean_metadata_value)
                    .filter(|value| !value.is_empty()),
            );
        } else if tag_list {
            if let Some(value) = trimmed.strip_prefix('-') {
                let value = clean_metadata_value(value);
                if !value.is_empty() {
                    tags.push(value);
                }
            } else if !line.starts_with([' ', '\t']) {
                tag_list = false;
            }
        }
    }
    tags.sort();
    tags.dedup();
    tags
}

fn clean_metadata_value(value: &str) -> String {
    value.trim().trim_matches(['\'', '"']).to_string()
}

fn parse_outbound_links(markdown: &str) -> Vec<OutboundLink> {
    let mut links = Vec::new();
    let mut in_fence = false;
    let mut line_start = 0;
    for (line_index, line_with_ending) in markdown.split_inclusive('\n').enumerate() {
        let line = line_with_ending.trim_end_matches(['\r', '\n']);
        let start = line.trim_start();
        if start.starts_with("```") || start.starts_with("~~~") {
            in_fence = !in_fence;
            line_start += line_with_ending.len();
            continue;
        }
        if in_fence {
            line_start += line_with_ending.len();
            continue;
        }
        let mut rest_start = 0;
        let mut rest = &line[rest_start..];
        while let Some(open) = rest.find("](") {
            let target_region_start = rest_start + open + 2;
            let after_open = &line[target_region_start..];
            let Some(close) = after_open.find(')') else {
                break;
            };
            let raw_target = &after_open[..close];
            let trimmed = raw_target.trim();
            let leading = raw_target.len() - raw_target.trim_start().len();
            let (target, target_offset) = if let Some(close_angle) =
                trimmed.strip_prefix('<').and_then(|value| value.find('>'))
            {
                (&trimmed[1..close_angle + 1], leading + 1)
            } else {
                (
                    trimmed.split_whitespace().next().unwrap_or_default(),
                    leading,
                )
            };
            if !target.is_empty() {
                let byte_start = line_start + target_region_start + target_offset;
                links.push(OutboundLink {
                    href: target.to_string(),
                    line: line_index + 1,
                    byte_start,
                    byte_end: byte_start + target.len(),
                });
            }
            rest_start = target_region_start + close + 1;
            rest = &line[rest_start..];
        }
        line_start += line_with_ending.len();
    }
    links
}

fn resolve_link_path(source_path: &Path, href: &str) -> Option<PathBuf> {
    if href.starts_with("//") || has_uri_scheme(href) {
        return None;
    }
    let raw_path = href.split('#').next().unwrap_or_default();
    if raw_path.is_empty() {
        return source_path.canonicalize().ok();
    }
    let decoded = percent_decode(raw_path)?;
    let path = Path::new(&decoded);
    if path.is_absolute() {
        return None;
    }
    source_path.parent()?.join(path).canonicalize().ok()
}

fn has_uri_scheme(value: &str) -> bool {
    let Some(colon) = value.find(':') else {
        return false;
    };
    let scheme = &value[..colon];
    !scheme.is_empty()
        && scheme.as_bytes()[0].is_ascii_alphabetic()
        && scheme
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.'))
}

fn unresolved_link_issue(href: &str) -> Option<PathChangeIssueKind> {
    if href.starts_with("//") {
        return None;
    }
    let raw_path = href.split('#').next().unwrap_or_default();
    if raw_path.is_empty() {
        return None;
    }
    let windows_absolute = raw_path.as_bytes().get(1) == Some(&b':')
        && raw_path
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphabetic);
    if has_uri_scheme(raw_path) && !windows_absolute {
        return None;
    }
    let Some(decoded) = percent_decode(raw_path) else {
        return Some(PathChangeIssueKind::UnsupportedLink);
    };
    let path = Path::new(&decoded);
    if !is_markdown_path(path) {
        return None;
    }
    if path.is_absolute() || raw_path.starts_with(['/', '\\']) || windows_absolute {
        Some(PathChangeIssueKind::UnsupportedLink)
    } else {
        Some(PathChangeIssueKind::UnresolvedLink)
    }
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }
        let high = hex_value(*bytes.get(index + 1)?)?;
        let low = hex_value(*bytes.get(index + 2)?)?;
        decoded.push((high << 4) | low);
        index += 3;
    }
    String::from_utf8(decoded).ok()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_markdown_documents_and_headings() {
        let dir = tempfile::tempdir().unwrap();
        let markdown = "# One\n```\n# Hidden\n```\n## Two ##\n";
        std::fs::write(dir.path().join("a.md"), markdown).unwrap();
        std::fs::write(dir.path().join("ignored.txt"), "# Ignored").unwrap();

        let index = WorkspaceIndex::build(dir.path()).unwrap();

        assert_eq!(index.stats().documents, 1);
        assert_eq!(index.stats().bytes, markdown.len());
        assert_eq!(
            index.headings(),
            vec![
                IndexedHeading {
                    path: dir.path().join("a.md").to_string_lossy().into(),
                    name: "a.md".into(),
                    text: "One".into(),
                    level: 1,
                    line: 1
                },
                IndexedHeading {
                    path: dir.path().join("a.md").to_string_lossy().into(),
                    name: "a.md".into(),
                    text: "Two".into(),
                    level: 2,
                    line: 5
                },
            ]
        );
    }

    #[test]
    fn stores_document_identity_and_link_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.md");
        std::fs::write(
            &path,
            "---\ntags: [alpha, beta]\n---\n# Document title\nSee [Guide](guide.md).\n",
        )
        .unwrap();

        let index = WorkspaceIndex::build(dir.path()).unwrap();
        let document = &index.documents[0];

        assert_eq!(document.canonical_path, path.canonicalize().unwrap());
        assert_eq!(document.relative_path, "notes.md");
        assert_eq!(document.title, "Document title");
        assert_eq!(document.tags, vec!["alpha", "beta"]);
        assert_eq!(document.outbound_links.len(), 1);
        assert_eq!(document.outbound_links[0].href, "guide.md");
        assert_eq!(document.outbound_links[0].line, 5);
        assert!(document.modified_millis > 0);
    }

    #[test]
    fn returns_relative_markdown_link_targets_with_headings() {
        let dir = tempfile::tempdir().unwrap();
        let notes = dir.path().join("notes");
        std::fs::create_dir(&notes).unwrap();
        let source = notes.join("draft.md");
        let guide = dir.path().join("안내 문서.md");
        std::fs::write(&source, "# Draft\n").unwrap();
        std::fs::write(&guide, "# 시작\n## 세부 항목\n").unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();

        let targets = index.link_targets(Some(&source));
        let target = targets
            .iter()
            .find(|target| target.path == guide.to_string_lossy())
            .unwrap();

        assert_eq!(target.href, "../안내 문서.md");
        assert_eq!(target.title, "시작");
        assert_eq!(target.headings.len(), 2);
        assert_eq!(target.headings[1].text, "세부 항목");
        assert_eq!(target.headings[1].line, 2);
    }

    #[test]
    fn returns_backlinks_with_source_lines() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("안내 문서.md");
        let source = dir.path().join("notes.md");
        std::fs::write(&target, "# Guide\n").unwrap();
        std::fs::write(
            &source,
            "# Notes\nRead [the guide](%EC%95%88%EB%82%B4%20%EB%AC%B8%EC%84%9C.md#guide).\n",
        )
        .unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();

        assert_eq!(
            index.backlinks(&target),
            vec![Backlink {
                path: source.to_string_lossy().into_owned(),
                name: "notes.md".into(),
                line: 2,
                href: "%EC%95%88%EB%82%B4%20%EB%AC%B8%EC%84%9C.md#guide".into(),
            }]
        );
    }

    #[test]
    fn plans_an_inbound_link_rewrite_without_mutating_disk() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("안내 문서.md");
        let renamed = dir.path().join("가이드 문서.md");
        let source = dir.path().join("notes.md");
        std::fs::write(&target, "# Guide\n").unwrap();
        let original = "[guide](%EC%95%88%EB%82%B4%20%EB%AC%B8%EC%84%9C.md#guide)\n";
        std::fs::write(&source, original).unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();

        let plan = index.plan_path_change(&target, &renamed).unwrap();

        assert!(plan.can_apply);
        assert_eq!(plan.path_changes.len(), 1);
        assert_eq!(plan.path_changes[0].from, target.to_string_lossy());
        assert_eq!(plan.path_changes[0].to, renamed.to_string_lossy());
        assert_eq!(plan.edits.len(), 1);
        assert_eq!(plan.edits[0].path, source.to_string_lossy());
        assert_eq!(plan.edits[0].resulting_path, source.to_string_lossy());
        assert_eq!(plan.edits[0].replacements.len(), 1);
        assert_eq!(plan.edits[0].replacements[0].line, 1);
        assert_eq!(
            plan.edits[0].replacements[0].old_href,
            "%EC%95%88%EB%82%B4%20%EB%AC%B8%EC%84%9C.md#guide"
        );
        assert_eq!(
            plan.edits[0].replacements[0].new_href,
            "%EA%B0%80%EC%9D%B4%EB%93%9C%20%EB%AC%B8%EC%84%9C.md#guide"
        );
        assert_eq!(std::fs::read_to_string(&source).unwrap(), original);
        assert!(target.exists());
        assert!(!renamed.exists());
    }

    #[test]
    fn rewrites_outbound_links_when_the_source_document_moves() {
        let dir = tempfile::tempdir().unwrap();
        let drafts = dir.path().join("drafts");
        let archive = dir.path().join("archive").join("deep");
        std::fs::create_dir(&drafts).unwrap();
        std::fs::create_dir_all(&archive).unwrap();
        let source = drafts.join("note.md");
        let destination = archive.join("note.md");
        let target = dir.path().join("guide.md");
        std::fs::write(&target, "# Guide\n## Section\n").unwrap();
        std::fs::write(&source, "[guide](../guide.md#section)\n").unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();

        let plan = index.plan_path_change(&source, &destination).unwrap();

        assert_eq!(plan.edits.len(), 1);
        assert_eq!(plan.edits[0].path, source.to_string_lossy());
        assert_eq!(plan.edits[0].resulting_path, destination.to_string_lossy());
        assert_eq!(
            plan.edits[0].replacements,
            vec![LinkReplacement {
                line: 1,
                old_href: "../guide.md#section".into(),
                new_href: "../../guide.md#section".into(),
                byte_start: 8,
                byte_end: 27,
            }]
        );
    }

    #[test]
    fn plans_folder_moves_and_keeps_links_between_jointly_moved_files_stable() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().join("project");
        let archive = dir.path().join("archive");
        std::fs::create_dir(&project).unwrap();
        std::fs::create_dir(&archive).unwrap();
        let first = project.join("a.md");
        let second = project.join("b.md");
        let guide = dir.path().join("guide.md");
        let inbound = dir.path().join("index.md");
        std::fs::write(&first, "[peer](./b.md#part) [guide](../guide.md)\n").unwrap();
        std::fs::write(&second, "# B\n## Part\n").unwrap();
        std::fs::write(&guide, "# Guide\n").unwrap();
        std::fs::write(&inbound, "[first](project/a.md)\n").unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();

        let plan = index
            .plan_path_change(&project, &archive.join("project"))
            .unwrap();

        assert_eq!(plan.path_changes.len(), 2);
        assert_eq!(plan.edits.len(), 2);
        let moved_edit = plan
            .edits
            .iter()
            .find(|edit| edit.path == first.to_string_lossy())
            .unwrap();
        assert_eq!(
            moved_edit.resulting_path,
            archive.join("project").join("a.md").to_string_lossy()
        );
        assert_eq!(
            moved_edit.replacements,
            vec![LinkReplacement {
                line: 1,
                old_href: "../guide.md".into(),
                new_href: "../../guide.md".into(),
                byte_start: 28,
                byte_end: 39,
            }]
        );
        let inbound_edit = plan
            .edits
            .iter()
            .find(|edit| edit.path == inbound.to_string_lossy())
            .unwrap();
        assert_eq!(
            inbound_edit.replacements,
            vec![LinkReplacement {
                line: 1,
                old_href: "project/a.md".into(),
                new_href: "archive/project/a.md".into(),
                byte_start: 8,
                byte_end: 20,
            }]
        );
    }

    #[test]
    fn blocks_a_plan_when_the_destination_already_exists() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("a.md");
        let destination = dir.path().join("b.md");
        std::fs::write(&source, "# A\n").unwrap();
        std::fs::write(&destination, "# B\n").unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();

        let plan = index.plan_path_change(&source, &destination).unwrap();

        assert!(!plan.can_apply);
        assert_eq!(plan.issues.len(), 1);
        assert_eq!(plan.issues[0].kind, PathChangeIssueKind::DestinationExists);
        assert_eq!(plan.issues[0].path, destination.to_string_lossy());
        assert_eq!(std::fs::read_to_string(&source).unwrap(), "# A\n");
        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "# B\n");
    }

    #[test]
    fn blocks_a_plan_when_an_indexed_document_changed_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target.md");
        let renamed = dir.path().join("renamed.md");
        let source = dir.path().join("notes.md");
        std::fs::write(&target, "# Target\n").unwrap();
        std::fs::write(&source, "[target](target.md)\n").unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();
        std::fs::write(&source, "externally changed\n[target](target.md)\n").unwrap();

        let plan = index.plan_path_change(&target, &renamed).unwrap();

        assert!(!plan.can_apply);
        assert!(plan.issues.iter().any(|issue| {
            issue.kind == PathChangeIssueKind::StaleIndex && issue.path == source.to_string_lossy()
        }));
        assert!(target.exists());
        assert!(!renamed.exists());
    }

    #[test]
    fn blocks_a_plan_when_a_markdown_document_cannot_be_indexed() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target.md");
        let renamed = dir.path().join("renamed.md");
        let unreadable = dir.path().join("unreadable.md");
        std::fs::write(&target, "# Target\n").unwrap();
        std::fs::write(&unreadable, [0xff, 0xfe]).unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();

        let plan = index.plan_path_change(&target, &renamed).unwrap();

        assert!(!plan.can_apply);
        assert!(plan.issues.iter().any(|issue| {
            issue.kind == PathChangeIssueKind::UnreadableDocument
                && issue.path == unreadable.to_string_lossy()
        }));
    }

    #[test]
    fn reports_unresolved_and_unsupported_links_without_guessing() {
        let dir = tempfile::tempdir().unwrap();
        let source_dir = dir.path().join("drafts");
        let destination_dir = dir.path().join("archive");
        std::fs::create_dir(&source_dir).unwrap();
        std::fs::create_dir(&destination_dir).unwrap();
        let source = source_dir.join("note.md");
        let destination = destination_dir.join("note.md");
        std::fs::write(
            &source,
            "[missing](../missing.md) [absolute](/outside.md) [web](https://example.com/a.md)\n",
        )
        .unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();

        let plan = index.plan_path_change(&source, &destination).unwrap();

        assert!(plan.can_apply);
        assert!(plan.issues.iter().any(|issue| {
            issue.kind == PathChangeIssueKind::UnresolvedLink
                && issue.href.as_deref() == Some("../missing.md")
                && !issue.blocking
        }));
        assert!(plan.issues.iter().any(|issue| {
            issue.kind == PathChangeIssueKind::UnsupportedLink
                && issue.href.as_deref() == Some("/outside.md")
                && !issue.blocking
        }));
        assert!(!plan
            .issues
            .iter()
            .any(|issue| issue.href.as_deref() == Some("https://example.com/a.md")));
        assert!(plan.edits.is_empty());
    }

    #[test]
    fn reports_a_resolved_markdown_link_outside_the_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = dir.path().join("vault");
        std::fs::create_dir(&workspace).unwrap();
        std::fs::write(dir.path().join("outside.md"), "# Outside\n").unwrap();
        let source = workspace.join("source.md");
        std::fs::write(&source, "[outside](../outside.md)\n").unwrap();
        let index = WorkspaceIndex::build(&workspace).unwrap();

        let plan = index
            .plan_path_change(&source, &workspace.join("renamed.md"))
            .unwrap();

        assert!(plan.issues.iter().any(|issue| {
            issue.kind == PathChangeIssueKind::UnsupportedLink
                && issue.href.as_deref() == Some("../outside.md")
                && !issue.blocking
        }));
        assert!(plan.edits.is_empty());
    }

    #[test]
    fn reports_unresolved_local_links_in_unmoved_documents() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target.md");
        let renamed = dir.path().join("renamed.md");
        let source = dir.path().join("source.md");
        std::fs::write(&target, "# Target\n").unwrap();
        std::fs::write(&source, "[missing](missing.md)\n").unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();

        let plan = index.plan_path_change(&target, &renamed).unwrap();

        assert!(plan.issues.iter().any(|issue| {
            issue.kind == PathChangeIssueKind::UnresolvedLink
                && issue.path == source.to_string_lossy()
                && issue.href.as_deref() == Some("missing.md")
                && !issue.blocking
        }));
    }

    #[test]
    fn rejects_a_destination_outside_the_open_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let source = dir.path().join("note.md");
        std::fs::write(&source, "# Note\n").unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();

        let error = index
            .plan_path_change(&source, &outside.path().join("note.md"))
            .unwrap_err();

        assert!(error.contains("outside workspace"));
        assert!(source.exists());
        assert!(!outside.path().join("note.md").exists());
    }

    #[test]
    fn rewrites_only_exact_link_targets_with_titles_and_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target.md");
        let renamed = dir.path().join("renamed.md");
        let source = dir.path().join("source.md");
        let body = "[one](target.md \"title\") and [two](target.md)\n";
        std::fs::write(&target, "# Target\n").unwrap();
        std::fs::write(&source, body).unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();

        let plan = index.plan_path_change(&target, &renamed).unwrap();
        let edit = plan
            .edits
            .iter()
            .find(|edit| edit.path == source.to_string_lossy())
            .unwrap();

        assert_eq!(
            rewrite_document(body, &edit.replacements).unwrap(),
            "[one](renamed.md \"title\") and [two](renamed.md)\n"
        );
    }

    #[test]
    fn rewrites_an_angle_wrapped_link_with_spaces_and_a_title() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("old name.md");
        let renamed = dir.path().join("new name.md");
        let source = dir.path().join("source.md");
        let body = "[target](<old name.md> \"title\")\n";
        std::fs::write(&target, "# Target\n").unwrap();
        std::fs::write(&source, body).unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();

        let plan = index.plan_path_change(&target, &renamed).unwrap();
        let edit = plan
            .edits
            .iter()
            .find(|edit| edit.path == source.to_string_lossy())
            .unwrap();

        assert_eq!(
            rewrite_document(body, &edit.replacements).unwrap(),
            "[target](<new%20name.md> \"title\")\n"
        );
    }

    #[test]
    fn applies_a_confirmed_plan_and_returns_a_refreshed_index() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target.md");
        let renamed = dir.path().join("renamed.md");
        let source = dir.path().join("source.md");
        std::fs::write(&target, "# Target\n").unwrap();
        std::fs::write(&source, "[target](target.md#part)\n").unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();
        let plan = index.plan_path_change(&target, &renamed).unwrap();

        let updated = index
            .apply_path_change(&target, &renamed, &plan.plan_id)
            .unwrap();

        assert!(!target.exists());
        assert_eq!(
            std::fs::read_to_string(&source).unwrap(),
            "[target](renamed.md#part)\n"
        );
        assert_eq!(updated.backlinks(&renamed).len(), 1);
    }

    #[test]
    fn rejects_moving_a_folder_into_itself() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("folder");
        std::fs::create_dir(&source).unwrap();
        std::fs::write(source.join("note.md"), "# Note\n").unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();

        let error = index
            .plan_path_change(&source, &source.join("nested"))
            .unwrap_err();

        assert!(error.contains("inside source"));
        assert!(source.join("note.md").exists());
    }

    #[test]
    fn rolls_back_the_rename_and_prior_link_writes_when_apply_fails() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target.md");
        let renamed = dir.path().join("renamed.md");
        let first = dir.path().join("a.md");
        let second = dir.path().join("b.md");
        std::fs::write(&target, "# Target\n").unwrap();
        std::fs::write(&first, "[target](target.md)\n").unwrap();
        std::fs::write(&second, "[target](target.md)\n").unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();
        let plan = index.plan_path_change(&target, &renamed).unwrap();
        let mut writes = 0;

        let error = index
            .apply_path_change_with(&target, &renamed, &plan.plan_id, |path, contents| {
                writes += 1;
                if writes == 2 {
                    return Err("injected write failure".into());
                }
                crate::fs_ops::write_text_file_atomic(path, contents)
            })
            .unwrap_err();

        assert!(error.contains("rolled back"));
        assert!(target.exists());
        assert!(!renamed.exists());
        assert_eq!(
            std::fs::read_to_string(first).unwrap(),
            "[target](target.md)\n"
        );
        assert_eq!(
            std::fs::read_to_string(second).unwrap(),
            "[target](target.md)\n"
        );
    }

    #[test]
    fn rejects_a_confirmed_plan_after_an_external_document_change() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target.md");
        let renamed = dir.path().join("renamed.md");
        let source = dir.path().join("source.md");
        std::fs::write(&target, "# Target\n").unwrap();
        std::fs::write(&source, "[target](target.md)\n").unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();
        let plan = index.plan_path_change(&target, &renamed).unwrap();
        std::fs::write(&source, "externally changed\n").unwrap();

        let error = index
            .apply_path_change(&target, &renamed, &plan.plan_id)
            .unwrap_err();

        assert!(error.contains("stale"));
        assert!(target.exists());
        assert!(!renamed.exists());
        assert_eq!(
            std::fs::read_to_string(source).unwrap(),
            "externally changed\n"
        );
    }

    #[test]
    fn rejects_an_old_plan_after_the_watcher_refreshes_the_index() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.md");
        let destination = dir.path().join("destination.md");
        std::fs::write(&source, "# Original\n").unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();
        let plan = index.plan_path_change(&source, &destination).unwrap();
        std::fs::write(&source, "# Externally changed without links\n").unwrap();
        let refreshed = WorkspaceIndex::build(dir.path()).unwrap();

        let error = refreshed
            .apply_path_change(&source, &destination, &plan.plan_id)
            .unwrap_err();

        assert!(error.contains("stale"));
        assert!(source.exists());
        assert!(!destination.exists());
    }

    #[test]
    fn rejects_a_confirmed_plan_when_the_destination_appears() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.md");
        let destination = dir.path().join("destination.md");
        std::fs::write(&source, "# Source\n").unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();
        let plan = index.plan_path_change(&source, &destination).unwrap();
        std::fs::write(&destination, "# External\n").unwrap();

        let error = index
            .apply_path_change(&source, &destination, &plan.plan_id)
            .unwrap_err();

        assert!(error.contains("stale"));
        assert!(source.exists());
        assert_eq!(
            std::fs::read_to_string(destination).unwrap(),
            "# External\n"
        );
    }

    #[test]
    fn applies_a_recursive_folder_move_with_inbound_and_outbound_links() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("folder");
        let moved = dir.path().join("archive").join("folder");
        std::fs::create_dir(&folder).unwrap();
        std::fs::create_dir(dir.path().join("archive")).unwrap();
        std::fs::write(folder.join("note.md"), "[root](../root.md)\n").unwrap();
        std::fs::write(dir.path().join("root.md"), "[note](folder/note.md)\n").unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();
        let plan = index.plan_path_change(&folder, &moved).unwrap();

        let updated = index
            .apply_path_change(&folder, &moved, &plan.plan_id)
            .unwrap();

        assert!(!folder.exists());
        assert_eq!(
            std::fs::read_to_string(moved.join("note.md")).unwrap(),
            "[root](../../root.md)\n"
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join("root.md")).unwrap(),
            "[note](archive/folder/note.md)\n"
        );
        assert_eq!(updated.backlinks(&moved.join("note.md")).len(), 1);
    }

    #[test]
    fn rejects_a_destination_reached_through_a_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.md");
        let real = dir.path().join("real");
        let alias = dir.path().join("alias");
        std::fs::write(&source, "# Source\n").unwrap();
        std::fs::create_dir(&real).unwrap();
        #[cfg(unix)]
        let linked = std::os::unix::fs::symlink(&real, &alias);
        #[cfg(windows)]
        let linked = std::os::windows::fs::symlink_dir(&real, &alias);
        if linked.is_err() {
            eprintln!("symlink creation unavailable; skipping platform assertion");
            return;
        }
        let index = WorkspaceIndex::build(dir.path()).unwrap();

        let error = index
            .plan_path_change(&source, &alias.join("moved.md"))
            .unwrap_err();

        assert!(error.contains("symlink"));
        assert!(source.exists());
    }

    #[test]
    fn refreshes_link_queries_after_rename_delete_and_external_edit() {
        let dir = tempfile::tempdir().unwrap();
        let old_target = dir.path().join("guide.md");
        let new_target = dir.path().join("renamed.md");
        let source = dir.path().join("notes.md");
        std::fs::write(&old_target, "# Guide\n").unwrap();
        std::fs::write(&source, "[guide](guide.md)\n").unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();
        assert_eq!(index.backlinks(&old_target).len(), 1);

        std::fs::rename(&old_target, &new_target).unwrap();
        let index = index.updated(&[old_target, new_target.clone()]).unwrap();
        assert!(index.backlinks(&new_target).is_empty());
        assert!(index
            .link_targets(Some(&source))
            .iter()
            .any(|target| target.href == "renamed.md"));

        std::fs::write(&source, "[guide](renamed.md)\n").unwrap();
        let index = index.updated(std::slice::from_ref(&source)).unwrap();
        assert_eq!(index.backlinks(&new_target).len(), 1);

        std::fs::remove_file(&new_target).unwrap();
        let index = index.updated(std::slice::from_ref(&new_target)).unwrap();
        assert!(index.backlinks(&new_target).is_empty());
    }

    #[test]
    fn skips_invalid_utf8_and_keeps_readable_documents() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("broken.md"), [0xff, 0xfe]).unwrap();
        std::fs::write(dir.path().join("good.md"), "readable").unwrap();

        let index = WorkspaceIndex::build(dir.path()).unwrap();

        assert_eq!(index.stats().documents, 1);
        assert_eq!(index.search("readable").hits.len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn skips_unreadable_files_and_keeps_readable_documents() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let unreadable = dir.path().join("unreadable.md");
        std::fs::write(&unreadable, "hidden").unwrap();
        std::fs::write(dir.path().join("good.md"), "readable").unwrap();
        std::fs::set_permissions(&unreadable, std::fs::Permissions::from_mode(0o000)).unwrap();

        let index = WorkspaceIndex::build(dir.path()).unwrap();

        std::fs::set_permissions(&unreadable, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(index.stats().documents, 1);
        assert_eq!(index.search("readable").hits.len(), 1);
    }

    #[cfg(windows)]
    #[test]
    fn skips_locked_files_and_keeps_readable_documents() {
        use std::os::windows::fs::OpenOptionsExt;

        let dir = tempfile::tempdir().unwrap();
        let locked = dir.path().join("locked.md");
        std::fs::write(&locked, "hidden").unwrap();
        std::fs::write(dir.path().join("good.md"), "readable").unwrap();
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(&locked)
            .unwrap();

        let index = WorkspaceIndex::build(dir.path()).unwrap();

        drop(lock);
        assert_eq!(index.stats().documents, 1);
        assert_eq!(index.search("readable").hits.len(), 1);
    }

    #[test]
    fn skips_symlinked_directories_instead_of_following_cycles() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("good.md"), "readable").unwrap();
        let link = dir.path().join("cycle");
        #[cfg(windows)]
        if std::os::windows::fs::symlink_dir(dir.path(), &link).is_err() {
            return;
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(dir.path(), &link).unwrap();

        let index = WorkspaceIndex::build(dir.path()).unwrap();

        assert_eq!(index.stats().documents, 1);
    }

    #[test]
    fn searches_the_in_memory_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        std::fs::write(&path, "Needle here").unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();
        std::fs::write(&path, "changed on disk").unwrap();

        let result = index.search("needle");

        assert_eq!(result.hits.len(), 1);
        assert_eq!(result.hits[0].line, 1);
        assert!(!result.truncated);
    }

    #[test]
    fn reports_truncated_index_search_results() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "needle\n".repeat(201)).unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();

        let result = index.search("needle");

        assert_eq!(result.hits.len(), 200);
        assert!(result.truncated);
    }

    #[test]
    fn incrementally_adds_updates_and_removes_documents() {
        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("first.md");
        let second = dir.path().join("second.md");
        std::fs::write(&first, "old needle").unwrap();
        std::fs::write(&second, "unchanged needle").unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();

        std::fs::write(&first, "new value").unwrap();
        std::fs::write(&second, "changed only on disk").unwrap();
        let third = dir.path().join("third.md");
        std::fs::write(&third, "third value").unwrap();
        let index = index.updated(&[first.clone(), third.clone()]).unwrap();

        assert_eq!(index.stats().documents, 3);
        assert_eq!(index.search("old needle").hits.len(), 0);
        assert_eq!(index.search("new value").hits.len(), 1);
        assert_eq!(index.search("unchanged needle").hits.len(), 1);
        assert_eq!(index.search("third value").hits.len(), 1);

        std::fs::remove_file(&first).unwrap();
        let index = index.updated(std::slice::from_ref(&first)).unwrap();
        assert_eq!(index.stats().documents, 2);
        assert_eq!(index.search("new value").hits.len(), 0);
    }

    #[test]
    fn rebuilds_when_a_changed_path_is_a_directory() {
        let dir = tempfile::tempdir().unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();
        let nested = dir.path().join("nested");
        std::fs::create_dir(&nested).unwrap();
        std::fs::write(nested.join("added.md"), "directory event").unwrap();

        let index = index.updated(std::slice::from_ref(&nested)).unwrap();

        assert_eq!(index.stats().documents, 1);
        assert_eq!(index.search("directory event").hits.len(), 1);
    }

    #[test]
    fn ignores_removed_temp_files_without_rebuilding_every_document() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.md");
        std::fs::write(&path, "indexed snapshot").unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();
        std::fs::write(&path, "changed only on disk").unwrap();

        let index = index
            .updated(&[dir.path().join(".a.md.tmp-removed")])
            .unwrap();

        assert_eq!(index.search("indexed snapshot").hits.len(), 1);
        assert_eq!(index.search("changed only on disk").hits.len(), 0);
    }

    #[test]
    fn removes_documents_under_a_deleted_directory() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("nested");
        std::fs::create_dir(&nested).unwrap();
        std::fs::write(nested.join("a.md"), "removed with directory").unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();
        std::fs::remove_dir_all(&nested).unwrap();

        let index = index.updated(std::slice::from_ref(&nested)).unwrap();

        assert_eq!(index.stats().documents, 0);
    }

    #[test]
    fn scopes_and_ranks_search_results_deterministically() {
        let dir = tempfile::tempdir().unwrap();
        let notes = dir.path().join("notes");
        std::fs::create_dir(&notes).unwrap();
        let active = notes.join("active.md");
        std::fs::write(&active, "needle in active").unwrap();
        std::fs::write(notes.join("needle.md"), "needle in exact filename").unwrap();
        std::fs::write(dir.path().join("outside.md"), "needle outside scope").unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();

        let result = index.search_under("needle", Some(&notes), Some(&active), || false);

        assert_eq!(result.hits.len(), 2);
        assert_eq!(result.hits[0].path, active.to_string_lossy());
        assert!(result.hits[1].path.ends_with("needle.md"));
    }

    #[test]
    fn ranks_headings_then_body_frequency_position_and_relative_path() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("heading.md"), "# Needle section\n").unwrap();
        std::fs::write(dir.path().join("many.md"), "needle\nneedle\n").unwrap();
        std::fs::write(dir.path().join("early-a.md"), "needle\n").unwrap();
        std::fs::write(dir.path().join("early-b.md"), "needle\n").unwrap();
        std::fs::write(dir.path().join("late.md"), "intro\nneedle\n").unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();

        let result = index.search("needle");
        let names: Vec<_> = result
            .hits
            .iter()
            .map(|hit| Path::new(&hit.path).file_name().unwrap().to_string_lossy())
            .collect();

        assert_eq!(
            names,
            [
                "heading.md",
                "many.md",
                "many.md",
                "early-a.md",
                "early-b.md",
                "late.md",
            ]
        );
    }

    #[test]
    fn stops_index_search_when_canceled() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), "needle\n".repeat(100)).unwrap();
        let index = WorkspaceIndex::build(dir.path()).unwrap();
        let checks = std::cell::Cell::new(0);

        let result = index.search_under("needle", None, None, || {
            checks.set(checks.get() + 1);
            checks.get() > 2
        });

        assert!(result.hits.len() < 100);
        assert_eq!(checks.get(), 3);
    }

    #[test]
    #[ignore = "manual performance baseline"]
    fn measures_link_query_performance() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target.md");
        std::fs::write(&target, "# Target\n## Section\n").unwrap();
        for index in 0..1_000 {
            std::fs::write(
                dir.path().join(format!("note-{index:04}.md")),
                "[target](target.md#section)\n",
            )
            .unwrap();
        }

        let started = std::time::Instant::now();
        let workspace = WorkspaceIndex::build(dir.path()).unwrap();
        let build = started.elapsed();
        let started = std::time::Instant::now();
        let targets = workspace.link_targets(Some(&target));
        let target_query = started.elapsed();
        let started = std::time::Instant::now();
        let backlinks = workspace.backlinks(&target);
        let backlink_query = started.elapsed();
        let started = std::time::Instant::now();
        let plan = workspace
            .plan_path_change(&target, &dir.path().join("renamed.md"))
            .unwrap();
        let impact_plan = started.elapsed();

        assert_eq!(targets.len(), 1_001);
        assert_eq!(backlinks.len(), 1_000);
        assert_eq!(plan.edits.len(), 1_000);
        assert!(impact_plan < std::time::Duration::from_secs(10));
        eprintln!(
            "link baseline: build={build:?}, targets={target_query:?}, backlinks={backlink_query:?}, impact_plan={impact_plan:?}"
        );
    }
}
