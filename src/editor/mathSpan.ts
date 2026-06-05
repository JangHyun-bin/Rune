/** Whether the text between a pair of single `$` delimiters is real inline math.
 *  Boundary rules: no leading/trailing whitespace (a trailing space is the tell
 *  for currency spans like "$5 and $10" → captured "5 and "), and reject a bare
 *  number or a digit-run immediately followed by a space (e.g. "42", "5 …").
 *  Digit-leading real math like "1+1", "2x", "3.14" is accepted. Empty is not math. */
export function isInlineMath(content: string): boolean {
  if (content.length === 0) return false;
  if (/^\s/.test(content)) return false;        // leading whitespace
  if (/\s$/.test(content)) return false;        // trailing whitespace
  if (/^\d+(\s|$)/.test(content)) return false; // bare number ("42") or "5 …" currency
  return true;
}
