import { createServer } from 'node:http';
import { handleProcess } from './handler.js';

const PORT = Number(process.env.PORT ?? 8080);

createServer(async (req, res) => {
  // The Containers proxy drops a request body sent on a reused connection (seen after its ping).
  res.setHeader('connection', 'close');
  if (req.method === 'GET' && req.url === '/ping') return res.end('ok');
  if (req.method !== 'POST' || req.url !== '/process') {
    res.statusCode = 404;
    return res.end();
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const started = Date.now();
    const out = await handleProcess(new Uint8Array(Buffer.concat(chunks)));
    console.log(`processed ${chunks.reduce((n, c) => n + c.length, 0)} B in ${Date.now() - started} ms`);
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('content-length', out.length);
    res.end(out);
  } catch (error) {
    console.error(`process failed: ${error?.message ?? error}`);
    res.statusCode = 500;
    res.end(String(error?.message ?? error));
  }
}).listen(PORT, () => console.log(`cloud container listening on ${PORT}`));
