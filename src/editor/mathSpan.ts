/** Whether the text between a pair of single `$` delimiters is real inline math.
 *  Pandoc-style boundary rules: the char after the opening `$` must not be a
 *  space or digit (kills currency like "$5"), and the char before the closing
 *  `$` must not be a space. Empty content is not math. */
export function isInlineMath(content: string): boolean {
  if (content.length === 0) return false;
  if (/^[\s\d]/.test(content)) return false;
  if (/\s$/.test(content)) return false;
  return true;
}
