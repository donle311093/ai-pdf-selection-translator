import { createServer } from 'node:http';
import { writeFile, mkdir } from 'node:fs/promises';
// Local UI smoke test only. Never logs or persists selected paper text.
const server = createServer((req, res) => {
  let data = '';
  req.on('data', (chunk) => { data += chunk; });
  req.on('end', () => {
    try {
      const body = JSON.parse(data);
      const input = JSON.parse(body.messages.at(-1).content);
      console.log(`Mock request accepted: ${input.selected_text.length} characters`);
      setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: '[Local mock response]\nSelection and endpoint request succeeded. Your configured model translation appears here.' }, finish_reason: 'stop' }] }));
      }, 600);
    } catch {
      res.writeHead(400); res.end('{}');
    }
  });
});
server.listen(0, '127.0.0.1', async () => {
  await mkdir('.test-output', { recursive: true });
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  await writeFile('.test-output/mock-endpoint.txt', endpoint);
  console.log(`Local mock ready: ${endpoint}`);
});
