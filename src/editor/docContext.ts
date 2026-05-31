let docPath: string | null = null;
export function setDocPath(p: string | null) { docPath = p; }
export function getDocPath(): string | null { return docPath; }
export function getDocDir(): string | null {
  if (!docPath) return null;
  const i = Math.max(docPath.lastIndexOf("/"), docPath.lastIndexOf("\\"));
  return i >= 0 ? docPath.slice(0, i) : null;
}
