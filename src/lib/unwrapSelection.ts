/**
 * Rejoin lines that a TUI (Claude Code, Codex) hard-wrapped to fit the terminal width.
 * xterm already joins soft wraps; TUIs emit real newlines, so a copied command comes out
 * broken across lines. A break counts as a wrap when the next line's first word would not
 * have fit on the row above it.
 *
 * ponytail: heuristic. A deliberate newline right at the edge is joined too, and a word
 * ending exactly on the last column loses its space. Proper fix needs the TUI to mark
 * wraps (it can't), so tune SLACK or add a modifier-to-copy-raw if this misfires.
 *
 * @param text      terminal.getSelection()
 * @param cols      terminal.cols
 * @param startCol  0-based column where the selection starts (first line is a partial row)
 */
const SLACK = 2; // TUIs may wrap a column or two short of the edge
const BOX = /[─-╿]/; // table/box borders: never join those rows

export function unwrapSelection(text: string, cols: number, startCol = 0): string {
  const lines = text.split("\n");
  if (lines.length < 2 || cols < 10) return text;

  // Width of the last physical row a (possibly soft-wrapped) line occupies
  const rowLen = (len: number) => (len <= cols ? len : ((len - 1) % cols) + 1);

  let out = lines[0];
  let prevLen = rowLen(startCol + lines[0].length);
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const body = lines[i].trimStart();
    const firstWord = body.split(/\s/, 1)[0];
    const wrapped = prev.trim() !== "" && body !== "" && !BOX.test(prev) && !BOX.test(body)
      && prevLen + 1 + firstWord.length > cols - SLACK;
    // Row filled to the edge => a long token was cut mid-word, so no space
    out += wrapped ? (prevLen >= cols ? "" : " ") + body : "\n" + lines[i];
    prevLen = rowLen(lines[i].length);
  }
  return out;
}
