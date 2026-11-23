'use strict';
/**
 * Day Planner — tiny local server (Node.js, no dependencies).
 *
 *  - Serves the frontend from ./docs (index.html + config.js).
 *  - Exposes a small REST API for events.
 *  - Stores everything in a single JSON file: ./data/events.json
 *    Writes are atomic (temp file + rename) and serialized, so the file is
 *    never left half-written, even if the PC crashes mid-save.
 *
 * API
 *   GET    /api/events?from=YYYY-MM-DD&to=YYYY-MM-DD   (both days inclusive, server local time)
 *   GET    /api/events/:id
 *   POST   /api/events                                 body: { id?, title, description?, start, end }
 *   PUT    /api/events/:id                             body: any of { title, description, start, end }
 *   DELETE /api/events/:id
 *
 * Event shape: { id (uuid), title, description, start (ISO), end (ISO), updatedAt (ISO) }
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // all interfaces, so the phone can reach it
const PUBLIC_DIR = path.join(__dirname, 'docs'); // docs/ = what GitHub Pages publishes
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'events.json');

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_EVENT_SPAN_MS = 31 * 24 * 60 * 60 * 1000; // sanity limit: 31 days

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// ---------------------------------------------------------------------------
// Storage: in-memory Map, mirrored to data/events.json
// ---------------------------------------------------------------------------

/** @type {Map<string, {id:string,title:string,description:string,start:string,end:string,updatedAt:string}>} */
const events = new Map();

/** Load events from disk on startup. A corrupt file is moved aside, never overwritten. */
function loadEvents() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Clean up temp files left behind by an interrupted write.
  for (const name of fs.readdirSync(DATA_DIR)) {
    if (name.startsWith('events.json.') && name.endsWith('.tmp')) {
      fs.rmSync(path.join(DATA_DIR, name), { force: true });
    }
  }

  let raw;
  try {
    raw = fs.readFileSync(DATA_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return; // first run: nothing stored yet
    throw err;
  }

  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) throw new Error('expected a JSON array');
    for (const item of list) {
      const ev = normalizeStored(item);
      if (ev) events.set(ev.id, ev);
    }
  } catch (err) {
    const backup = path.join(DATA_DIR, `events.corrupt-${Date.now()}.json`);
    fs.renameSync(DATA_FILE, backup);
    console.warn(`! Could not read ${DATA_FILE} (${err.message}).`);
    console.warn(`  It was moved to ${backup} and the planner started empty.`);
  }
}

/** Validate an event read from disk; returns a clean copy or null. */
function normalizeStored(item) {
  if (!item || typeof item !== 'object') return null;
  const { id, title, description, start, end, updatedAt } = item;
  if (typeof id !== 'string' || typeof title !== 'string') return null;
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) return null;
  const u = new Date(updatedAt);
  return {
    id,
    title,
    description: typeof description === 'string' ? description : '', // older files have none
    start: s.toISOString(),
    end: e.toISOString(),
    updatedAt: Number.isNaN(u.getTime()) ? new Date().toISOString() : u.toISOString(),
  };
}

function serializeEvents() {
  const list = [...events.values()].sort((a, b) => a.start.localeCompare(b.start));
  return JSON.stringify(list, null, 2) + '\n';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Atomic write: write a temp file in the same folder, flush it to disk,
 * then rename it over the real file. A rename is all-or-nothing, so readers
 * (and a crash) only ever see the old file or the new one.
 */
async function writeFileAtomic(file, contents) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const handle = await fsp.open(tmp, 'w');
  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  // On Windows, antivirus / indexers can briefly lock the target: retry a few times.
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(tmp, file);
      return;
    } catch (err) {
      const retryable = ['EPERM', 'EACCES', 'EBUSY'].includes(err.code);
      if (!retryable || attempt >= 6) {
        await fsp.rm(tmp, { force: true });
        throw err;
      }
      await sleep(40 * (attempt + 1));
    }
  }
}

// All writes go through one queue so they never overlap.
let writeQueue = Promise.resolve();

/**
 * Apply a change in memory, then persist it. If saving fails, `rollback`
 * runs (inside the queue, before the next write) and the promise rejects.
 */
function commit(apply, rollback) {
  apply();
  const job = writeQueue.then(async () => {
    try {
      await writeFileAtomic(DATA_FILE, serializeEvents());
    } catch (err) {
      rollback();
      throw err;
    }
  });
  writeQueue = job.catch(() => {}); // keep the queue alive after a failure
  return job;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Build a new/updated event from a request body.
 * For updates (existing given) every field is optional.
 * Returns { event } or { error }.
 */
function buildEvent(body, existing) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Body must be a JSON object' };
  }
  const out = existing ? { ...existing } : {};

  if (!existing || body.title !== undefined) {
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return { error: '"title" must be a non-empty string' };
    }
    const title = body.title.trim();
    if (title.length > MAX_TITLE_LENGTH) {
      return { error: `"title" must be at most ${MAX_TITLE_LENGTH} characters` };
    }
    out.title = title;
  }

  // Optional free text; defaults to '' on create.
  if (body.description !== undefined || !existing) {
    const description = body.description === undefined || body.description === null ? '' : body.description;
    if (typeof description !== 'string') return { error: '"description" must be a string' };
    if (description.trim().length > MAX_DESCRIPTION_LENGTH) {
      return { error: `"description" must be at most ${MAX_DESCRIPTION_LENGTH} characters` };
    }
    out.description = description.trim();
  }
  if (out.description === undefined) out.description = '';

  for (const key of ['start', 'end']) {
    if (!existing || body[key] !== undefined) {
      const value = body[key];
      const date = typeof value === 'string' && ISO_DATETIME_RE.test(value) ? new Date(value) : null;
      if (!date || Number.isNaN(date.getTime())) {
        return { error: `"${key}" must be an ISO datetime, e.g. 2026-11-20T14:00:00.000Z` };
      }
      out[key] = date.toISOString();
    }
  }

  const span = Date.parse(out.end) - Date.parse(out.start);
  if (span <= 0) return { error: '"end" must be after "start"' };
  if (span > MAX_EVENT_SPAN_MS) return { error: 'Events can be at most 31 days long' };

  out.updatedAt = new Date().toISOString();
  return { event: out };
}

/** Parse "YYYY-MM-DD" as local midnight; returns a Date or null. */
function parseLocalDate(value) {
  const m = DATE_RE.exec(value || '');
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sendJson(res, status, data) {
  const body = data === undefined ? '' : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendEmpty(res, status) {
  res.writeHead(status, { 'Cache-Control': 'no-store' });
  res.end();
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Read and parse a JSON request body (with a size limit). */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return reject(new HttpError(413, 'Request body too large'));
      if (!chunks.length) return resolve(null);
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------

function listEvents(res, url) {
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  let list = [...events.values()];

  if (fromParam || toParam) {
    const from = parseLocalDate(fromParam);
    const to = parseLocalDate(toParam);
    if (!from || !to) throw new HttpError(400, 'Use ?from=YYYY-MM-DD&to=YYYY-MM-DD');
    if (to < from) throw new HttpError(400, '"to" must not be before "from"');
    const rangeStart = from.getTime();
    const rangeEnd = new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1).getTime(); // "to" is inclusive
    // An event is included if it overlaps the range at all.
    list = list.filter((ev) => Date.parse(ev.start) < rangeEnd && Date.parse(ev.end) > rangeStart);
  }

  list.sort((a, b) => a.start.localeCompare(b.start));
  sendJson(res, 200, list);
}

async function createEvent(req, res) {
  const body = await readJsonBody(req);
  const { event, error } = buildEvent(body, null);
  if (error) throw new HttpError(400, error);

  // The client may supply its own uuid (needed for optimistic UI); otherwise we make one.
  const id = typeof body.id === 'string' && UUID_RE.test(body.id) ? body.id.toLowerCase() : crypto.randomUUID();
  if (events.has(id)) throw new HttpError(409, 'An event with this id already exists');
  event.id = id;
  const saved = { id, title: event.title, description: event.description, start: event.start, end: event.end, updatedAt: event.updatedAt };

  await commit(
    () => events.set(id, saved),
    () => events.delete(id),
  );
  sendJson(res, 201, saved);
}

async function updateEvent(req, res, id) {
  const body = await readJsonBody(req);
  const existing = events.get(id);
  if (!existing) throw new HttpError(404, 'Event not found');
  const { event, error } = buildEvent(body, existing);
  if (error) throw new HttpError(400, error);
  event.id = id; // the id in the URL always wins

  await commit(
    () => events.set(id, event),
    () => events.set(id, existing),
  );
  sendJson(res, 200, event);
}

async function deleteEvent(res, id) {
  const existing = events.get(id);
  if (existing) {
    await commit(
      () => events.delete(id),
      () => events.set(id, existing),
    );
  }
  // Deleting something that's already gone is fine (idempotent): 204 either way.
  sendEmpty(res, 204);
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'events', ':id'?]
  if (parts[1] !== 'events' || parts.length > 3) throw new HttpError(404, 'Not found');

  if (parts.length === 2) {
    if (req.method === 'GET') return listEvents(res, url);
    if (req.method === 'POST') return createEvent(req, res);
    res.setHeader('Allow', 'GET, POST');
    throw new HttpError(405, 'Method not allowed');
  }

  let id;
  try {
    id = decodeURIComponent(parts[2]);
  } catch {
    throw new HttpError(400, 'Bad event id');
  }

  if (req.method === 'GET') {
    const ev = events.get(id);
    if (!ev) throw new HttpError(404, 'Event not found');
    return sendJson(res, 200, ev);
  }
  if (req.method === 'PUT') return updateEvent(req, res, id);
  if (req.method === 'DELETE') return deleteEvent(res, id);
  res.setHeader('Allow', 'GET, PUT, DELETE');
  throw new HttpError(405, 'Method not allowed');
}

// ---------------------------------------------------------------------------
// Static files (the frontend)
// ---------------------------------------------------------------------------

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return sendEmpty(res, 405);
  }

  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return sendEmpty(res, 400);
  }
  if (rel === '/') rel = '/index.html';

  // Resolve inside PUBLIC_DIR only (blocks "../" tricks).
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return sendEmpty(res, 404);

  let data;
  try {
    data = await fsp.readFile(filePath);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': data.length,
    'Cache-Control': 'no-cache', // always revalidate, so edits to index.html show up on refresh
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const url = new URL(req.url, 'http://localhost');
  const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');

  try {
    if (isApi) await handleApi(req, res, url);
    else await serveStatic(req, res, url);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(`! ${req.method} ${url.pathname} failed:`, err);
    if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Internal server error' : err.message });
    else res.end();
  } finally {
    // Log changes (not the 30-second sync polls) so you can see activity in the terminal.
    if (isApi && req.method !== 'GET') {
      res.once('finish', () => {
        console.log(`${new Date().toLocaleTimeString()}  ${req.method} ${url.pathname} → ${res.statusCode}`);
      });
    }
  }
});

/** Non-internal IPv4 addresses, most likely "home Wi-Fi/Ethernet" address first. */
function lanAddresses() {
  const score = (name, ip) => {
    let s = 0;
    if (/^192\.168\./.test(ip)) s += 3;
    else if (/^10\./.test(ip)) s += 2;
    else if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) s += 1;
    if (/wi-?fi|wlan|wireless|ethernet|^en\d|^eth\d/i.test(name)) s += 2;
    if (/vethernet|virtual|vmware|vbox|hyper-v|wsl|docker|loopback|tailscale|zerotier|vpn/i.test(name)) s -= 5;
    return s;
  };
  const found = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      const isV4 = a.family === 'IPv4' || a.family === 4;
      if (!isV4 || a.internal || a.address.startsWith('169.254.')) continue;
      found.push({ name, address: a.address, score: score(name, a.address) });
    }
  }
  return found.sort((a, b) => b.score - a.score);
}

function printBanner() {
  const addrs = lanAddresses();
  const line = '─'.repeat(58);
  console.log(line);
  console.log(' Day Planner is running');
  console.log(line);
  console.log(` On this PC:      http://localhost:${PORT}`);
  if (addrs.length) {
    console.log(` On your iPhone:  http://${addrs[0].address}:${PORT}   (same Wi-Fi, use Safari)`);
    if (addrs.length > 1) {
      console.log(' Other addresses (try these if the one above does not work):');
      for (const a of addrs.slice(1)) console.log(`   http://${a.address}:${PORT}   (${a.name})`);
    }
  } else {
    console.log(' No network address found. Is this PC connected to Wi-Fi/Ethernet?');
  }
  console.log(` Data file:       ${DATA_FILE}`);
  console.log(' Press Ctrl+C to stop.');
  console.log(line);
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`! Port ${PORT} is already in use. Is the planner already running in another window?`);
    console.error('  To use another port in PowerShell:  $env:PORT=3001; npm start');
    process.exit(1);
  }
  throw err;
});

/** Stop accepting requests, let any pending file write finish, then exit. */
function shutdown() {
  console.log('\nStopping…');
  server.close();
  setTimeout(() => process.exit(0), 3000).unref();
  writeQueue.then(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

loadEvents();
server.listen(PORT, HOST, printBanner);
