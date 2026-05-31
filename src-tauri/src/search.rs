use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub line: usize,
    pub snippet: String,
}

/// root 아래 .md/.markdown을 스캔해 query(대소문자 무시) 포함 줄을 반환.
/// 파일당 최대 5줄, 전체 최대 200. 빈 query는 빈 결과.
pub fn search_files(root: &Path, query: &str) -> Vec<SearchHit> {
    let q = query.to_lowercase();
    let mut hits: Vec<SearchHit> = vec![];
    if q.trim().is_empty() {
        return hits;
    }
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
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
            let mut per_file = 0;
            for (i, line) in content.lines().enumerate() {
                if line.to_lowercase().contains(&q) {
                    hits.push(SearchHit {
                        path: p.to_string_lossy().to_string(),
                        line: i + 1,
                        snippet: line.trim().chars().take(160).collect(),
                    });
                    per_file += 1;
                    if per_file >= 5 || hits.len() >= 200 {
                        break;
                    }
                }
            }
            if hits.len() >= 200 {
                break;
            }
        }
    }
    hits
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finds_matches_case_insensitive() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("a.md"), "Hello World\nbye").unwrap();
        std::fs::write(d.path().join("b.md"), "another HELLO here").unwrap();
        let hits = search_files(d.path(), "hello");
        assert_eq!(hits.len(), 2);
        assert!(hits.iter().all(|h| h.snippet.to_lowercase().contains("hello")));
    }
    #[test]
    fn empty_query_returns_nothing() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("a.md"), "x").unwrap();
        assert!(search_files(d.path(), "  ").is_empty());
    }
}
