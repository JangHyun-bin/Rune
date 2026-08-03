use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub line: usize,
    pub snippet: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    pub hits: Vec<SearchHit>,
    pub truncated: bool,
}

const SEARCH_RESULT_LIMIT: usize = 200;

/// root 아래 .md/.markdown을 스캔해 query(대소문자 무시) 포함 줄을 반환.
/// 전체 최대 200줄. 빈 query는 빈 결과.
#[cfg(test)]
pub fn search_files(root: &Path, query: &str) -> SearchResults {
    search_files_until(root, query, || false)
}

pub fn search_files_until(
    root: &Path,
    query: &str,
    mut is_canceled: impl FnMut() -> bool,
) -> SearchResults {
    let q = query.to_lowercase();
    let mut hits: Vec<SearchHit> = vec![];
    if q.trim().is_empty() {
        return SearchResults { hits, truncated: false };
    }
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if is_canceled() {
            return SearchResults { hits, truncated: false };
        }
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            if is_canceled() {
                return SearchResults { hits, truncated: false };
            }
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || ["node_modules", "target", ".git"].contains(&name.as_str()) {
                continue;
            }
            if p.is_dir() {
                stack.push(p);
                continue;
            }
            if !matches!(p.extension().and_then(|x| x.to_str()), Some("md") | Some("markdown")) {
                continue;
            }
            let Ok(content) = std::fs::read_to_string(&p) else { continue };
            for (i, line) in content.lines().enumerate() {
                if is_canceled() {
                    return SearchResults { hits, truncated: false };
                }
                if line.to_lowercase().contains(&q) {
                    hits.push(SearchHit {
                        path: p.to_string_lossy().to_string(),
                        line: i + 1,
                        snippet: line.trim().chars().take(160).collect(),
                    });
                    if hits.len() > SEARCH_RESULT_LIMIT {
                        hits.truncate(SEARCH_RESULT_LIMIT);
                        return SearchResults { hits, truncated: true };
                    }
                }
            }
        }
    }
    SearchResults { hits, truncated: false }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finds_matches_case_insensitive() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("a.md"), "Hello World\nbye").unwrap();
        std::fs::write(d.path().join("b.md"), "another HELLO here").unwrap();
        let result = search_files(d.path(), "hello");
        assert_eq!(result.hits.len(), 2);
        assert!(result.hits.iter().all(|h| h.snippet.to_lowercase().contains("hello")));
    }
    #[test]
    fn empty_query_returns_nothing() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("a.md"), "x").unwrap();
        assert!(search_files(d.path(), "  ").hits.is_empty());
    }
    #[test]
    fn returns_all_matches_from_one_file_up_to_the_global_limit() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(
            d.path().join("a.md"),
            (1..=8)
                .map(|i| format!("needle {i}"))
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .unwrap();
        let result = search_files(d.path(), "needle");
        assert_eq!(result.hits.len(), 8);
        assert!(!result.truncated);
    }

    #[test]
    fn reports_when_results_are_truncated_at_the_global_limit() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("a.md"), "needle\n".repeat(201)).unwrap();

        let result = search_files(d.path(), "needle");

        assert_eq!(result.hits.len(), 200);
        assert!(result.truncated);
    }

    #[test]
    fn stops_scanning_when_canceled() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("a.md"), "needle\n".repeat(100)).unwrap();
        let checks = std::cell::Cell::new(0);

        let result = search_files_until(d.path(), "needle", || {
            checks.set(checks.get() + 1);
            checks.get() > 2
        });

        assert!(result.hits.len() < 100);
        assert_eq!(checks.get(), 3);
    }

    #[test]
    fn skips_an_unreadable_document_and_keeps_other_results() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("broken.md"), [0xff, 0xfe, 0xfd]).unwrap();
        std::fs::write(d.path().join("good.md"), "needle").unwrap();

        let result = search_files(d.path(), "needle");

        assert_eq!(result.hits.len(), 1);
        assert!(result.hits[0].path.ends_with("good.md"));
    }
}
