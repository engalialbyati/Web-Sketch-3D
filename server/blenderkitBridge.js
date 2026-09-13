'use strict';
// ---------------------------------------------------------------------------
// blenderkitBridge.js — local conversion bridge between the BlenderKit API
// and the WebSketch 3D frontend.
//
// BlenderKit serves native .blend files, which no browser can parse. This
// little Express service closes the gap:
//
//   GET /api/search?query=<text>[&page=N]
//     CORS-enabled proxy for api/v1/search/ (asset_type=model,
//     order=-downloads, is_free=true) — BlenderKit sends no CORS headers,
//     so the browser cannot query it directly. Each result is annotated
//     with hasGltf (files[] carries a ready-made glTF) so the frontend can
//     mark Blender-free imports before anything is downloaded.
//
//   GET /api/convert?id=<asset uuid>&name=<asset name>
//     1. cache/ already holds ${id}.glb  -> stream it immediately
//     2. fetch asset details from api/v1/assets/${id}/ (files[]):
//        a. fileType 'gltf'  -> resolve + stream the ready GLB, no Blender
//        b. fileType 'blend' -> resolve the download (downloadUrl is a
//           resolver that answers a signed file URL), stream the .blend to
//           cache/${id}.blend, then spawn headless Blender:
//           blender -b cache/${id}.blend \
//             --python-expr "import bpy; bpy.ops.export_scene.gltf(...)"
//           (fails fast with 503 when no Blender is installed)
//     3. stream cache/${id}.glb back, then delete the .blend (disk hygiene)
//
//   POST /api/convert-upload?name=<file name>   (body = raw .blend bytes)
//     File ▸ Open .blend… — converts a LOCAL .blend the same way. The
//     upload is content-addressed (sha256 -> cache/up_<hash>.glb), so
//     re-opening a file is an instant cache hit. Requires Blender on this
//     machine (fail-fast 503 otherwise); BlenderKit GLB imports do not.
//
// Concurrent requests for one asset share a single in-flight conversion.
//
// Error contract (JSON { error, detail? }):
//   400 bad/missing id  · 404 asset unknown upstream  · 502 BlenderKit
//   fetch/download failed  · 500 Blender missing or conversion failed  ·
//   503 blend-only asset but no Blender on this machine  ·
//   504 Blender exceeded BLENDER_TIMEOUT_MS (default 180 s)
//
// Run:  npm run bridge     (express + cors from the project's package.json)
// Env:  PORT, BLENDER_PATH, BLENDER_TIMEOUT_MS
// ---------------------------------------------------------------------------

const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Readable } = require('stream');

const PORT = Number(process.env.PORT) || 3001;
const BLENDER_TIMEOUT_MS = Number(process.env.BLENDER_TIMEOUT_MS) || 180_000;
const BLENDERKIT_API = 'https://www.blenderkit.com/api/v1';
const CACHE_DIR = path.join(__dirname, '..', 'cache');

// Asset ids are BlenderKit UUIDs; anything else would also be a path
// traversal vector once it lands in `cache/${id}.blend`.
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

// Blender resolution: explicit env override -> PATH -> the standard macOS
// app-bundle location (blender is rarely on PATH for launcher-started
// shells on a Mac).
function resolveBlender() {
  if (process.env.BLENDER_PATH) return process.env.BLENDER_PATH;
  const mac = '/Applications/Blender.app/Contents/MacOS/Blender';
  try { if (fs.existsSync(mac)) return mac; } catch (e) { /* inaccessible */ }
  return 'blender'; // resolved by spawn() against PATH
}

// Is a Blender binary findable at all? Drives the fail-fast guard for
// blend-only assets (no point streaming an 80 MB .blend that can never be
// converted) and the /api/health capability report.
function blenderKnown() {
  if (process.env.BLENDER_PATH) return true;
  const mac = '/Applications/Blender.app/Contents/MacOS/Blender';
  try { if (fs.existsSync(mac)) return true; } catch (e) { /* inaccessible */ }
  return !!whichSync();
}
function whichSync() {
  const { execFileSync } = require('child_process');
  try { return execFileSync('which', ['blender']).toString().trim(); } catch (e) { return ''; }
}

const fail = (res, code, error, detail) =>
  res.status(code).json({ error, ...(detail ? { detail } : {}) });

// Pick a file out of the asset-detail payload by type. BlenderKit's shape
// has drifted across API versions, so match defensively.
function pickFileByType(asset, wanted, ext) {
  const files = (asset && Array.isArray(asset.files)) ? asset.files : [];
  return (
    files.find(f => f && f.fileType === wanted && f.downloadUrl) ||
    files.find(f => f && typeof f.downloadUrl === 'string' && f.downloadUrl.split('?')[0].endsWith(ext)) ||
    null
  );
}
const pickGltfFile = asset => pickFileByType(asset, 'gltf', '.glb');
const pickBlendFile = asset => pickFileByType(asset, 'blend', '.blend');

// Whether the asset publishes a ready-made glTF at all. Unlike the pickers
// above this needs no url key: search results expose files[].url while
// asset details use files[].downloadUrl — fileType alone is the signal the
// frontend badges and filters cards on.
function hasReadyGlb(asset) {
  const files = (asset && Array.isArray(asset.files)) ? asset.files : [];
  return files.some(f => f && f.fileType === 'gltf');
}

// Add hasGltf to every search result (additive — the upstream payload is
// otherwise passed through untouched).
function annotateResults(data) {
  if (data && Array.isArray(data.results))
    for (const a of data.results) a.hasGltf = hasReadyGlb(a);
  return data;
}

// BlenderKit's file.downloadUrl is a RESOLVER, not the binary: called with a
// scene_uuid parameter it answers JSON {filePath: <signed url>} (or a plain
// redirect). Walk at most two hops (resolver JSON -> signed file URL) and
// stream the result to `dest` (.part then rename so a half file can never be
// mistaken for a valid blend).
const SCENE_UUID = crypto.randomUUID();
const UA = { 'User-Agent': 'WebSketch3D-blenderkit-bridge/1.0', 'Accept': 'application/json' };

// SSRF allowlist: the bridge only ever talks to BlenderKit's own hosts —
// a malicious API response (or a tampered downloadUrl) cannot redirect the
// server at internal addresses
const ALLOWED_HOSTS = new Set(['www.blenderkit.com', 'api.blenderkit.com', 'assets.blenderkit.com']);
function assertAllowedUrl(u) {
  const url = u instanceof URL ? u : new URL(String(u));
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname))
    throw Object.assign(new Error('refusing non-BlenderKit download URL'), { status: 400 });
  return url;
}

async function fetchAssetFile(downloadUrl, dest) {
  let url = assertAllowedUrl(downloadUrl);
  for (let hop = 0; hop < 3; hop++) {
    const u = assertAllowedUrl(url);
    // only the API resolver takes scene_uuid — appending it to the signed
    // assets.blenderkit.com URL would invalidate the signature (403)
    if (u.pathname.startsWith('/api/')) u.searchParams.set('scene_uuid', SCENE_UUID);
    const res = await fetch(u, { headers: UA, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), u).toString();
      continue;
    }
    if (!res.ok)
      throw Object.assign(new Error(`asset file download failed: HTTP ${res.status}`), { status: 502 });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) {
      const j = await res.json().catch(() => null);
      if (!j || !j.filePath)
        throw Object.assign(new Error('download resolver response missing filePath'), { status: 502 });
      url = j.filePath;
      continue;
    }
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const part = dest + '.part';
    // fetch() gives a web ReadableStream — adapt it before piping to disk
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(part);
      Readable.fromWeb(res.body).pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
    });
    await fsp.rename(part, dest);
    return;
  }
  throw Object.assign(new Error('too many download resolver hops'), { status: 502 });
}

// Headless .blend -> .glb via Blender's gltf exporter. Resolves with the
// Blender stderr tail (diagnostics); rejects on non-zero exit, timeout, or
// a missing/empty output file.
// conversion paths must stay inside the cache dir — ids/keys are validated,
// but the guard makes the invariant explicit for both call sites
function assertCachePath(p) {
  const resolved = path.resolve(String(p));
  const cache = path.resolve(CACHE_DIR);
  if (resolved !== cache && !resolved.startsWith(cache + path.sep))
    throw new Error('refusing a conversion path outside the cache directory');
  return resolved;
}

function runBlender(blendPath, glbPath) {
  return new Promise((resolve, reject) => {
    blendPath = assertCachePath(blendPath);
    glbPath = assertCachePath(glbPath);
    // the GLB path travels as an ARGV (after Blender's `--`), never
    // interpolated into the python expression — no code path is built from
    // data
    const py = 'import sys, bpy; bpy.ops.export_scene.gltf(filepath=sys.argv[-1], export_format=\'GLB\')';
    const child = spawn(resolveBlender(), ['-b', blendPath, '--python-expr', py, '--', glbPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    const feed = chunk => {
      stderr = (stderr + chunk.toString('utf8')).slice(-4000);
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);

    const timer = setTimeout(() => {
      child.kill('SIGTERM'); // ask nicely, then make sure
      setTimeout(() => { try { child.kill('SIGKILL'); } catch (e) { /* already gone */ } }, 4000);
      reject(Object.assign(new Error('conversion timed out'), { code: 'ETIMEDOUT', stderr }));
    }, BLENDER_TIMEOUT_MS);

    child.on('error', err => { // spawn failure: most often "blender: not found"
      clearTimeout(timer);
      reject(Object.assign(err, { code: err.code === 'ENOENT' ? 'ENOENT' : 'ESPAWN', stderr }));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      fs.stat(glbPath, (err, st) => {
        if (err || !st.size) {
          reject(Object.assign(
            new Error(`blender exited ${signal || code} without producing a GLB`),
            { code: 'ENOGLB', stderr },
          ));
          return;
        }
        resolve({ stderr });
      });
    });
  });
}

// One conversion at a time per asset: concurrent requests for the same id
// share a single in-flight promise instead of racing two Blender processes
// over the same cache files.
//
// Source preference: most BlenderKit models also publish a ready-made GLB
// (files[] entry with fileType 'gltf'). When present it is used directly —
// no Blender, no 80 MB .blend round-trip. Only blend-only assets fall back
// to the local headless-Blender conversion.
const inFlight = new Map();
function convert(id) {
  if (!inFlight.has(id)) {
    inFlight.set(id, (async () => {
      const glb = path.join(CACHE_DIR, `${id}.glb`);
      const blend = path.join(CACHE_DIR, `${id}.blend`);
      try {
        // 1. asset details -> downloadable files
        const res = await fetch(`${BLENDERKIT_API}/assets/${id}/`, { headers: UA });
        if (res.status === 404) throw Object.assign(new Error('asset not found on BlenderKit'), { status: 404 });
        if (!res.ok) throw Object.assign(new Error(`BlenderKit API HTTP ${res.status}`), { status: 502 });
        let asset;
        try { asset = await res.json(); } catch (e) {
          throw Object.assign(new Error('BlenderKit API returned invalid JSON'), { status: 502 });
        }

        // 2a. ready-made GLB upstream -> straight into the cache
        const gltfFile = pickGltfFile(asset);
        if (gltfFile) {
          await fetchAssetFile(gltfFile.downloadUrl, glb);
          return { source: 'gltf' };
        }

        // 2b. blend-only asset -> download + local Blender conversion.
        // Fail fast when no Blender exists anywhere on the machine: the
        // conversion could never run, so streaming the .blend first would
        // just burn bandwidth before the inevitable 500.
        const file = pickBlendFile(asset);
        if (!file) throw Object.assign(new Error('asset has no downloadable .glb or .blend file'), { status: 502 });
        if (!blenderKnown())
          throw Object.assign(
            new Error('asset ships only a .blend and no Blender was found — install Blender, set BLENDER_PATH, or pick a GLB-ready asset'),
            { status: 503 },
          );
        await fetchAssetFile(file.downloadUrl, blend);
        await runBlender(blend, glb);
        return { source: 'blend' };
      } finally {
        // disk hygiene either way: the .blend is single-use
        fsp.unlink(blend).catch(() => {});
      }
    })().finally(() => inFlight.delete(id)));
  }
  return inFlight.get(id);
}

// --------------------------------------------------------------------- app
const app = express();
app.use(cors());

// Liveness + capability probe (the frontend uses it to explain offline
// states instead of guessing from a failed fetch, and to know whether
// blend-only assets are importable on this machine).
app.get('/api/health', (req, res) => {
  const blender = resolveBlender();
  res.json({
    ok: true,
    blender,
    blenderKnown: blenderKnown(),
    timeoutMs: BLENDER_TIMEOUT_MS,
  });
});

// Search proxy. The frontend cannot call BlenderKit directly: the API sends
// no CORS headers, so the browser blocks the response. The query semantics
// are exactly the ones the asset browser wants — free models, most
// downloaded first — and the upstream JSON ({count, next, results}) is
// passed through untouched except for the additive hasGltf flag on each
// result (see annotateResults).
app.get('/api/search', async (req, res) => {
  const query = String(req.query.query || '').trim();
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const u = new URL(`${BLENDERKIT_API}/search/`);
  u.searchParams.set('query', query);
  u.searchParams.set('asset_type', 'model');
  u.searchParams.set('order', '-downloads');
  u.searchParams.set('is_free', 'true');
  if (page > 1) u.searchParams.set('page', String(page));
  try {
    const up = await fetch(u, { headers: UA });
    if (!up.ok) return fail(res, 502, `BlenderKit search HTTP ${up.status}`);
    const data = annotateResults(await up.json());
    res.json(data);
  } catch (err) {
    fail(res, 502, `BlenderKit search failed: ${err.message}`);
  }
});

app.get('/api/convert', async (req, res) => {
  const id = String(req.query.id || '').trim();
  const name = String(req.query.name || '').trim();
  if (!id || !ID_RE.test(id))
    return fail(res, 400, 'missing or invalid "id" (expected the BlenderKit asset UUID)');

  const glb = path.join(CACHE_DIR, `${id}.glb`);
  try {
    // cache hit: no Blender, no upstream round-trip
    if (fs.existsSync(glb)) {
      res.setHeader('Content-Type', 'model/gltf-binary');
      return res.sendFile(glb);
    }
    await convert(id);
    res.setHeader('Content-Type', 'model/gltf-binary');
    res.sendFile(glb);
  } catch (err) {
    const tail = (err.stderr || '').split('\n').filter(Boolean).slice(-6).join('\n');
    if (err.code === 'ETIMEDOUT')
      return fail(res, 504, `Blender conversion timed out after ${Math.round(BLENDER_TIMEOUT_MS / 1000)} s`, name);
    if (err.code === 'ENOENT')
      return fail(res, 500, 'Blender executable not found — install Blender or set BLENDER_PATH', tail);
    if (err.status === 404)
      return fail(res, 404, `BlenderKit asset "${name || id}" not found`);
    if (err.status === 503)
      return fail(res, 503, err.message, name);
    if (err.status === 502)
      return fail(res, 502, `BlenderKit fetch failed: ${err.message}`, tail);
    return fail(res, 500, `conversion failed: ${err.message}`, tail);
  }
});

// User-uploaded .blend files (File ▸ Open .blend…). The body IS the file
// bytes (no multipart — the browser sends the File directly); the client
// filename is informational only. Content-addressed: the sha256 prefixes
// both the cache key and the temp file, so re-opening the same file is an
// instant cache hit and concurrent opens share one conversion.
const UPLOAD_MAX_BYTES = 400 * 1024 * 1024;
const uploadKey = buf => 'up_' + crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
const uploadInFlight = new Map();
function convertUpload(buf) {
  const key = uploadKey(buf);
  if (!uploadInFlight.has(key)) {
    uploadInFlight.set(key, (async () => {
      const glb = path.join(CACHE_DIR, `${key}.glb`);
      const blend = path.join(CACHE_DIR, `${key}.blend`);
      try {
        if (!blenderKnown())
          throw Object.assign(
            new Error('opening .blend files needs Blender on this machine — install it or set BLENDER_PATH (BlenderKit GLB imports keep working without it)'),
            { status: 503 },
          );
        await fsp.mkdir(CACHE_DIR, { recursive: true });
        const part = blend + '.part';
        await fsp.writeFile(part, buf);
        await fsp.rename(part, blend);
        await runBlender(blend, glb);
        return { key, source: 'blend' };
      } finally {
        fsp.unlink(blend).catch(() => {}); // the upload is single-use
        fsp.unlink(blend + '.part').catch(() => {});
      }
    })().finally(() => uploadInFlight.delete(key)));
  }
  return uploadInFlight.get(key);
}

app.post('/api/convert-upload',
  express.raw({ type: () => true, limit: `${UPLOAD_MAX_BYTES}` }),
  async (req, res) => {
    const name = String(req.query.name || req.headers['x-filename'] || 'upload.blend').slice(0, 120);
    const buf = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buf || !buf.length)
      return fail(res, 400, 'empty upload — POST the .blend file as the request body');
    if (buf.length > UPLOAD_MAX_BYTES)
      return fail(res, 413, `file too large (${(buf.length / 1048576).toFixed(0)} MB > 400 MB limit)`);
    if (buf.length < 12 || buf.toString('ascii', 0, 7) !== 'BLENDER')
      return fail(res, 400, 'that is not a .blend file (missing the BLENDER header)');

    const key = uploadKey(buf);
    const glb = path.join(CACHE_DIR, `${key}.glb`);
    try {
      if (fs.existsSync(glb)) {
        res.setHeader('Content-Type', 'model/gltf-binary');
        return res.sendFile(glb);
      }
      await convertUpload(buf);
      res.setHeader('Content-Type', 'model/gltf-binary');
      res.sendFile(glb);
    } catch (err) {
      const tail = (err.stderr || '').split('\n').filter(Boolean).slice(-6).join('\n');
      if (err.code === 'ETIMEDOUT')
        return fail(res, 504, `Blender conversion timed out after ${Math.round(BLENDER_TIMEOUT_MS / 1000)} s`, name);
      if (err.code === 'ENOENT')
        return fail(res, 500, 'Blender executable not found — install Blender or set BLENDER_PATH', tail);
      if (err.status === 503) return fail(res, 503, err.message, name);
      if (err.code === 'ENOGLB')
        return fail(res, 422, `"${name}" opened in Blender but produced no geometry to export`, tail);
      return fail(res, 500, `conversion failed: ${err.message}`, tail);
    }
  });

// Pure helpers are exported for test/bridge.test.js; the server only boots
// when run as a script (npm run bridge), never on require().
module.exports = { pickFileByType, pickGltfFile, pickBlendFile, hasReadyGlb, annotateResults, uploadKey };

if (require.main === module) {
  app.listen(PORT, () => {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    console.log(`[blenderkit-bridge] http://localhost:${PORT}`);
    console.log(`[blenderkit-bridge] cache: ${CACHE_DIR}`);
    console.log(`[blenderkit-bridge] blender: ${resolveBlender()}${blenderKnown() ? '' : ' (NOT FOUND — blend-only assets will fail fast; GLB-ready assets still import)'}`);
  });
}
