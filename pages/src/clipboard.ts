/**
 * Reading a paste.
 *
 * A paste is the upload path the user never made explicit: the browser hands
 * over whatever the source app put on the clipboard. Two halves matter — the
 * files become the upload, and the text decides whether the paste was meant as
 * an upload at all. A cell copied from a spreadsheet arrives as text *and* an
 * image of the cell; there the text is what the user meant to paste.
 */

/**
 * What a paste carries: the files on the clipboard and the text with them.
 */
export interface PastedContent {
  /**
   * The files the clipboard holds, in the order the source app put them there.
   */
  files: File[];
  /**
   * The plain text the clipboard carries alongside the files.
   */
  text: string;
}

/**
 * Reads a paste. A missing or unreadable clipboard is an empty paste, never an
 * error: the composer then leaves the paste to the browser.
 */
export function readClipboard(data: DataTransfer | null): PastedContent {
  if (!data) return { files: [], text: '' };
  return { files: clipboardFiles(data), text: clipboardText(data) };
}

/**
 * The clipboard's files, taken from the item list. A browser that does not
 * fill the list still exposes the files themselves.
 */
function clipboardFiles(data: DataTransfer): File[] {
  const files: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    // A string item is ordinary text: it belongs in the box, not in an upload.
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (files.length === 0) files.push(...Array.from(data.files ?? []));
  return files;
}

function clipboardText(data: DataTransfer): string {
  try {
    return data.getData('text/plain');
  } catch {
    return '';
  }
}
