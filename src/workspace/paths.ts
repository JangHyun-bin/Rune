/** Parent directory of a file path (handles both / and \\). Null if there is
 *  no parent segment (no separator, a root-level child like "/a.md", or a
 *  Windows drive-root child like "C:\\a.md"). */
export function parentDir(p: string): string | null {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (i <= 0) return null;
  if (i === 2 && p[1] === ":") return null; // Windows drive-root child, e.g. C:\a.md
  return p.slice(0, i);
}
