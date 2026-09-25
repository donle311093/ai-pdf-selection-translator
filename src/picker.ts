import { Setting } from 'obsidian';

const openPickers = new WeakMap<Document, Picker>();
let nextId = 0;

export function closePickerWithin(container: HTMLElement): void {
  const picker = openPickers.get(container.ownerDocument);
  if (picker && container.contains(picker.button)) picker.close();
}

/** A themed listbox, without a native select or operating-system popup. */
export class Picker {
  readonly button: HTMLButtonElement;
  private label: HTMLSpanElement;
  private options = new Map<string, string>();
  private value = '';
  private changed: (value: string) => unknown = () => {};
  private popup: HTMLDivElement | null = null;
  private rows: HTMLElement[] = [];
  private active = 0;
  private cleanups: Array<() => void> = [];
  private prefix = '';
  private lastKey = 0;
  constructor(container: HTMLElement, name: string) {
    const doc = container.ownerDocument;
    this.button = doc.createElement('button');
    this.button.type = 'button'; this.button.className = 'pst-select';
    this.button.setAttribute('role', 'combobox');
    this.button.setAttribute('aria-label', name);
    this.button.setAttribute('aria-haspopup', 'listbox');
    this.button.setAttribute('aria-expanded', 'false');
    this.label = doc.createElement('span'); this.label.className = 'pst-select-label';
    const arrow = doc.createElement('span'); arrow.className = 'pst-select-arrow'; arrow.setAttribute('aria-hidden', 'true');
    this.button.append(this.label, arrow); container.append(this.button);
    this.button.addEventListener('click', () => this.popup ? this.close() : this.open());
    this.button.addEventListener('keydown', event => this.keydown(event));
  }
  addOption(value: string, label: string): this { this.options.set(value, label); return this; }
  addOptions(options: Record<string, string>): this { Object.entries(options).forEach(([v, label]) => this.addOption(v, label)); return this; }
  setValue(value: string): this {
    this.value = value; this.button.value = value;
    this.label.textContent = this.options.get(value) ?? value;
    this.button.title = this.label.textContent;
    return this;
  }
  onChange(callback: (value: string) => unknown): this { this.changed = callback; return this; }
  open(): void {
    if (this.popup || !this.options.size) return;
    const doc = this.button.ownerDocument; const win = doc.defaultView!;
    openPickers.get(doc)?.close(); openPickers.set(doc, this);
    const popup = doc.createElement('div'); this.popup = popup;
    popup.className = 'pst-select-menu'; popup.id = `pst-options-${++nextId}`;
    popup.setAttribute('role', 'listbox'); popup.setAttribute('aria-label', this.button.getAttribute('aria-label') ?? '');
    this.button.setAttribute('aria-controls', popup.id); this.button.setAttribute('aria-expanded', 'true');
    this.rows = [...this.options].map(([value, label], index) => {
      const row = doc.createElement('div'); row.className = 'pst-select-option'; row.id = `${popup.id}-${index}`;
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(value === this.value)); row.dataset.value = value;
      row.textContent = label; row.title = label;
      row.addEventListener('pointermove', () => this.highlight(index));
      row.addEventListener('mousedown', event => event.preventDefault());
      row.addEventListener('click', () => this.choose(index)); popup.append(row); return row;
    });
    doc.body.append(popup);
    const rect = this.button.getBoundingClientRect();
    const below = win.innerHeight - rect.bottom - 18, above = rect.top - 18;
    const up = below < 200 && above > below;
    const height = Math.max(0, Math.min(272, up ? above : below));
    const width = Math.max(0, Math.min(Math.max(rect.width, 240), win.innerWidth - 24));
    Object.assign(popup.style, {
      width: `${width}px`, maxHeight: `${height}px`,
      left: `${Math.max(12, Math.min(rect.left, win.innerWidth - width - 12))}px`,
      ...(up ? { bottom: `${win.innerHeight - rect.top + 6}px` } : { top: `${rect.bottom + 6}px` }),
    });
    this.active = Math.max(0, [...this.options.keys()].indexOf(this.value));
    this.highlight(this.active); this.button.focus();
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (target && !popup.contains(target) && !this.button.contains(target)) this.close();
    };
    const scroll = (event: Event) => { if (!popup.contains(event.target as Node)) this.close(); };
    const close = () => this.close();
    doc.addEventListener('pointerdown', outside, true); doc.addEventListener('focusin', outside, true);
    doc.addEventListener('scroll', scroll, true); win.addEventListener('resize', close); win.addEventListener('blur', close);
    this.cleanups = [() => doc.removeEventListener('pointerdown', outside, true), () => doc.removeEventListener('focusin', outside, true),
      () => doc.removeEventListener('scroll', scroll, true), () => win.removeEventListener('resize', close), () => win.removeEventListener('blur', close)];
  }
  private highlight(index: number): void {
    this.active = index;
    this.rows.forEach((row, i) => row.classList.toggle('is-active', i === index));
    const row = this.rows[index];
    if (row) { this.button.setAttribute('aria-activedescendant', row.id); row.scrollIntoView?.({ block: 'nearest' }); }
  }
  private choose(index: number): void {
    const value = [...this.options.keys()][index];
    if (value === undefined) return;
    const changed = value !== this.value;
    this.setValue(value); this.close(); this.button.focus();
    if (changed) void this.changed(value);
  }
  private keydown(event: KeyboardEvent): void {
    if (event.key === 'Tab') { this.close(); return; }
    if (event.key === 'Escape' && this.popup) { event.preventDefault(); event.stopPropagation(); this.close(); return; }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      if (!this.popup) { this.open(); return; }
      if (event.key === 'Enter' || event.key === ' ') this.choose(this.active);
      else this.highlight(event.key === 'Home' ? 0 : event.key === 'End' ? this.rows.length - 1
        : (this.active + (event.key === 'ArrowDown' ? 1 : -1) + this.rows.length) % this.rows.length);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      this.open();
      const now = Date.now(); this.prefix = (now - this.lastKey < 700 ? this.prefix : '') + event.key.toLowerCase(); this.lastKey = now;
      const index = [...this.options.values()].findIndex(label => label.toLowerCase().startsWith(this.prefix));
      if (index >= 0) this.highlight(index);
    }
  }
  close(): void {
    this.cleanups.forEach(remove => remove()); this.cleanups = [];
    this.popup?.remove(); this.popup = null; this.rows = []; this.prefix = '';
    this.button.setAttribute('aria-expanded', 'false'); this.button.removeAttribute('aria-controls'); this.button.removeAttribute('aria-activedescendant');
    if (openPickers.get(this.button.ownerDocument) === this) openPickers.delete(this.button.ownerDocument);
  }
}

export class PickerSetting extends Setting {
  addPicker(callback: (picker: Picker) => unknown): this {
    callback(new Picker(this.controlEl, this.nameEl.textContent ?? '')); return this;
  }
}
