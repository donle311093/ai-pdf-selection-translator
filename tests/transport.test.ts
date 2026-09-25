import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { desktopTransport } from '../src/transport';
import { buildRequest, DEFAULT_SETTINGS, Translator } from '../src/core';

async function server(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const instance = createServer(handler);
  await new Promise<void>((resolve) => instance.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(instance.address() as AddressInfo).port}/v1`,
    close: async () => { instance.closeAllConnections(); await new Promise<void>((resolve) => instance.close(() => resolve())); },
  };
}

test('real HTTP integration: authentication, Unicode request body and Chat Completions response', async () => {
  const received: Array<{ path: string; auth: string; body: any }> = [];
  const mock = await server((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received.push({ path: req.url!, auth: req.headers.authorization!, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: 'Representation: features learned from data.' } }] }));
    });
  });
  try {
    const translator = new Translator(desktopTransport);
    const result = await translator.translate({ ...DEFAULT_SETTINGS, baseUrl: mock.url, model: 'mock-model', apiKey: 'local-test-key' }, { text: 'representation', context: 'test context' }, new AbortController().signal);
    assert.match(result.text, /Representation/);
    assert.equal(received.length, 1);
    assert.equal(received[0].path, '/v1/chat/completions');
    assert.equal(received[0].auth, 'Bearer local-test-key');
    assert.equal(JSON.parse(received[0].body.messages[1].content).nearby_context, 'test context');
  } finally { await mock.close(); }
});

test('abort closes an active HTTP response and rejects promptly', async () => {
  let started!: () => void;
  const begun = new Promise<void>((resolve) => { started = resolve; });
  let closed!: () => void;
  const ended = new Promise<void>((resolve) => { closed = resolve; });
  const mock = await server((_req, res) => { res.on('close', closed); started(); });
  try {
    const controller = new AbortController();
    const request = buildRequest({ ...DEFAULT_SETTINGS, baseUrl: mock.url, model: 'mock' }, { text: 'hello', context: '' });
    const pending = desktopTransport(request, controller.signal);
    const assertion = assert.rejects(pending, { name: 'AbortError' });
    await begun;
    controller.abort();
    await assertion;
    await ended;
  } finally { await mock.close(); }
});

test('absolute timeout covers a server that never sends headers', async () => {
  const mock = await server(() => {});
  try {
    const request = buildRequest({ ...DEFAULT_SETTINGS, baseUrl: mock.url, model: 'mock' }, { text: 'hello', context: '' });
    request.timeoutMs = 40;
    await assert.rejects(desktopTransport(request, new AbortController().signal), /exceeded/);
  } finally { await mock.close(); }
});

test('redirects are returned as errors, never forwarding authorization to another URL', async () => {
  let destinationHits = 0;
  const destination = await server((_req, res) => { destinationHits++; res.end('unexpected'); });
  const mock = await server((_req, res) => { res.writeHead(302, { Location: destination.url }); res.end(); });
  try {
    const translator = new Translator(desktopTransport);
    await assert.rejects(translator.translate({ ...DEFAULT_SETTINGS, baseUrl: mock.url, model: 'mock', apiKey: 'test' }, { text: 'hello', context: '' }, new AbortController().signal), /302/);
    assert.equal(destinationHits, 0);
  } finally { await mock.close(); await destination.close(); }
});

test('oversized responses and truncated sockets fail cleanly', async () => {
  const huge = await server((_req, res) => { res.end('x'.repeat(2 * 1024 * 1024 + 100)); });
  const truncated = await server((_req, res) => { res.writeHead(200, { 'Content-Length': '10000' }); res.write('partial'); setTimeout(() => res.destroy(), 10); });
  try {
    for (const mock of [huge, truncated]) {
      const request = buildRequest({ ...DEFAULT_SETTINGS, baseUrl: mock.url, model: 'mock' }, { text: 'hello', context: '' });
      await assert.rejects(desktopTransport(request, new AbortController().signal));
    }
  } finally { await huge.close(); await truncated.close(); }
});
