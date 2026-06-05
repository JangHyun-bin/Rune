/** Toggle a GFM task marker between checked and unchecked.
 *  Accepts "[ ]", "[x]", or "[X]"; returns "[x]" or "[ ]". */
export function toggledTaskMarker(marker: string): string {
  return /\[[xX]\]/.test(marker) ? "[ ]" : "[x]";
}
