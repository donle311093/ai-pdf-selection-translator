import { abortError, completionUrl, type Settings, type Transport } from './core';

export function modelsUrl(baseUrl: string): string {
  const url = new URL(completionUrl(baseUrl));
  url.pathname = url.pathname.replace(/\/chat\/completions$/, '/models');
  return url.toString();
}

export async function fetchModels(settings: Settings, transport: Transport, signal: AbortSignal): Promise<string[]> {
  if (signal.aborted) throw abortError();
  const response = await transport({
    url: modelsUrl(settings.baseUrl), method: 'GET', body: '',
    headers: { Accept: 'application/json', ...(settings.apiKey.trim() ? { Authorization: `Bearer ${settings.apiKey.trim()}` } : {}) },
    timeoutMs: settings.timeoutSeconds * 1000,
  }, signal);
  if (signal.aborted) throw abortError();
  if (response.status < 200 || response.status >= 300) {
    const reason = response.status === 401 || response.status === 403
      ? 'Check your API key and account permissions.'
      : response.status === 404 || response.status === 405
        ? 'This service does not provide a model list. Enter a model ID manually.'
        : 'Could not fetch models. Retry later or enter a model ID manually.';
    throw new Error(`HTTP ${response.status}: ${reason}`);
  }
  let data: unknown;
  try { data = JSON.parse(response.text); } catch { throw new Error('The model list is not valid JSON. Check the endpoint.'); }
  const entries: unknown = data && typeof data === 'object' && 'data' in data ? data.data : undefined;
  if (!Array.isArray(entries)) throw new Error('Unsupported model list format. Enter a model ID manually.');
  const ids = new Set<string>();
  for (const entry of entries as unknown[]) {
    if (entry && typeof entry === 'object' && 'id' in entry && typeof entry.id === 'string' && entry.id.trim()) ids.add(entry.id.trim());
  }
  if (!ids.size) throw new Error('No models were returned. Check permissions or enter a model ID manually.');
  return [...ids].sort((a, b) => a.localeCompare(b));
}

export const TARGET_LANGUAGES = [
  ['Chinese (Simplified)', 'Chinese (Simplified)'], ['Chinese (Traditional)', 'Chinese (Traditional)'],
  ['English', 'English'], ['Japanese', 'Japanese'], ['Korean', 'Korean'],
  ['French', 'French'], ['German', 'German'], ['Spanish', 'Spanish'],
  ['Portuguese', 'Portuguese'], ['Italian', 'Italian'], ['Russian', 'Russian'],
  ['Arabic', 'Arabic'], ['Hindi', 'Hindi'], ['Thai', 'Thai'],
  ['Vietnamese', 'Vietnamese'], ['Indonesian', 'Indonesian'],
] as const;
