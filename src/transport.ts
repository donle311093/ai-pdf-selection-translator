import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { setTimeout as setNodeTimeout, clearTimeout as clearNodeTimeout } from 'node:timers';
import { abortError, type Transport } from './core';

/** Desktop Node transport: no browser CORS, abortable, no cross-host redirects. */
export const desktopTransport: Transport = (input, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) { reject(abortError()); return; }
  const url = new URL(input.url);
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  let settled = false;
  let timer: ReturnType<typeof setNodeTimeout> | undefined;
  const finish = (error?: Error, response?: { status: number; text: string }) => {
    if (settled) return;
    settled = true;
    clearNodeTimeout(timer);
    signal.removeEventListener('abort', cancel);
    if (error) reject(error); else resolve(response!);
  };
  const request = send(url, {
    method: input.method ?? 'POST',
    headers: { ...input.headers, ...(input.method === 'GET' ? {} : { 'Content-Length': Buffer.byteLength(input.body) }) },
  }, (response) => {
    const chunks: Buffer[] = [];
    let length = 0;
    response.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > 2 * 1024 * 1024) {
        finish(new Error('Endpoint response exceeded 2 MB. Reception stopped.'));
        response.destroy();
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    response.on('end', () => finish(undefined, { status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
    response.on('error', () => finish(new Error('Connection interrupted while receiving response. Retry.')));
    response.on('aborted', () => finish(new Error('Provider disconnected early. Retry.')));
  });
  const cancel = () => { finish(abortError()); request.destroy(); };
  request.on('error', (error: NodeJS.ErrnoException) => {
    const message = error.code === 'ENOTFOUND' ? 'Endpoint host not found. Check address and network.'
      : error.code === 'ECONNREFUSED' ? 'Connection refused. Check address, port, and local model service.'
      : /CERT|TLS|SSL/.test(error.code ?? '') ? 'Endpoint TLS certificate validation failed. Check provider certificate.'
      : 'Network connection failed. Check network and endpoint.';
    finish(new Error(message));
  });
  signal.addEventListener('abort', cancel, { once: true });
  timer = setNodeTimeout(() => {
    finish(new Error(`Request exceeded ${Math.round(input.timeoutMs / 1000)} seconds. Reduce selection or increase timeout.`));
    request.destroy();
  }, input.timeoutMs);
  if (signal.aborted) cancel();
  else request.end(input.method === 'GET' ? undefined : input.body);
});
