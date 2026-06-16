export interface MatchRange {
  from: number;
  to: number;
}

export function findMatches(text: string, query: string, caseSensitive = false): MatchRange[] {
  if (query.length === 0) return [];
  const haystack = caseSensitive ? text : text.toLocaleLowerCase();
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const matches: MatchRange[] = [];
  let from = 0;

  while (from <= haystack.length) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) break;
    matches.push({ from: index, to: index + query.length });
    from = index + query.length;
  }

  return matches;
}

export function matchIndexAt(matches: MatchRange[], range: MatchRange | null): number {
  if (!range) return -1;
  return matches.findIndex((match) => match.from === range.from && match.to === range.to);
}

export function nextMatchIndex(matches: MatchRange[], cursor: number): number {
  if (matches.length === 0) return -1;
  const index = matches.findIndex((match) => match.from >= cursor);
  return index === -1 ? 0 : index;
}

export function previousMatchIndex(matches: MatchRange[], cursor: number): number {
  if (matches.length === 0) return -1;
  for (let index = matches.length - 1; index >= 0; index--) {
    if (matches[index].from < cursor) return index;
  }
  return matches.length - 1;
}

export function replaceAllText(text: string, matches: MatchRange[], replacement: string): string {
  if (matches.length === 0) return text;
  let result = "";
  let cursor = 0;

  for (const match of matches) {
    result += text.slice(cursor, match.from);
    result += replacement;
    cursor = match.to;
  }

  return result + text.slice(cursor);
}
