/** Parent directory of a file path (handles both / and \\). Null if there is
 *  no parent segment (no separator, or a root-level child like "/a.md"). */
export function parentDir(p: string): string | null {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  if (i <= 0) return null;
  return p.slice(0, i);
}
