import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/core';
import { fetchModels, modelsUrl, TARGET_LANGUAGES } from '../src/models';
import { desktopTransport } from '../src/transport';

test('model endpoints preserve custom prefixes and remove the full completions suffix', () => {
  assert.equal(modelsUrl('https://example.test'), 'https://example.test/v1/models');
  assert.equal(modelsUrl('https://example.test/compatible-mode/v1/'), 'https://example.test/compatible-mode/v1/models');
  assert.equal(modelsUrl('https://example.test/custom/chat/completions'), 'https://example.test/custom/models');
  assert.throws(() => modelsUrl('https://user:secret@example.test/v1'));
  assert.throws(() => modelsUrl('https://example.test/v1?key=secret'));
});

test('model discovery uses an authenticated GET without model selection or paper content', async () => {
  let method, path, auth, body = '';
  const server = createServer((req, res) => {
    method = req.method; path = req.url; auth = req.headers.authorization;
    req.on('data', chunk => { body += String(chunk); });
    req.on('end', () => res.end(JSON.stringify({ data: [{ id: 'z-chat' }, { id: 'a-chat' }, { id: 'z-chat' }, null, { id: 5 }] })));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await fetchModels({ ...DEFAULT_SETTINGS, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/custom/v1`, apiKey: 'synthetic-key' }, desktopTransport, new AbortController().signal);
    assert.deepEqual(result, ['a-chat', 'z-chat']);
    assert.equal(method, 'GET'); assert.equal(path, '/custom/v1/models'); assert.equal(auth, 'Bearer synthetic-key'); assert.equal(body, '');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('model discovery sanitizes provider failures, validates lists, and rejects late cancelled results', async () => {
  const settings = { ...DEFAULT_SETTINGS, uiLanguage: 'en' as const, baseUrl: 'https://example.test/v1' };
  for (const response of [{ status: 401, text: 'private-secret' }, { status: 404, text: 'private-secret' }, { status: 200, text: 'null' }, { status: 200, text: '{"data":[]}' }]) {
    await assert.rejects(fetchModels(settings, async () => response, new AbortController().signal), (error: Error) => {
      assert.ok(!error.message.includes('private-secret')); assert.ok(!/[\u3400-\u9fff]/.test(error.message)); return true;
    });
  }
  const controller = new AbortController();
  await assert.rejects(fetchModels(settings, async () => { controller.abort(); return { status: 200, text: '{"data":[{"id":"old"}]}' }; }, controller.signal), { name: 'AbortError' });
});

test('interface language migrates independently of existing translation language and credentials', () => {
  assert.equal(normalizeSettings({ targetLanguage: 'Klingon' }).uiLanguage, 'en');
  assert.equal(normalizeSettings({ targetLanguage: 'Klingon', uiLanguage: 'en' }).targetLanguage, 'Klingon');
  assert.equal(normalizeSettings({ uiLanguage: 'invalid' }).uiLanguage, 'en');
  assert.equal(new Set(TARGET_LANGUAGES.map(([value]) => value)).size, 16);
});
