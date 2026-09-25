import type { Anchor, PdfSelection } from './selection';

export interface PopoverActions {
  translate: (force: boolean) => void;
  close: () => void;
  settings: () => void;
}

function append<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] {
  const el = parent.ownerDocument.createElement(tag);
  el.className = cls;
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

export class TranslationPopover {
  readonly el: HTMLDivElement;
  private output: HTMLDivElement;
  private status: HTMLSpanElement;
  private copy: HTMLButtonElement;
  private retry: HTMLButtonElement;
  private text = '';

  constructor(private doc: Document, private selection: PdfSelection, private actions: PopoverActions) {
    this.el = doc.createElement('div');
    this.el.className = 'pst-popover';
    this.el.setAttribute('role', 'region');
    this.el.setAttribute('aria-label', 'PDF Selection Translator');
    const header = append(this.el, 'div', 'pst-header');
    append(header, 'span', 'pst-mark', 'Translate');
    append(header, 'span', 'pst-title', 'Paper translation');
    this.status = append(header, 'span', 'pst-status');
    const close = append(header, 'button', 'pst-icon-button', '×');
    close.setAttribute('aria-label', 'Close translation');
    close.title = 'Close · Esc';
    close.onclick = () => actions.close();
    const source = append(this.el, 'details', 'pst-source');
    append(source, 'summary', '', `${selection.page ? `Page ${selection.page} · ` : ''}${selection.text.length <= 80 ? selection.text : selection.text.slice(0, 80) + '…'}`);
    append(source, 'div', 'pst-source-text', selection.text);
    this.output = append(this.el, 'div', 'pst-output');
    this.output.setAttribute('aria-live', 'polite');
    const footer = append(this.el, 'div', 'pst-footer');
    this.copy = append(footer, 'button', 'pst-copy', 'Copy translation');
    this.copy.disabled = true;
    this.copy.onclick = () => { void this.copyText(); };
    this.retry = append(footer, 'button', 'pst-retry', 'Translate');
    this.retry.onclick = () => actions.translate(!!this.text);
    const settings = append(footer, 'button', 'pst-settings', 'Settings');
    settings.onclick = () => actions.settings();
    // Clicking controls must not collapse the PDF selection. Output remains selectable.
    this.el.addEventListener('pointerdown', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('button')) event.preventDefault();
    });
    doc.body.appendChild(this.el);
    source.addEventListener('toggle', () => this.position());
    this.position();
  }

  ready(): void {
    this.status.textContent = 'Ready';
    this.output.textContent = 'Click “Translate” to translate selected text.';
    this.position();
  }

  loading(): void {
    this.text = '';
    this.el.classList.remove('pst-error');
    this.el.classList.add('pst-loading');
    this.status.textContent = 'Translating';
    this.output.textContent = 'Translating…';
    this.output.setAttribute('aria-busy', 'true');
    this.copy.disabled = true;
    this.retry.disabled = true;
    this.position();
  }

  success(text: string, cached: boolean): void {
    this.text = text;
    this.el.classList.remove('pst-loading', 'pst-error');
    this.status.textContent = cached ? 'Cached' : 'Complete';
    // Always plain text: model output can never inject HTML, images or active links.
    this.output.textContent = text;
    this.output.removeAttribute('aria-busy');
    this.copy.disabled = false;
    this.retry.disabled = false;
    this.retry.textContent = 'Translate again';
    this.position();
  }

  error(message: string): void {
    this.el.classList.remove('pst-loading');
    this.el.classList.add('pst-error');
    this.status.textContent = 'Failed';
    this.output.textContent = message;
    this.output.removeAttribute('aria-busy');
    this.retry.disabled = false;
    this.retry.textContent = 'Retry';
    this.position();
  }

  private async copyText(): Promise<void> {
    if (!this.text) return;
    try {
      await this.doc.defaultView!.navigator.clipboard.writeText(this.text);
      this.copy.textContent = 'Copied';
    } catch {
      this.copy.textContent = 'Select translation to copy';
    }
  }

  position(): void {
    const win = this.doc.defaultView;
    if (!win) return;
    const anchor: Anchor = this.selection.anchor;
    const margin = 12;
    const width = this.el.offsetWidth || Math.min(400, win.innerWidth - 2 * margin);
    const height = this.el.offsetHeight || 180;
    const left = Math.max(margin, Math.min(anchor.left, win.innerWidth - width - margin));
    const below = anchor.bottom + 14;
    const preferred = below + height <= win.innerHeight - margin ? below : anchor.top - height - 14;
    const top = Math.max(margin, Math.min(preferred, win.innerHeight - height - margin));
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  destroy(): void { this.el.remove(); }
}
