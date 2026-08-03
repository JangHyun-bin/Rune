use crate::search::{SearchHit, SearchResults};
use serde::Serialize;
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
    outbound_links: Vec<String>,
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

fn parse_outbound_links(markdown: &str) -> Vec<String> {
    let mut links = Vec::new();
    let mut in_fence = false;
    for line in markdown.lines() {
        let start = line.trim_start();
        if start.starts_with("```") || start.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let mut rest = line;
        while let Some(open) = rest.find("](") {
            rest = &rest[open + 2..];
            let Some(close) = rest.find(')') else { break };
            let target = rest[..close].trim();
            let target = if target.starts_with('<') && target.ends_with('>') {
                &target[1..target.len() - 1]
            } else {
                target.split_whitespace().next().unwrap_or_default()
            };
            if !target.is_empty() {
                links.push(target.to_string());
            }
            rest = &rest[close + 1..];
        }
    }
    links.sort();
    links.dedup();
    links
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
        assert_eq!(document.outbound_links, vec!["guide.md"]);
        assert!(document.modified_millis > 0);
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
}
