import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { DEFAULT_SETTINGS, Translator, type Settings, type Transport } from '../src/core';
import { readPdfSelection } from '../src/selection';
import { SelectionController } from '../src/controller';

const wait = (ms = 45) => new Promise((resolve) => setTimeout(resolve, ms));
const response = (text: string) => ({ status: 200, text: JSON.stringify({ choices: [{ message: { content: text } }] }) });

function fixture(transport: Transport = async () => response('representation'), mode: Settings['triggerMode'] = 'auto') {
  const dom = new JSDOM(`<!doctype html><body>
    <div class="pdf-container"><div class="page" data-page-number="2"><div class="textLayer"><span id="first">A representation enables prediction.</span></div></div>
    <div class="page" data-page-number="3"><div class="textLayer"><span id="second">The next page discusses attention.</span></div></div></div>
    <div class="pdf-container"><div class="textLayer"><span id="other">Another document.</span></div></div>
    <div class="markdown-preview-view"><span id="note">Ordinary note content.</span></div>
    </body>`, { pretendToBeVisual: true });
  const doc = dom.window.document;
  (dom.window.Range.prototype as any).getClientRects = () => [{ left: 200, top: 150, right: 280, bottom: 170, width: 80, height: 20 }];
  const settings = { ...DEFAULT_SETTINGS, delayMs: 20, baseUrl: 'https://example.test/v1', model: 'test', triggerMode: mode };
  const notices: string[] = [];
  const controller = new SelectionController(doc, () => settings, new Translator(transport), () => {}, (message) => notices.push(message));
  function select(id = 'first', from = 2, to = 16, endId = id) {
    const range = doc.createRange();
    range.setStart(doc.getElementById(id)!.firstChild!, from);
    range.setEnd(doc.getElementById(endId)!.firstChild!, to);
    const selection = doc.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    doc.dispatchEvent(new dom.window.Event('selectionchange'));
  }
  function pointer(name: string, target: Element = doc.getElementById('first')!, button = 0) {
    target.dispatchEvent(new dom.window.MouseEvent(name, { bubbles: true, button }));
  }
  return { dom, doc, settings, notices, controller, select, pointer, close: () => { controller.destroy(); dom.window.close(); } };
}

test('PDF selections capture page and nearby text; note and cross-document selections are rejected', () => {
  const f = fixture();
  try {
    f.select();
    const selected = readPdfSelection(f.doc)!;
    assert.equal(selected.text, 'representation');
    assert.equal(selected.page, '2');
    assert.match(selected.context, /prediction/);
    f.select('note', 0, 8);
    assert.equal(readPdfSelection(f.doc), null);
    f.select('first', 2, 7, 'other');
    assert.equal(readPdfSelection(f.doc), null);
    f.select('first', 2, 7, 'second');
    assert.ok(readPdfSelection(f.doc));
  } finally { f.close(); }
});

test('selection after pointer release shows one translation; repeated selection events are deduplicated', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return response('representation'); });
  try {
    f.pointer('pointerdown'); f.select();
    await wait(); assert.equal(calls, 0);
    f.pointer('pointerup');
    f.doc.dispatchEvent(new f.dom.window.Event('selectionchange'));
    await wait();
    assert.equal(calls, 1);
    assert.equal(f.doc.querySelector('.pst-output')?.textContent, 'representation');
    assert.equal(f.doc.getSelection()!.toString(), 'representation');
    f.doc.dispatchEvent(new f.dom.window.Event('selectionchange'));
    await wait(); assert.equal(calls, 1);
  } finally { f.close(); }
});

test('button mode performs no network request until the user clicks Translate', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return response('translation result'); }, 'button');
  try {
    f.select(); await wait();
    assert.equal(calls, 0);
    assert.ok(f.doc.querySelector('.pst-popover'));
    (f.doc.querySelector('.pst-retry') as HTMLButtonElement).click();
    await wait(); assert.equal(calls, 1);
  } finally { f.close(); }
});

test('off mode waits for explicit command and can use selection snapshot from command palette', async () => {
  let calls = 0;
  const f = fixture(async () => { calls++; return response('command translation'); }, 'command');
  try {
    f.select(); await wait(); assert.equal(calls, 0);
    assert.equal(f.doc.querySelector('.pst-popover'), null);
    f.doc.getSelection()!.removeAllRanges();
    f.doc.dispatchEvent(new f.dom.window.Event('selectionchange'));
    f.controller.translateCommand(); await wait();
    assert.equal(calls, 1);
    assert.equal(f.doc.querySelector('.pst-output')?.textContent, 'command translation');
  } finally { f.close(); }
});

test('new selection aborts previous request and late old results never overwrite new translation', async () => {
  const pending: Array<{ signal: AbortSignal; resolve: (value: any) => void }> = [];
  const f = fixture(async (_request, signal) => new Promise((resolve) => pending.push({ signal, resolve })));
  try {
    f.select(); await wait();
    f.select('first', 25, 35); await wait();
    assert.equal(pending.length, 2);
    assert.equal(pending[0].signal.aborted, true);
    pending[1].resolve(response('new translation')); await wait();
    pending[0].resolve(response('old translation')); await wait();
    assert.equal(f.doc.querySelector('.pst-output')?.textContent, 'new translation');
  } finally { f.close(); }
});

test('model HTML is displayed as plain text and never creates active DOM', async () => {
  const text = '<img src="https://example.test/tracker" onerror="alert(1)">';
  const f = fixture(async () => response(text));
  try {
    f.select(); await wait();
    assert.equal(f.doc.querySelector('.pst-output')?.textContent, text);
    assert.equal(f.doc.querySelector('.pst-output img'), null);
  } finally { f.close(); }
});

test('Escape, scrolling and disposal cancel pending work without reopening the popup', async () => {
  for (const action of ['escape', 'scroll', 'dispose']) {
    let signal: AbortSignal | undefined;
    let finish!: (value: any) => void;
    const f = fixture(async (_request, current) => { signal = current; return new Promise((resolve) => { finish = resolve; }); });
    try {
      f.select(); await wait();
      if (action === 'escape') f.doc.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
      else if (action === 'scroll') f.doc.dispatchEvent(new f.dom.window.Event('scroll'));
      else f.controller.destroy();
      assert.equal(signal!.aborted, true);
      finish(response('stale result')); await wait();
      assert.equal(f.doc.querySelector('.pst-popover'), null);
    } finally { f.close(); }
  }
});

test('a second document (popout window) has independent selection and listeners', async () => {
  const a = fixture(async () => response('main window'));
  const b = fixture(async () => response('popout window'));
  try {
    a.select(); b.select(); await wait();
    assert.equal(a.doc.querySelector('.pst-output')?.textContent, 'main window');
    assert.equal(b.doc.querySelector('.pst-output')?.textContent, 'popout window');
    a.controller.destroy();
    assert.ok(b.doc.querySelector('.pst-popover'));
  } finally { a.close(); b.close(); }
});

test('right-click dismisses the translation card and preserves the native PDF menu and selection', async () => {
  const f = fixture();
  try {
    f.select();
    await wait();
    assert.ok(f.doc.querySelector('.pst-popover'));
    const event = new f.dom.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    assert.equal(f.doc.getElementById('first')!.dispatchEvent(event), true);
    assert.equal(event.defaultPrevented, false);
    assert.equal(f.doc.querySelector('.pst-popover'), null);
    assert.equal(f.doc.getSelection()!.toString(), 'representation');
  } finally { f.close(); }
});
