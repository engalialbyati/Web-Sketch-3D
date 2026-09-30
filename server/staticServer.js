'use strict';
// Static file server for the app itself (the bridge on :3001 is API-only).
// Serves the project root so index.html, js/, css/, assets/ all resolve —
// fetch()-based features (bundled textures, component JSON, workers) need
// http://, not file://. `npm run serve` (PORT env to override, default 8742).
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8742;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.zip': 'application/zip',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.obj': 'text/plain',
  '.mtl': 'text/plain', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg',
  '.md': 'text/markdown; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

http.createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    const file = path.normalize(path.join(ROOT, urlPath));
    if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found: ' + urlPath); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  } catch (e) {
    res.writeHead(500); res.end('error');
  }
}).listen(PORT, () => {
  console.log(`WebSketch 3D app served at http://127.0.0.1:${PORT}/ (root: ${ROOT})`);
});
