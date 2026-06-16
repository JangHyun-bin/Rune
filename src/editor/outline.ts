export interface HeadingItem {
  level: number;
  line: number;
  text: string;
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
