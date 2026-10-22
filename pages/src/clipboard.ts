/**
 * The clipboard.
 *
 * Reading is the upload path the user never made explicit: the browser hands
 * over whatever the source app put on the clipboard. Two halves matter — the
 * files become the upload, and the text decides whether the paste was meant as
 * an upload at all. A cell copied from a spreadsheet arrives as text *and* an
 * image of the cell; there the text is what the user meant to paste.
 *
 * Writing is the other half of the same clipboard: a handle the reader wants
 * to paste somewhere else.
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

/**
 * Writes text to the clipboard.
 *
 * The asynchronous clipboard API is the way to write, but it is refused
 * outside a secure context and by some browsers when the page is not focused,
 * so a selection the browser can copy stands in for it. A clipboard that takes
 * neither is a failure the caller has to hear about.
 */
export async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // The fallback below is the only chance left.
  }
  if (copyBySelection(text)) return;
  throw new Error('The clipboard is not available');
}

/**
 * Copies text by selecting it in a hidden element and asking the browser to
 * copy the selection; the old way, and the only one that works without a
 * secure context.
 */
function copyBySelection(text: string): boolean {
  const holder = document.createElement('textarea');
  holder.value = text;
  holder.setAttribute('readonly', '');
  holder.style.position = 'fixed';
  holder.style.top = '-1000px';
  holder.style.opacity = '0';
  // eslint-disable-next-line unicorn/prefer-dom-node-append -- the Workers `Element.append` overload the test project's types merge in accepts no nodes, so `appendChild` is the form both projects type-check.
  document.body.appendChild(holder);
  try {
    holder.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    holder.remove();
  }
}
