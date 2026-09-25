import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, Translator, buildRequest, completionUrl, normalizeSettings, normalizeText, parseResponse, type Settings } from '../src/core';

const settings: Settings = { ...DEFAULT_SETTINGS, baseUrl: 'https://example.test/v1', model: 'test-model', apiKey: 'test-only-key' };
const input = { text: 'representation', context: 'A learned representation improves prediction.' };
const signal = () => new AbortController().signal;
const ok = (text = 'representation') => ({ status: 200, text: JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }) });

test('base URLs and full endpoints retain custom proxy prefixes', () => {
  assert.equal(completionUrl(' https://example.test '), 'https://example.test/v1/chat/completions');
  assert.equal(completionUrl('https://example.test/v1/'), 'https://example.test/v1/chat/completions');
  assert.equal(completionUrl('https://example.test/proxy/api/'), 'https://example.test/proxy/api/chat/completions');
  assert.equal(completionUrl('https://example.test/chat/completions/'), 'https://example.test/chat/completions');
  assert.equal(completionUrl('http://127.0.0.1:1234/v1'), 'http://127.0.0.1:1234/v1/chat/completions');
});

test('invalid endpoints fail before any credentials are sent', () => {
  for (const value of ['', 'example.test', 'file:///data', 'https://user:password@example.test', 'https://example.test?key=secret', 'https://example.test#key', 'https://example.test/v1/responses', 'https://example.test/v1/messages']) {
    assert.throws(() => completionUrl(value));
  }
});

test('PDF whitespace, soft hyphens and wrapped English words normalize', () => {
  assert.equal(normalizeText('  repre-\nsentation  \t learning\u00ad\u200b '), 'representation learning');
  assert.equal(normalizeText('state-of-the-art research'), 'state-of-the-art research');
});

test('saved settings tolerate malformed data and do not reload a session-only key', () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  const result = normalizeSettings({ apiKey: 'do-not-load', delayMs: NaN, maxChars: -1, timeoutSeconds: 900, triggerMode: 'bad' });
  assert.equal(result.apiKey, '');
  assert.equal(result.delayMs, DEFAULT_SETTINGS.delayMs);
  assert.equal(result.maxChars, 100);
  assert.equal(result.timeoutSeconds, 180);
  assert.equal(result.triggerMode, 'auto');
  assert.equal(normalizeSettings({ apiKey: 'remembered', rememberKey: true }).apiKey, 'remembered');
});

test('requests send only selected data and optional bounded context', () => {
  const request = buildRequest(settings, input);
  assert.equal(request.headers.Authorization, 'Bearer test-only-key');
  const body = JSON.parse(request.body);
  assert.equal(body.stream, false);
  assert.equal(body.model, 'test-model');
  assert.deepEqual(JSON.parse(body.messages[1].content), { selected_text: input.text, nearby_context: input.context });
  const privateRequest = buildRequest({ ...settings, apiKey: '', includeContext: false }, input);
  assert.equal(privateRequest.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(JSON.parse(privateRequest.body).messages[1].content), { selected_text: input.text });
  assert.ok(!request.body.includes('test-only-key'));
});

test('blank selection, empty model and oversized selection never reach network', async () => {
  let calls = 0;
  const translator = new Translator(async () => { calls++; return ok(); });
  await assert.rejects(translator.translate(settings, { text: ' ', context: '' }, signal()));
  await assert.rejects(translator.translate({ ...settings, model: '' }, input, signal()));
  await assert.rejects(translator.translate({ ...settings, maxChars: 3 }, input, signal()), /Reduce selection/);
  assert.equal(calls, 0);
});

test('successful text and text-array responses parse; malformed and truncated output fails', () => {
  assert.equal(parseResponse(ok()), 'representation');
  assert.equal(parseResponse({ status: 200, text: JSON.stringify({ choices: [{ message: { content: [{ type: 'text', text: 'translation' }] } }] }) }), 'translation');
  for (const response of [
    { status: 200, text: '<html>oops</html>' },
    { status: 200, text: '{}' },
    { status: 200, text: 'null' },
    { status: 200, text: '{"choices":[null]}' },
    { status: 200, text: '{"choices":[{"message":{"content":[null,42,{"type":"text","text":3}]}}]}' },
    { status: 200, text: JSON.stringify({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }) },
  ]) assert.throws(() => parseResponse(response));
});

test('provider errors cannot echo secrets or untrusted response bodies', () => {
  for (const status of [400, 401, 403, 404, 413, 429, 500, 302]) {
    assert.throws(() => parseResponse({ status, text: 'test-only-key <script>unsafe</script>' }), (error: Error) => {
      assert.ok(error.message.includes(String(status)));
      assert.ok(!error.message.includes('test-only-key'));
      assert.ok(!error.message.includes('<script>'));
      return true;
    });
  }
});

test('memory cache avoids repeat calls and isolates model, key, context and endpoint', async () => {
  let calls = 0;
  const translator = new Translator(async () => { calls++; return ok(); });
  assert.equal((await translator.translate(settings, input, signal())).cached, false);
  assert.equal((await translator.translate(settings, input, signal())).cached, true);
  assert.equal(calls, 1);
  await translator.translate({ ...settings, model: 'another' }, input, signal());
  await translator.translate({ ...settings, apiKey: 'another' }, input, signal());
  await translator.translate({ ...settings, baseUrl: 'https://another.test/v1' }, input, signal());
  await translator.translate(settings, { ...input, context: 'A different meaning' }, signal());
  assert.equal(calls, 5);
  await translator.translate(settings, input, signal(), true);
  assert.equal(calls, 6);
  translator.clearCache();
  assert.equal((await translator.translate(settings, input, signal())).cached, false);
});

test('failed or cancelled results are never cached; LRU size is bounded', async () => {
  let calls = 0;
  const translator = new Translator(async () => { calls++; return calls === 1 ? { status: 429, text: '' } : ok(); }, 1);
  await assert.rejects(translator.translate(settings, input, signal()));
  await translator.translate(settings, input, signal());
  const controller = new AbortController(); controller.abort();
  await assert.rejects(translator.translate(settings, input, controller.signal), { name: 'AbortError' });
  await translator.translate(settings, { ...input, text: 'other' }, signal());
  assert.equal((await translator.translate(settings, input, signal())).cached, false);
  assert.equal(calls, 4);
});
