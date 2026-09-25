import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { DEFAULT_SETTINGS } from '../src/core';
import type PdfSelectionTranslatorPlugin from '../src/main';
import type { SettingsForm as Form } from '../src/settings';

let SettingsForm: typeof Form;
before(async () => {
  const compiled = await build({ entryPoints: [resolve('src/settings.ts')], bundle: true, write: false, format: 'esm', platform: 'node', alias: { obsidian: resolve('tests/settings-obsidian-mock.mjs') } });
  ({ SettingsForm } = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')) as { SettingsForm: typeof Form });
});
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function fixture() {
  const dom = new JSDOM('<body><div id="settings"></div><div id="modal"></div></body>');
  const doc = dom.window.document;
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    empty: { value(this: HTMLElement) { this.replaceChildren(); } },
    createEl: { value(this: HTMLElement, tag: string, options: { text?: string; cls?: string; attr?: Record<string, string> } = {}) {
      const el = doc.createElement(tag); el.textContent = options.text ?? ''; el.className = options.cls ?? '';
      for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, value);
      this.append(el); return el;
    } },
    createDiv: { value(this: HTMLElement, options = {}) { return this.createEl('div', options); } },
  });
  const forms = new Set<Form>();
  const pending: { controller: AbortController; resolve: (ids: string[]) => void }[] = [];
  const settings = { ...DEFAULT_SETTINGS, baseUrl: 'https://example.test/v1', apiKey: 'session-test-key' };
  const saved: unknown[] = [];
  const host = {
    forms, settings, translator: { clearCache() {} },
    saveSettings: async () => { pending.forEach(item => item.controller.abort()); saved.push({ ...settings, apiKey: settings.rememberKey ? settings.apiKey : '' }); },
    refreshSettingsForms: () => forms.forEach(form => form.refresh()),
    connectionChanged: () => forms.forEach(form => form.connectionChanged()),
    loadModels: (controller: AbortController) => new Promise<string[]>(resolve => pending.push({ controller, resolve })),
    testConnection: async () => 'translation',
  } as unknown as PdfSelectionTranslatorPlugin;
  const root = doc.getElementById('settings')!;
  const form = new SettingsForm(root, host);
  const field = (label: string, target = root) => {
    const el = target.querySelector<HTMLInputElement | HTMLButtonElement>(`[aria-label="${label}"]`);
    assert.ok(el, `Missing field: ${label}`); return el;
  };
  const change = async (label: string, value: string, event = 'change') => {
    const el = field(label);
    if (el.getAttribute('role') === 'combobox') {
      el.click();
      const option = [...doc.querySelectorAll<HTMLElement>('[role="option"]')].find(row => row.dataset.value === value);
      assert.ok(option, `Missing option: ${value}`); option.click();
    } else { el.value = value; el.dispatchEvent(new dom.window.Event(event, { bubbles: true })); }
    await tick();
  };
  const click = (label: string) => {
    const button = [...root.querySelectorAll('button')].find(el => el.textContent === label); assert.ok(button); button.click();
  };
  return { dom, doc, root, host, settings, saved, pending, form, field, change, click, close() { forms.forEach(item => item.destroy()); dom.window.close(); } };
}

test('settings fetch models, populate dropdown, and preserve manual selection until explicitly changed', async () => {
  const f = fixture();
  try {
    f.click('Fetch models'); assert.equal(f.pending.length, 1);
    f.pending[0].resolve(['chat-a', 'chat-b']); await tick();
    assert.equal(f.settings.model, '');
    await f.change('Select model', 'chat-b');
    assert.equal(f.settings.model, 'chat-b'); assert.equal(f.field('Model name').value, 'chat-b');
    await f.change('Model name', 'custom-chat', 'input');
    assert.equal(f.settings.model, 'custom-chat'); assert.equal(f.field('Select model').value, '');
  } finally { f.close(); }
});

test('settings views preserve target language and never save a session-only key', async () => {
  const f = fixture();
  try {
    const modal = f.doc.getElementById('modal')!; new SettingsForm(modal, f.host);
    await f.change('Target language', 'Japanese');
    assert.equal(f.settings.targetLanguage, 'Japanese'); assert.equal(f.settings.apiKey, 'session-test-key');
    assert.equal(f.field('Target language').value, 'Japanese');
    assert.ok(f.root.textContent?.includes('Fetch models'));
    assert.ok(f.saved.every(value => (value as { apiKey: string }).apiKey === ''));
    await f.change('Target language', '__custom__'); await f.change('Custom target language', 'Klingon', 'input');
    assert.equal(f.field('Custom target language').value, 'Klingon');
  } finally { f.close(); }
});

test('changing endpoint or key aborts discovery and never displays stale models; closing cancels pending work', async () => {
  for (const field of ['Endpoint', 'API Key']) {
    const f = fixture();
    try {
      f.click('Fetch models');
      await f.change(field, field === 'API Key' ? 'new-key' : 'https://other.test/v1', 'input');
      assert.equal(f.pending[0].controller.signal.aborted, true);
      f.pending[0].resolve(['stale-model']); await tick();
      assert.ok(!f.root.textContent?.includes('stale-model'));
      f.click('Fetch models'); f.form.destroy();
      assert.equal(f.pending[1].controller.signal.aborted, true);
      f.pending[1].resolve(['closed-model']); await tick();
      assert.ok(!f.root.textContent?.includes('closed-model'));
    } finally { f.close(); }
  }
});

test('custom pickers support keyboard selection, Escape cancellation, outside dismissal and form cleanup', async () => {
  const f = fixture();
  try {
    assert.equal(f.root.querySelectorAll('select').length, 0);
    const button = f.field('Translation trigger');
    const key = (value: string) => button.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
    key('ArrowDown'); assert.equal(button.getAttribute('aria-expanded'), 'true');
    key('ArrowDown'); key('Escape'); assert.equal(f.settings.triggerMode, 'auto');
    assert.equal(f.doc.querySelector('[role="listbox"]'), null);
    key('Enter'); key('End'); key('Enter'); await tick();
    assert.equal(f.settings.triggerMode, 'command'); assert.equal(f.doc.activeElement, button);
    button.click(); f.doc.body.dispatchEvent(new f.dom.window.Event('pointerdown', { bubbles: true }));
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    button.click(); f.form.destroy();
    assert.equal(f.doc.querySelector('[role="listbox"]'), null);
  } finally { f.close(); }
});

test('language rerender removes its picker portal', async () => {
  const f = fixture();
  try {
    f.field('Target language').click();
    assert.equal(f.doc.querySelectorAll('[role="listbox"]').length, 1);
    const option = [...f.doc.querySelectorAll<HTMLElement>('[role="option"]')].find(row => row.dataset.value === 'English')!;
    option.click(); await tick();
    assert.equal(f.doc.querySelector('[role="listbox"]'), null);
    assert.equal(f.root.querySelector('select'), null);
    assert.equal(f.field('Target language').value, 'English');
  } finally { f.close(); }
});
