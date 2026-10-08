'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const AUTH_USER = process.env.AUTH_USER || '';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';

const MAX_BODY = 1024 * 1024;
const MAX_TEXT = 500;
const MAX_ITEMS = 5000;
const MAX_DEPTH = 20;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------- Stockage ---------- */

let db = { checklists: [], runs: [] };

function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) return;
  // Si le fichier est corrompu, on plante plutôt que d'écraser les données.
  const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  db.checklists = Array.isArray(raw.checklists) ? raw.checklists : [];
  db.runs = Array.isArray(raw.runs) ? raw.runs : [];
}

let saveChain = Promise.resolve();
function persist() {
  const data = JSON.stringify(db, null, 2);
  saveChain = saveChain
    .then(async () => {
      const tmp = DB_FILE + '.tmp';
      await fsp.writeFile(tmp, data);
      await fsp.rename(tmp, DB_FILE);
    })
    .catch((err) => console.error('Erreur de sauvegarde :', err));
  return saveChain;
}

/* ---------- Utilitaires ---------- */

const newId = () => crypto.randomBytes(8).toString('hex');
const now = () => new Date().toISOString();
const isId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v);

function cleanText(v, max = MAX_TEXT) {
  return String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, max);
}

function sanitizeItems(list, withChecked, depth = 0, ctx = { n: 0, seen: new Set() }) {
  if (!Array.isArray(list)) return [];
  if (depth > MAX_DEPTH) throw new HttpError(400, "Trop de niveaux d'imbrication");
  const out = [];
  for (const it of list) {
    if (!it || typeof it !== 'object') continue;
    if (++ctx.n > MAX_ITEMS) throw new HttpError(400, 'Trop de tâches');
    let id = isId(it.id) && !ctx.seen.has(it.id) ? it.id : newId();
    ctx.seen.add(id);
    const item = {
      id,
      text: cleanText(it.text),
      children: sanitizeItems(it.children, withChecked, depth + 1, ctx),
    };
    if (withChecked) item.checked = !!it.checked;
    out.push(item);
  }
  return out;
}

// Copie du modèle pour une session : retire les tâches vides, tout est décoché.
function cloneForRun(items) {
  const out = [];
  for (const it of items) {
    const children = cloneForRun(it.children || []);
    const text = it.text.trim();
    if (!text && !children.length) continue;
    out.push({ id: newId(), text: text || '(sans titre)', checked: false, children });
  }
  return out;
}

function countItems(items) {
  let n = 0;
  for (const it of items) n += (it.text.trim() ? 1 : 0) + countItems(it.children);
  return n;
}

function leafStats(items, acc = { done: 0, total: 0 }) {
  for (const it of items) {
    if (it.children.length) leafStats(it.children, acc);
    else {
      acc.total++;
      if (it.checked) acc.done++;
    }
  }
  return acc;
}

function setAll(items, checked) {
  for (const it of items) {
    it.checked = checked;
    setAll(it.children, checked);
  }
}

// Un parent est coché si et seulement si tous ses enfants le sont.
function normalize(items) {
  for (const it of items) {
    if (it.children.length) {
      normalize(it.children);
      it.checked = it.children.every((c) => c.checked);
    }
  }
}

function findItem(items, id) {
  for (const it of items) {
    if (it.id === id) return it;
    const found = findItem(it.children, id);
    if (found) return found;
  }
  return null;
}

function checklistSummary(c) {
  return {
    id: c.id,
    title: c.title,
    description: c.description,
    count: countItems(c.items),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function runSummary(r) {
  return {
    id: r.id,
    checklistId: r.checklistId,
    title: r.title,
    startedAt: r.startedAt,
    updatedAt: r.updatedAt,
    finishedAt: r.finishedAt,
    ...leafStats(r.items),
  };
}

function getChecklist(id) {
  const c = db.checklists.find((x) => x.id === id);
  if (!c) throw new HttpError(404, 'Checklist introuvable');
  return c;
}

function getRun(id) {
  const r = db.runs.find((x) => x.id === id);
  if (!r) throw new HttpError(404, 'Session introuvable');
  return r;
}

const byUpdatedDesc = (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '');

/* ---------- API ---------- */

class Reply {
  constructor(status, body) {
    this.status = status;
    this.body = body;
  }
}
const reply = (status, body) => new Reply(status, body);

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp(
    '^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$'
  );
  routes.push({ method, re, keys, handler });
}

route('GET', '/api/checklists', () => db.checklists.slice().sort(byUpdatedDesc).map(checklistSummary));

route('POST', '/api/checklists', async ({ body }) => {
  const c = {
    id: newId(),
    title: cleanText(body.title, 200).trim() || 'Nouvelle checklist',
    description: cleanText(body.description, 1000),
    items: sanitizeItems(body.items, false),
    createdAt: now(),
    updatedAt: now(),
  };
  db.checklists.push(c);
  await persist();
  return reply(201, c);
});

route('GET', '/api/checklists/:id', ({ params }) => getChecklist(params.id));

route('PUT', '/api/checklists/:id', async ({ params, body }) => {
  const c = getChecklist(params.id);
  if (body.title !== undefined) c.title = cleanText(body.title, 200);
  if (body.description !== undefined) c.description = cleanText(body.description, 1000);
  if (body.items !== undefined) c.items = sanitizeItems(body.items, false);
  c.updatedAt = now();
  await persist();
  return c;
});

route('DELETE', '/api/checklists/:id', async ({ params }) => {
  getChecklist(params.id);
  db.checklists = db.checklists.filter((x) => x.id !== params.id);
  await persist();
  return reply(204, null);
});

route('POST', '/api/checklists/:id/duplicate', async ({ params }) => {
  const src = getChecklist(params.id);
  const copy = JSON.parse(JSON.stringify(src));
  const reId = (items) => items.forEach((it) => ((it.id = newId()), reId(it.children)));
  reId(copy.items);
  Object.assign(copy, { id: newId(), title: `${src.title} (copie)`, createdAt: now(), updatedAt: now() });
  db.checklists.push(copy);
  await persist();
  return reply(201, copy);
});

route('POST', '/api/checklists/:id/runs', async ({ params }) => {
  const c = getChecklist(params.id);
  const items = cloneForRun(c.items);
  if (!items.length) throw new HttpError(400, 'Cette checklist est vide');
  const r = {
    id: newId(),
    checklistId: c.id,
    title: c.title.trim() || 'Sans titre',
    items,
    startedAt: now(),
    updatedAt: now(),
    finishedAt: null,
  };
  db.runs.push(r);
  await persist();
  return reply(201, r);
});

route('GET', '/api/runs', () => db.runs.slice().sort(byUpdatedDesc).map(runSummary));

route('GET', '/api/runs/:id', ({ params }) => getRun(params.id));

route('POST', '/api/runs/:id/toggle', async ({ params, body }) => {
  const r = getRun(params.id);
  const item = findItem(r.items, body.itemId);
  if (!item) throw new HttpError(404, 'Tâche introuvable');
  const checked = !!body.checked;
  item.checked = checked;
  setAll(item.children, checked);
  normalize(r.items);
  r.updatedAt = now();
  await persist();
  return r;
});

route('POST', '/api/runs/:id/set-all', async ({ params, body }) => {
  const r = getRun(params.id);
  setAll(r.items, !!body.checked);
  r.updatedAt = now();
  await persist();
  return r;
});

route('POST', '/api/runs/:id/finish', async ({ params, body }) => {
  const r = getRun(params.id);
  r.finishedAt = body.finished === false ? null : now();
  r.updatedAt = now();
  await persist();
  return r;
});

route('DELETE', '/api/runs/:id', async ({ params }) => {
  getRun(params.id);
  db.runs = db.runs.filter((x) => x.id !== params.id);
  await persist();
  return reply(204, null);
});

/* ---------- HTTP ---------- */

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Requête trop volumineuse'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(parsed && typeof parsed === 'object' ? parsed : {});
      } catch {
        reject(new HttpError(400, 'JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  if (payload === null || payload === undefined) {
    res.writeHead(status, { 'Cache-Control': 'no-store' });
    return res.end();
  }
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function checkAuth(req) {
  if (!AUTH_PASSWORD) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep < 0) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  // Évaluer les deux comparaisons pour ne pas révéler laquelle échoue.
  const okUser = safeEqual(user, AUTH_USER);
  const okPass = safeEqual(pass, AUTH_PASSWORD);
  return okUser && okPass;
}

async function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  let file;
  try {
    file = path.join(PUBLIC_DIR, path.normalize(decodeURIComponent(rel)));
  } catch {
    return send(res, 400, { error: 'Chemin invalide' });
  }
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'Interdit' });
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch {
    send(res, 404, { error: 'Introuvable' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/healthz') return send(res, 200, { ok: true });
    if (!checkAuth(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Checklist", charset="UTF-8"' });
      return res.end('Authentification requise');
    }
    const { pathname } = new URL(req.url, 'http://localhost');

    if (pathname.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = pathname.match(r.re);
        if (!m) continue;
        const params = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
        const result = await r.handler({ params, body, req });
        return result instanceof Reply ? send(res, result.status, result.body) : send(res, 200, result);
      }
      throw new HttpError(404, 'Route inconnue');
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Méthode non autorisée');
    await serveStatic(req, res, pathname);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Erreur serveur' : err.message });
    else res.end();
  }
});

loadDb();
server.listen(PORT, HOST, () => {
  console.log(`Checklist démarrée sur http://${HOST}:${PORT}`);
  console.log(`Données : ${DB_FILE}`);
  if (AUTH_PASSWORD) console.log('Authentification activée');
});

function shutdown() {
  server.close();
  saveChain.finally(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
