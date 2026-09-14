// WebSketch 3D — Electron main process.
// The app is a static site whose persistence uses localStorage + IndexedDB,
// both of which Chromium restricts on file:// — so the main process serves
// the app over http://127.0.0.1:<port> (zero dependencies) and the window
// loads that origin. Production users get the same storage semantics as the
// web build, isolated per machine.
'use strict';
const { app, BrowserWindow, Menu, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..'); // the repo/app root
const PORT = 0; // let the OS pick a free port

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};

function startServer() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      try {
        let p = decodeURIComponent((req.url || '/').split('?')[0]);
        if (p === '/') p = '/index.html';
        // in-app save: POST /api/save-model writes the JSON to the user's
        // Downloads/WebSketch folder — the in-page Save As uses this first
        // and falls back to a browser download when no endpoint answers
        if (req.method === 'POST' && p === '/api/save-model') {
          const chunks = [];
          req.on('data', c => chunks.push(c));
          req.on('end', () => {
            try {
              const dir = path.join(app.getPath('downloads'), 'WebSketch');
              fs.mkdirSync(dir, { recursive: true });
              const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
              const file = path.join(dir, `websketch-${stamp}.json`);
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
        const f = path.normalize(path.join(ROOT, p));
        if (!f.startsWith(path.normalize(ROOT))) { res.writeHead(403); return res.end(); }
        fs.readFile(f, (err, data) => {
          if (err) { res.writeHead(404); return res.end('not found'); }
          res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
          res.end(data);
        });
      } catch (e) { res.writeHead(500); res.end(); }
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv.address().port));
    srv.on('error', reject);
  });
}

async function main() {
  const port = await startServer();
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    autoHideMenuBar: true,
    title: 'WebSketch 3D',
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null); // the app has its own in-page menubar
  win.once('ready-to-show', () => win.show());
  // target=_blank / external links open in the user's browser, not the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  await win.loadURL(`http://127.0.0.1:${port}/`);
}

app.whenReady().then(main);
app.on('window-all-closed', () => app.quit());
