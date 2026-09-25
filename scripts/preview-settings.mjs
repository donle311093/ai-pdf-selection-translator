// Synthetic settings preview; never reads a vault or contacts a model provider.
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const source = `
import { SettingsForm } from './src/settings';
import { DEFAULT_SETTINGS } from './src/core';
HTMLElement.prototype.empty = function() { this.replaceChildren(); };
HTMLElement.prototype.createEl = function(tag, options = {}) {
  const el = document.createElement(tag); el.textContent = options.text ?? ''; el.className = options.cls ?? '';
  for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, value);
  this.append(el); return el;
};
HTMLElement.prototype.createDiv = function(options = {}) { return this.createEl('div', options); };
const host = {
  settings: { ...DEFAULT_SETTINGS, baseUrl: 'https://api.example.com/v1', model: 'example-chat' }, forms: new Set(),
  translator: { clearCache() {} }, saveSettings: async () => {},
  refreshSettingsForms() { this.forms.forEach(form => form.refresh()); },
  connectionChanged() { this.forms.forEach(form => form.connectionChanged()); },
  loadModels: async () => ['example-chat', 'example-fast', 'provider/a-very-long-model-name-to-check-menu-wrapping'],
  testConnection: async () => 'Synthetic preview response',
};
new SettingsForm(document.getElementById('settings'), host);
document.getElementById('theme').onclick = () => document.body.classList.toggle('light');
document.getElementById('width').onclick = () => document.getElementById('settings').classList.toggle('narrow');
`;
const result = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser', alias: { obsidian: resolve('tests/settings-obsidian-mock.mjs') } });
const css = await readFile('styles.css', 'utf8');
const html = `<!doctype html><meta charset="utf-8"><title>Settings layout preview</title><style>
:root { --font-interface: system-ui, sans-serif; --font-ui-small: 13px; }
body { --background-primary:#202020;--background-secondary:#282828;--background-modifier-border:#414141;--background-modifier-hover:#353535;--text-normal:#dedede;--text-muted:#a0a0a0;--interactive-accent:#9b83ff;--text-accent:#b6a3ff; margin:0;background:var(--background-primary);color:var(--text-normal);font:14px system-ui; }
body.light { --background-primary:#fff;--background-secondary:#f5f5f5;--background-modifier-border:#dedede;--background-modifier-hover:#eeebff;--text-normal:#262626;--text-muted:#666;--interactive-accent:#7652db;--text-accent:#6840c9; }
header { padding:16px 32px;display:flex;gap:12px;align-items:center;border-bottom:1px solid var(--background-modifier-border); }
#settings { width:min(740px,calc(100% - 48px));margin:20px auto; } #settings.narrow { width:380px;max-width:calc(100% - 32px); }
.setting-item { display:flex;border-bottom:1px solid var(--background-modifier-border); }.setting-item-control { display:flex;align-items:center;justify-content:flex-end; } .setting-item-description {font-size:13px;} p {margin:0;}
input,button {box-sizing:border-box;font:inherit;color:var(--text-normal);border:1px solid var(--background-modifier-border);background:var(--background-secondary);padding:8px 10px;border-radius:6px;} button{cursor:pointer;} input[type=range]{width:100%;accent-color:var(--interactive-accent);} input[type=checkbox]{accent-color:var(--interactive-accent);}
${css}</style><header><strong>Settings preview · synthetic data</strong><button id="theme">Light / Dark</button><button id="width">Narrow / Wide</button></header><main id="settings"></main><script src="/preview.js"></script>`;
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/preview.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
  res.end(req.url === '/preview.js' ? result.outputFiles[0].text : html);
});
server.listen(0, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${server.address().port}`));
