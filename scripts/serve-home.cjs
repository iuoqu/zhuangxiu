const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const staticFiles = new Map([
  ['/home.html', ['home.html', 'text/html; charset=utf-8']],
  ['/home.bundle.js', ['home.bundle.js', 'text/javascript; charset=utf-8']],
]);
const port = Number(process.env.HOME_PORT || 8765);

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  if (request.method === 'GET' && pathname === '/') {
    response.writeHead(302, { Location: '/home.html' }); response.end(); return;
  }
  if (request.method === 'GET' && staticFiles.has(pathname)) {
    const [file, type] = staticFiles.get(pathname);
    try {
      const content = await readFile(path.join(root, file));
      response.writeHead(200, { 'Content-Type': type }); response.end(content);
    } catch {
      response.writeHead(500); response.end('Unable to read local app');
    }
    return;
  }
  if (pathname === '/api/extract-plan-dimensions' || pathname === '/api/suggest-home-zones' ||
      pathname === '/api/read-home-plan' || pathname === '/api/find-home-spaces' ||
      pathname === '/api/classify-home-spaces' || pathname === '/api/recover-home-spaces') {
    let length = 0, body = '';
    if (request.method === 'POST') {
      const chunks = [];
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 3_000_000) {
          response.writeHead(413, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'Image request too large' }));
          return;
        }
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks).toString('utf8');
    }
    try {
      const apiFile = pathname === '/api/suggest-home-zones' ? 'suggest-home-zones.js' :
        pathname === '/api/read-home-plan' ? 'read-home-plan.js' :
          pathname === '/api/find-home-spaces' ? 'find-home-spaces.js' :
            pathname === '/api/classify-home-spaces' ? 'classify-home-spaces.js' :
              pathname === '/api/recover-home-spaces' ? 'recover-home-spaces.js' : 'extract-plan-dimensions.js';
      const { default: handler } = await import(pathToFileURL(path.join(root, 'api', apiFile)).href);
      await handler({ method: request.method, body }, {
        setHeader: (...args) => response.setHeader(...args),
        status(code) { response.statusCode = code; return this; },
        json(data) {
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(JSON.stringify(data));
        },
      });
    } catch {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'Local image-reading service failed' }));
    }
    return;
  }
  response.writeHead(404); response.end('Not found');
});

server.on('error', error => {
  process.stderr.write(`Local server could not start: ${error.message}\n`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Home demo: http://127.0.0.1:${server.address().port}/home.html\n`);
});
