import { build } from 'esbuild';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
await mkdir('dist/pdf-selection-translator', { recursive: true });
await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/pdf-selection-translator/main.js',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'es2020',
  external: ['obsidian', 'electron'],
  sourcemap: false,
  minify: true,
  banner: { js: `/* PDF Selection Translator ${manifest.version} | Copyright 2026 xfrrn | MIT */` },
  logLevel: 'info',
});
// The community directory verifies dist/main.js against the release attachment.
await copyFile('dist/pdf-selection-translator/main.js', 'dist/main.js');
for (const file of ['manifest.json', 'styles.css']) {
  await copyFile(file, `dist/pdf-selection-translator/${file}`);
}
