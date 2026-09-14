// Minimal no-cache static server, Node equivalent of _dev_server.py
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = +(process.argv[2] || 8642);
const ROOT = __dirname;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary',
};

http.createServer((req, res) => {
  // in-app save: POST /api/save-model writes the JSON into Saved Models/
  // next to the app — dev parity with the Electron build's Downloads folder
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/save-model') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const dir = path.join(__dirname, 'Saved Models');
        fs.mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        // ?name= overrides the filename (e.g. AI-AUTHORING.md) — sanitized to
        // a bare filename so nothing escapes the save folder
        let name = `websketch-${stamp}.json`;
        try {
          const q = new URL(req.url, 'http://x').searchParams.get('name') || '';
          const safe = q.replace(/[^A-Za-z0-9._-]/g, '').replace(/^\.+/, '');
          if (safe) name = safe;
        } catch (e) { }
        const file = path.join(dir, name);
        fs.writeFileSync(file, Buffer.concat(chunks));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: file }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
      }
    });
    return;
  }
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (p === '/') p = '/index.html';
  // traversal guard: resolve FIRST, then compare against the root with a
  // separator boundary — a raw startsWith(ROOT) lets /foo/../root-evil pass
  const file = path.resolve(ROOT, '.' + path.posix.normalize('/' + p));
  const root = path.resolve(ROOT);
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store, must-revalidate',
    });
    res.end(data);
  });
}).listen(PORT, () => console.log('serving on', PORT));
