import { type Settings, type Translator } from './core';
import { readPdfSelection, sameSelection, selectionIsAlive, elementOf, type PdfSelection } from './selection';
import { TranslationPopover } from './popover';

/** One controller per document, including Obsidian popout windows. */
export class SelectionController {
  private selection: PdfSelection | null = null;
  private popover: TranslationPopover | null = null;
  private request: AbortController | null = null;
  private timer: number | undefined;
  private cleanup: Array<() => void> = [];
  private pointerDown = false;
  private disposed = false;
  private revision = 0;

  constructor(
    private doc: Document,
    private getSettings: () => Settings,
    private translator: Translator,
    private openSettings: () => void,
    private notice: (message: string) => void,
  ) {
    this.listen(doc, 'pointerdown', (event) => {
      if (event.button !== 0 || this.insidePopover(event.target)) return;
      this.pointerDown = true;
      this.close();
    }, true);
    this.listen(doc, 'pointerup', (event) => {
      if (event.button !== 0) return;
      this.pointerDown = false;
      if (!this.insidePopover(event.target)) this.capture();
    }, true);
    this.listen(doc, 'pointercancel', () => { this.pointerDown = false; this.close(); }, true);
    this.listen(doc, 'selectionchange', () => {
      const selectedNode = elementOf(doc.getSelection()?.anchorNode ?? null);
      if (selectedNode?.closest('.pst-popover')) return;
      if (!this.pointerDown) this.capture();
    });
    this.listen(doc, 'keydown', (event) => {
      if (event.key === 'Escape') this.close();
    }, true);
    this.listen(doc, 'contextmenu', (event) => {
      // PDF++ menus can have a lower stacking layer. Dismiss our card before the
      // native menu opens, without preventing the event or changing the selection.
      if (!this.insidePopover(event.target)) this.close();
    }, true);
    this.listen(doc, 'scroll', (event) => {
      if (!this.insidePopover(event.target)) this.close();
    }, true);
    const win = doc.defaultView!;
    const blur = () => { this.pointerDown = false; this.close(); };
    const resize = () => this.close();
    win.addEventListener('blur', blur);
    win.addEventListener('resize', resize);
    this.cleanup.push(() => win.removeEventListener('blur', blur), () => win.removeEventListener('resize', resize));
  }

  private listen<K extends keyof DocumentEventMap>(doc: Document, name: K, listener: (event: DocumentEventMap[K]) => void, capture = false): void {
    doc.addEventListener(name, listener, capture);
    this.cleanup.push(() => doc.removeEventListener(name, listener, capture));
  }

  private insidePopover(target: EventTarget | null): boolean {
    return !!target && typeof (target as Node).nodeType === 'number' && !!elementOf(target as Node)?.closest('.pst-popover');
  }

  private capture(): void {
    if (this.disposed) return;
    const selected = readPdfSelection(this.doc);
    if (!selected) {
      // Opening the command palette/settings steals browser selection. Keep a live
      // snapshot for the command, but never schedule another request from it.
      this.doc.defaultView?.clearTimeout(this.timer);
      return;
    }
    if (sameSelection(this.selection, selected)) return;
    this.close();
    this.selection = selected;
    const settings = this.getSettings();
    if (settings.triggerMode === 'command') return;
    this.timer = this.doc.defaultView!.setTimeout(() => {
      if (this.disposed || this.selection !== selected || !selectionIsAlive(selected)) return;
      const current = readPdfSelection(this.doc);
      if (!current || !sameSelection(selected, current)) return;
      this.show();
      if (this.getSettings().triggerMode === 'auto') void this.translate();
      else this.popover?.ready();
    }, settings.delayMs);
  }

  translateCommand(): void {
    const current = readPdfSelection(this.doc);
    if (current && !sameSelection(this.selection, current)) { this.close(); this.selection = current; }
    if (!this.selection || !selectionIsAlive(this.selection)) {
      this.notice('Double-click a word or select text in PDF first. Scanned PDFs need an OCR text layer.');
      return;
    }
    this.doc.defaultView?.clearTimeout(this.timer);
    this.show();
    void this.translate();
  }

  private show(): void {
    if (this.popover || !this.selection) return;
    this.popover = new TranslationPopover(this.doc, this.selection, {
      translate: (force) => { void this.translate(force); },
      close: () => this.close(),
      settings: () => { this.close(); this.openSettings(); },
    });
  }

  private async translate(force = false): Promise<void> {
    if (!this.selection || !this.popover || this.request || this.disposed) return;
    const snapshot = this.selection;
    const popup = this.popover;
    const settings = { ...this.getSettings() };
    const controller = new AbortController();
    this.request = controller;
    const revision = ++this.revision;
    popup.loading();
    try {
      const result = await this.translator.translate(settings, snapshot, controller.signal, force);
      if (revision === this.revision && !this.disposed && !controller.signal.aborted && selectionIsAlive(snapshot)) {
        popup.success(result.text, result.cached);
      }
    } catch (error) {
      if (revision === this.revision && !this.disposed && !controller.signal.aborted) {
        popup.error(error instanceof Error ? error.message : 'Translation failed. Check endpoint settings.');
      }
    } finally {
      if (this.request === controller) this.request = null;
    }
  }

  close(): void {
    this.doc.defaultView?.clearTimeout(this.timer);
    ++this.revision;
    this.request?.abort();
    this.request = null;
    this.popover?.destroy();
    this.popover = null;
    this.selection = null;
  }

  destroy(): void {
    this.disposed = true;
    this.close();
    this.cleanup.forEach((remove) => remove());
    this.cleanup = [];
  }
}
