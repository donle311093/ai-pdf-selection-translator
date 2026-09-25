import { normalizeText, type TranslationInput } from './core';

export interface Anchor { left: number; top: number; right: number; bottom: number }
export interface PdfSelection extends TranslationInput {
  range: Range;
  reader: Element;
  anchor: Anchor;
  page: string;
}

export function elementOf(node: Node | null): Element | null {
  return node?.nodeType === 1 ? node as Element : node?.parentElement ?? null;
}

export function readPdfSelection(doc: Document): PdfSelection | null {
  const selection = doc.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const start = elementOf(range.startContainer);
  const end = elementOf(range.endContainer);
  if (!start?.closest('.textLayer') || !end?.closest('.textLayer')) return null;
  const reader = start.closest('.pdf-container, .pdf-viewer-container, .pdf-embed');
  if (!reader || reader !== end.closest('.pdf-container, .pdf-viewer-container, .pdf-embed')) return null;
  const text = normalizeText(selection.toString());
  if (!text || !/[\p{L}\p{N}]/u.test(text)) return null;
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
  if (!rects.length) return null;
  // Anchor to the selection's focus end, so long selections do not produce off-screen cards.
  const backward = selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset;
  const rect = backward ? rects[0] : rects[rects.length - 1];
  const before = doc.createRange();
  before.selectNodeContents(start.closest('.textLayer')!);
  before.setEnd(range.startContainer, range.startOffset);
  const after = doc.createRange();
  after.selectNodeContents(end.closest('.textLayer')!);
  after.setStart(range.endContainer, range.endOffset);
  const prefix = normalizeText(before.toString()).slice(-350);
  const suffix = normalizeText(after.toString()).slice(0, 350);
  return {
    text, context: `${prefix}\n[selected] ${text.slice(0, 300)} [/selected]\n${suffix}`.trim(),
    range: range.cloneRange(), reader,
    anchor: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
    page: start.closest('[data-page-number]')?.getAttribute('data-page-number') ?? '',
  };
}

export function sameSelection(a: PdfSelection | null, b: PdfSelection): boolean {
  return !!a && a.text === b.text && a.context === b.context && a.reader === b.reader
    && a.range.startContainer === b.range.startContainer && a.range.startOffset === b.range.startOffset
    && a.range.endContainer === b.range.endContainer && a.range.endOffset === b.range.endOffset;
}

export function selectionIsAlive(selection: PdfSelection): boolean {
  return selection.reader.isConnected && selection.range.startContainer.isConnected
    && selection.range.endContainer.isConnected;
}
