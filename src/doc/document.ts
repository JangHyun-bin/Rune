export interface DocState {
  path: string | null;
  savedText: string;
  currentText: string;
}

export function newDoc(): DocState {
  return { path: null, savedText: "", currentText: "" };
}

export function loadedDoc(path: string, text: string): DocState {
  return { path, savedText: text, currentText: text };
}

export function withCurrentText(doc: DocState, text: string): DocState {
  return { ...doc, currentText: text };
}

export function markSaved(doc: DocState): DocState {
  return { ...doc, savedText: doc.currentText };
}

export function markSavedAs(doc: DocState, path: string, savedText: string): DocState {
  return { ...doc, path, savedText };
}

export function isDirty(doc: DocState): boolean {
  return doc.currentText !== doc.savedText;
}
