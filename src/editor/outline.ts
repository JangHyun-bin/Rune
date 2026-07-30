export interface HeadingItem {
  level: number;
  line: number;
  text: string;
}

export interface OutlineNode extends HeadingItem {
  children: OutlineNode[];
}

function isFence(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}

function stripClosingHashes(text: string): string {
  return text.replace(/[ \t]+#+[ \t]*$/, "").trim();
}

export function parseHeadings(markdown: string): HeadingItem[] {
  const headings: HeadingItem[] = [];
  let inFence = false;
  const lines = markdown.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isFence(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(#{1,6})[ \t]+(.+?)\s*$/.exec(line);
    if (!match) continue;

    const text = stripClosingHashes(match[2]);
    if (!text) continue;
    headings.push({ level: match[1].length, line: i + 1, text });
  }

  return headings;
}

export function buildOutlineTree(items: HeadingItem[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  for (const item of items) {
    const node: OutlineNode = { ...item, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) stack.pop();
    const parent = stack[stack.length - 1];
    (parent?.children ?? roots).push(node);
    stack.push(node);
  }

  return roots;
}

export function filterOutlineTree(nodes: OutlineNode[], query: string): OutlineNode[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return nodes;

  return nodes.flatMap((node) => {
    const children = filterOutlineTree(node.children, needle);
    return node.text.toLocaleLowerCase().includes(needle) || children.length > 0
      ? [{ ...node, children }]
      : [];
  });
}
