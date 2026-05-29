/** 공백으로 구분된 토큰 수. 빈/공백 문자열은 0. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}
