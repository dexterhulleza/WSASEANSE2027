'use strict';
/*
 * WorldSkills ASEAN Special Edition 2027 — Skills Registry
 * Self-hosted server: Node.js 22+ standard library only (http, crypto, node:sqlite).
 * Data lives in DATA_DIR (SQLite database + uploaded files).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

/* ------------------------------------------------------------------ config */
const CFG = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
  tz: process.env.APP_TIMEZONE || 'Asia/Manila',
  cookieSecure: process.env.COOKIE_SECURE !== 'false',
  trustProxy: process.env.TRUST_PROXY === 'true',
  allowSignup: process.env.ALLOW_SIGNUP !== 'false',
  sessionDays: Number(process.env.SESSION_DAYS) || 7,
  maxUpload: 20 * 1024 * 1024,
  publicDir: path.join(__dirname, 'public'),
};
const UPLOAD_DIR = path.join(CFG.dataDir, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* --------------------------------------------------------------- constants */
const COUNTRIES = { BN: 'Brunei Darussalam', KH: 'Cambodia', ID: 'Indonesia', LA: 'Lao PDR', MY: 'Malaysia', MM: 'Myanmar', PH: 'Philippines', SG: 'Singapore', TH: 'Thailand', TL: 'Timor-Leste', VN: 'Viet Nam' };
const STAGES = ['Interest', 'Provisional', 'Definitive'];
const DECISIONS = ['Pending', 'Accepted', 'Reserve', 'Withdrawn'];
const SKILL_STATUS = ['Proposed', 'Official', 'Demo Skill', 'Withdrawn'];
const DEFAULT_ROLES = [
  { id: 'od', name: 'Official Delegate', max: 1 },
  { id: 'td', name: 'Technical Delegate', max: 1 },
  { id: 'tda', name: 'Technical Delegate Assistant', max: 2 },
  { id: 'tl', name: 'Team Leader', max: 10 },
];
const DEFAULT_SETTINGS = {
  hostCountries: ['SG', 'TH', 'PH'],
  windowStart: '2027-08-02',
  windowEnd: '2027-09-30',
  registration: {
    Interest: { open: '2026-10-30', close: '2026-11-20' },
    Provisional: { open: '2026-12-07', close: '2027-01-08' },
    Definitive: { open: '2027-03-19', close: '2027-04-30' },
  },
  roles: DEFAULT_ROLES,
  delegationReg: { open: '2026-10-30', close: '2027-04-30' },
};
const SEED_SKILLS = [
  ['SG', '3D Digital Game Art'], ['SG', 'Cloud Computing'], ['SG', 'Software Applications Development'], ['SG', 'Web Technology'],
  ['TH', 'Welding'], ['TH', 'Mechatronics', 2], ['TH', 'Mobile Robotics', 2],
  ['PH', 'Electrical Installations'], ['PH', 'Plumbing and Heating'], ['PH', 'Cooking'], ['PH', 'Graphic Design Technology'],
  ['PH', 'Hotel Reception'], ['PH', 'Restaurant Service'], ['PH', 'IT Network Systems Administration'],
  ['PH', 'Refrigeration and Air Conditioning'], ['PH', 'Industry 4.0', 2], ['PH', 'Mechanical Engineering CAD'],
];
const UPLOAD_TYPES = {
  'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'text/csv': 'csv', 'text/plain': 'txt', 'text/markdown': 'md', 'application/json': 'json',
};
const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

/* ---------------------------------------------------------------- database */
const db = new DatabaseSync(path.join(CFG.dataDir, 'registry.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, pass TEXT NOT NULL,
    role TEXT NOT NULL, country TEXT, status TEXT NOT NULL, must_change INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, last_login INTEGER);
  CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS skills (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS delegates (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS hosts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY, scope TEXT NOT NULL, target TEXT NOT NULL, name TEXT NOT NULL, kind TEXT,
    mime TEXT NOT NULL, size INTEGER NOT NULL, by TEXT, at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, by TEXT, as_ TEXT, action TEXT, detail TEXT);
  CREATE INDEX IF NOT EXISTS files_target ON files(scope, target);
`);
const TABLES = new Set(['skills', 'entries', 'delegates', 'hosts']);
const store = {
  all(t) { if (!TABLES.has(t)) throw new Error('bad table'); return db.prepare(`SELECT id, data FROM ${t}`).all().map((r) => ({ ...JSON.parse(r.data), id: r.id })); },
  get(t, id) { if (!TABLES.has(t)) throw new Error('bad table'); const r = db.prepare(`SELECT data FROM ${t} WHERE id = ?`).get(id); return r ? { ...JSON.parse(r.data), id } : null; },
  put(t, id, obj) {
    if (!TABLES.has(t)) throw new Error('bad table');
    const { id: _i, docs: _d, ...rest } = obj;
    db.prepare(`INSERT INTO ${t} (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`).run(id, JSON.stringify(rest));
  },
  del(t, id) { if (!TABLES.has(t)) throw new Error('bad table'); db.prepare(`DELETE FROM ${t} WHERE id = ?`).run(id); },
};
function getSettings() {
  const r = db.prepare('SELECT value FROM kv WHERE key = ?').get('settings');
  const s = r ? JSON.parse(r.value) : {};
  return { ...DEFAULT_SETTINGS, ...s };
}
function putSettings(s) {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('settings', JSON.stringify(s));
}

/* ----------------------------------------------------------------- helpers */
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const newId = () => crypto.randomBytes(9).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: CFG.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const isDate = (s) => s === '' || /^\d{4}-\d{2}-\d{2}$/.test(s);
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const emailOk = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
function int(v, label) {
  if (v === '' || v === null || v === undefined) return '';
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1000) fail(400, `${label} must be a whole number.`);
  return n;
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return `s1$${salt.toString('base64')}$${h.toString('base64')}`;
}
function checkPassword(pw, stored) {
  const [v, s, h] = String(stored).split('$');
  if (v !== 's1' || !s || !h) return false;
  const calc = crypto.scryptSync(String(pw), Buffer.from(s, 'base64'), 64);
  const hb = Buffer.from(h, 'base64');
  return hb.length === calc.length && crypto.timingSafeEqual(hb, calc);
}
function tempPassword() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(12), (b) => abc[b % abc.length]).join('');
}

/* -------------------------------------------------------------- permission */
const isActive = (u) => !!u && u.status === 'active';
const isCentral = (u) => isActive(u) && u.role === 'central';
const isCountry = (u) => isActive(u) && u.role === 'country' && !!u.country;
const isHostCountry = (c, st) => (st.hostCountries || []).includes(c);
function currentStage(st) {
  const t = today(), r = st.registration || {};
  return STAGES.find((s) => r[s] && r[s].open && r[s].close && t >= r[s].open && t <= r[s].close) || null;
}
function delegOpen(st) { const r = st.delegationReg || {}, t = today(); return !!(r.open && r.close && t >= r.open && t <= r.close); }
const canEditSkill = (u, sk, st) => isCentral(u) || (isCountry(u) && u.country === sk.host && isHostCountry(sk.host, st));
const canEditEntry = (u, e) => isCentral(u) || (isCountry(u) && u.country === e.country);
const canDecide = (u, e, sk, st) => isCentral(u) || (isCountry(u) && !!sk && u.country === sk.host && isHostCountry(sk.host, st));
const canSeeEntry = (u, e, sk) => isCentral(u) || (isCountry(u) && (e.country === u.country || (!!sk && sk.host === u.country)));
const canManageDelegation = (u, c) => isCentral(u) || (isCountry(u) && u.country === c);
const decisionOf = (e) => e.decision || 'Pending';
const actorCountry = (u, bodyCountry) => {
  if (isCentral(u)) { if (!COUNTRIES[bodyCountry]) fail(400, 'Choose a valid country.'); return bodyCountry; }
  if (!isCountry(u)) fail(403, 'Your account is waiting for approval by the Central Secretariat.');
  return u.country;
};

/* ------------------------------------------------------------------ events */
const listeners = new Set();
function broadcast() { for (const res of listeners) res.write(`event: change\ndata: ${Date.now()}\n\n`); }
setInterval(() => { for (const res of listeners) res.write(': ping\n\n'); }, 25000).unref();
function logAct(u, as, action, detail) {
  db.prepare('INSERT INTO log (at, by, as_, action, detail) VALUES (?, ?, ?, ?, ?)').run(Date.now(), u ? u.id : null, as || '', action, String(detail || '').slice(0, 400));
}
function changed(u, as, action, detail) { logAct(u, as, action, detail); broadcast(); }
const asOf = (u, c) => (isCentral(u) ? (c ? `CENTRAL:${c}` : 'CENTRAL') : (u && u.country) || '');

/* ---------------------------------------------------------------- sessions */
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function sessionUser(req) {
  const tok = parseCookies(req).sid; if (!tok) return null;
  const row = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?').get(sha256(tok), Date.now());
  if (!row || row.status === 'disabled') return null;
  return row;
}
function startSession(res, userId) {
  const tok = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + CFG.sessionDays * 86400000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)').run(sha256(tok), userId, expires);
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(Date.now(), userId);
  res.setHeader('Set-Cookie', `sid=${tok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${CFG.sessionDays * 86400}${CFG.cookieSecure ? '; Secure' : ''}`);
}
function endSession(req, res) {
  const tok = parseCookies(req).sid;
  if (tok) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(tok));
  res.setHeader('Set-Cookie', `sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${CFG.cookieSecure ? '; Secure' : ''}`);
}
const userPublic = (u) => u && { id: u.id, name: u.name, email: u.email, role: u.role, country: u.country || '', status: u.status, mustChange: !!u.must_change };

/* -------------------------------------------------------------- rate limit */
const attempts = new Map();
function clientIp(req) {
  if (CFG.trustProxy && req.headers['x-forwarded-for']) return String(req.headers['x-forwarded-for']).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}
function rateLimit(req, bucket, max = 10, windowMs = 15 * 60000) {
  const key = bucket + '|' + clientIp(req), now = Date.now();
  const a = attempts.get(key);
  if (!a || a.reset < now) { attempts.set(key, { n: 1, reset: now + windowMs }); return; }
  if (++a.n > max) fail(429, 'Too many attempts. Wait 15 minutes and try again.');
}
setInterval(() => { const now = Date.now(); for (const [k, v] of attempts) if (v.reset < now) attempts.delete(k); }, 60000).unref();

/* ------------------------------------------------------------------ router */
const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, auth: opts.auth || 'active', raw: !!opts.raw });
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'The request is too large.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

/* =================================================================== AUTH */
route('POST', '/api/auth/login', ({ req, res, body }) => {
  rateLimit(req, 'login');
  const email = str(body.email, 160).toLowerCase(), password = String(body.password || '');
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!u || !checkPassword(password, u.pass)) fail(401, 'Email or password is incorrect.');
  if (u.status === 'disabled') fail(403, 'This account is disabled. Contact the Central Secretariat.');
  startSession(res, u.id);
  return { ok: true };
}, { auth: 'none' });

route('POST', '/api/auth/logout', ({ req, res }) => { endSession(req, res); return { ok: true }; }, { auth: 'none' });

route('POST', '/api/auth/register', ({ req, res, body }) => {
  if (!CFG.allowSignup) fail(403, 'Sign-up is closed. Ask the Central Secretariat to create your account.');
  rateLimit(req, 'register', 5, 60 * 60000);
  const name = str(body.name, 100), email = str(body.email, 160).toLowerCase(), password = String(body.password || ''), country = str(body.country, 4);
  if (!name) fail(400, 'Enter your full name.');
  if (!emailOk(email)) fail(400, 'Enter a valid email address.');
  if (password.length < 10) fail(400, 'Use a password of at least 10 characters.');
  if (!COUNTRIES[country]) fail(400, 'Choose your country.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) fail(409, 'An account with this email already exists. Sign in instead.');
  const id = newId();
  db.prepare('INSERT INTO users (id, email, name, pass, role, country, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, email, name, hashPassword(password), 'country', country, 'pending', Date.now());
  startSession(res, id);
  changed({ id }, country, 'Requested access', `${name} · ${COUNTRIES[country]}`);
  return { ok: true };
}, { auth: 'none' });

route('POST', '/api/auth/password', ({ user, body }) => {
  const cur = String(body.current || ''), next = String(body.next || '');
  if (!checkPassword(cur, user.pass)) fail(400, 'Your current password is incorrect.');
  if (next.length < 10) fail(400, 'Use a new password of at least 10 characters.');
  if (next === cur) fail(400, 'Choose a password different from the current one.');
  db.prepare('UPDATE users SET pass = ?, must_change = 0 WHERE id = ?').run(hashPassword(next), user.id);
  logAct(user, user.country || 'CENTRAL', 'Changed password', user.name);
  return { ok: true };
}, { auth: 'any' });

/* ================================================================== STATE */
route('GET', '/api/state', ({ user }) => {
  const st = getSettings();
  const fileRows = db.prepare('SELECT id, scope, target, name, kind, size, by, at FROM files ORDER BY at').all();
  const filesFor = (scope, target) => fileRows.filter((f) => f.scope === scope && f.target === target).map(({ scope: _s, target: _t, ...f }) => f);
  const skills = store.all('skills').map((s) => ({ ...s, docs: filesFor('skill', s.id) }));
  const skillMap = new Map(skills.map((s) => [s.id, s]));
  const hosts = {};
  for (const h of store.all('hosts')) hosts[h.id] = { ...h, docs: filesFor('host', h.id) };
  for (const f of fileRows) if (f.scope === 'host' && !hosts[f.target]) hosts[f.target] = { docs: filesFor('host', f.target) };
  const allEntries = store.all('entries');
  const stats = {};
  for (const sk of skills) {
    const mine = allEntries.filter((e) => e.skillId === sk.id);
    const live = mine.filter((e) => !['Withdrawn', 'Reserve'].includes(decisionOf(e)));
    stats[sk.id] = { n: live.length, countries: new Set(live.map((e) => e.country)).size, accepted: mine.filter((e) => decisionOf(e) === 'Accepted').length };
  }
  const liveAll = allEntries.filter((e) => !['Withdrawn', 'Reserve'].includes(decisionOf(e)));
  const totals = { entries: liveAll.length, countries: new Set(liveAll.map((e) => e.country)).size };
  const out = { me: userPublic(user), today: today(), settings: st, signupAllowed: CFG.allowSignup, skills, hosts, stats, totals, entries: [], delegates: [], people: {} };
  if (isActive(user)) {
    out.entries = allEntries.filter((e) => canSeeEntry(user, e, skillMap.get(e.skillId))).map((e) => ({ ...e, docs: filesFor('entry', e.id) }));
    out.delegates = store.all('delegates').filter((d) => isCentral(user) || d.country === user.country);
    for (const r of db.prepare("SELECT id, name FROM users WHERE status != 'pending'").all()) out.people[r.id] = r.name;
  }
  if (isCentral(user)) {
    out.users = db.prepare('SELECT id, name, email, role, country, status, created_at AS createdAt, last_login AS lastLogin FROM users ORDER BY status, role, country, name').all();
    for (const r of out.users) out.people[r.id] = r.name;
    out.log = db.prepare('SELECT at, by, as_ AS "as", action, detail FROM log ORDER BY id DESC LIMIT 150').all();
  }
  return out;
}, { auth: 'any' });

route('GET', '/api/events', ({ req, res }) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(': connected\n\n');
  listeners.add(res);
  req.on('close', () => listeners.delete(res));
  return undefined; // keep open
}, { auth: 'any' });

/* ================================================================== USERS */
function countCentral(exceptId) {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'central' AND status = 'active' AND id != ?").get(exceptId || '').n;
}
route('POST', '/api/users', ({ user, body }) => {
  if (!isCentral(user)) fail(403, 'Only the Central Secretariat manages accounts.');
  const name = str(body.name, 100), email = str(body.email, 160).toLowerCase(), role = body.role === 'central' ? 'central' : 'country', country = role === 'country' ? str(body.country, 4) : null;
  if (!name) fail(400, 'Enter the full name.');
  if (!emailOk(email)) fail(400, 'Enter a valid email address.');
  if (role === 'country' && !COUNTRIES[country]) fail(400, 'Choose the country.');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) fail(409, 'An account with this email already exists.');
  const pw = tempPassword(), id = newId();
  db.prepare('INSERT INTO users (id, email, name, pass, role, country, status, must_change, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)')
    .run(id, email, name, hashPassword(pw), role, country, 'active', Date.now());
  changed(user, 'CENTRAL', 'Created account', `${name} · ${role === 'central' ? 'Central Secretariat' : COUNTRIES[country]}`);
  return { ok: true, id, password: pw };
});
route('PUT', '/api/users/:id', ({ user, params, body }) => {
  if (!isCentral(user)) fail(403, 'Only the Central Secretariat manages accounts.');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(params.id); if (!u) fail(404, 'Account not found.');
  const role = body.role === 'central' ? 'central' : body.role === 'country' ? 'country' : u.role;
  const status = ['active', 'pending', 'disabled'].includes(body.status) ? body.status : u.status;
  const country = role === 'country' ? (body.country !== undefined ? str(body.country, 4) : u.country) : null;
  if (role === 'country' && !COUNTRIES[country]) fail(400, 'Choose the country.');
  if (u.id === user.id && (role !== 'central' || status !== 'active')) fail(400, "You can't remove your own Central Secretariat access.");
  if (u.role === 'central' && u.status === 'active' && (role !== 'central' || status !== 'active') && countCentral(u.id) === 0) fail(400, 'Keep at least one active Central Secretariat account.');
  db.prepare('UPDATE users SET role = ?, country = ?, status = ? WHERE id = ?').run(role, country, status, u.id);
  if (status === 'disabled') db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  const what = u.status === 'pending' && status === 'active' ? 'Approved account' : 'Updated account';
  changed(user, 'CENTRAL', what, `${u.name} · ${role === 'central' ? 'Central Secretariat' : COUNTRIES[country]} · ${status}`);
  return { ok: true };
});
route('POST', '/api/users/:id/reset-password', ({ user, params }) => {
  if (!isCentral(user)) fail(403, 'Only the Central Secretariat manages accounts.');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(params.id); if (!u) fail(404, 'Account not found.');
  const pw = tempPassword();
  db.prepare('UPDATE users SET pass = ?, must_change = 1 WHERE id = ?').run(hashPassword(pw), u.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
  logAct(user, 'CENTRAL', 'Reset password', u.name);
  return { ok: true, password: pw };
});
route('DELETE', '/api/users/:id', ({ user, params }) => {
  if (!isCentral(user)) fail(403, 'Only the Central Secretariat manages accounts.');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(params.id); if (!u) fail(404, 'Account not found.');
  if (u.id === user.id) fail(400, "You can't delete your own account.");
  if (u.role === 'central' && u.status === 'active' && countCentral(u.id) === 0) fail(400, 'Keep at least one active Central Secretariat account.');
  db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
  changed(user, 'CENTRAL', 'Deleted account', u.name);
  return { ok: true };
});

/* =============================================================== SETTINGS */
route('PUT', '/api/settings', ({ user, body }) => {
  if (!isCentral(user)) fail(403, 'Only the Central Secretariat changes settings.');
  const st = getSettings();
  const ws = str(body.windowStart, 10), we = str(body.windowEnd, 10);
  if (!isDate(ws) || !isDate(we)) fail(400, 'Enter valid dates.');
  if (ws && we && we < ws) fail(400, 'The competition window must close after it opens.');
  const hosts = Array.isArray(body.hostCountries) ? body.hostCountries.filter((c) => COUNTRIES[c]) : st.hostCountries;
  const registration = {};
  for (const s of STAGES) {
    const o = str(body.registration?.[s]?.open, 10), c = str(body.registration?.[s]?.close, 10);
    if (!isDate(o) || !isDate(c)) fail(400, `Enter valid dates for the ${s} stage.`);
    if ((o && !c) || (!o && c)) fail(400, `Set both dates for the ${s} stage, or neither.`);
    if (o && c && c < o) fail(400, `The ${s} stage must close after it opens.`);
    registration[s] = { open: o, close: c };
  }
  for (let i = 1; i < STAGES.length; i++) {
    const p = registration[STAGES[i - 1]], q = registration[STAGES[i]];
    if (p.close && q.open && q.open <= p.close) fail(400, `The ${STAGES[i]} stage must open after the ${STAGES[i - 1]} stage closes.`);
  }
  putSettings({ ...st, windowStart: ws, windowEnd: we, hostCountries: [...new Set(hosts)], registration });
  changed(user, 'CENTRAL', 'Updated settings', `Hosts: ${hosts.join(', ') || 'none'} · ${STAGES.map((s) => `${s} ${registration[s].open || '–'} to ${registration[s].close || '–'}`).join('; ')}`);
  return { ok: true };
});
route('PUT', '/api/settings/delegation', ({ user, body }) => {
  if (!isCentral(user)) fail(403, 'Only the Central Secretariat changes settings.');
  const st = getSettings();
  const o = str(body.delegationReg?.open, 10), c = str(body.delegationReg?.close, 10);
  if (!isDate(o) || !isDate(c)) fail(400, 'Enter valid registration dates.');
  if ((o && !c) || (!o && c)) fail(400, 'Set both registration dates, or neither.');
  if (o && c && c < o) fail(400, 'Registration must close after it opens.');
  if (!Array.isArray(body.roles)) fail(400, 'Roles are missing.');
  const known = new Map((st.roles || []).map((r) => [r.id, r]));
  const out = [];
  for (const r of body.roles) {
    const name = str(r.name, 60); if (!name) fail(400, 'Every role needs a name.');
    const max = Number(r.max); if (!Number.isInteger(max) || max < 0 || max > 200) fail(400, `Enter a whole number of places for ${name}.`);
    let id = r.id && known.has(r.id) ? r.id : null;
    if (!id) { const base = slug(name); id = base; let j = 2; while (known.has(id) || out.some((x) => x.id === id)) id = `${base}-${j++}`; }
    out.push({ id, name, max });
  }
  if (new Set(out.map((r) => r.name.toLowerCase())).size !== out.length) fail(400, 'Two roles have the same name.');
  const dels = store.all('delegates');
  for (const r of st.roles || []) if (!out.some((x) => x.id === r.id) && dels.some((d) => d.role === r.id)) fail(400, `${r.name} has people registered, so it can't be removed.`);
  putSettings({ ...st, roles: out, delegationReg: { open: o, close: c } });
  changed(user, 'CENTRAL', 'Updated delegation settings', `${out.map((r) => `${r.name} ${r.max}`).join(', ')} · open ${o || '–'} to ${c || '–'}`);
  return { ok: true };
});

/* ================================================================= SKILLS */
function skillFromBody(body, old, user, st) {
  const host = old ? old.host : (isCentral(user) ? str(body.host, 4) : user.country);
  if (!COUNTRIES[host] || !isHostCountry(host, st)) fail(400, 'Only host countries can have skills.');
  if (!canEditSkill(user, { host }, st)) fail(403, "You can only manage your own country's skills.");
  const d = {
    host, name: str(body.name, 80), type: body.type === 'Team' ? 'Team' : 'Individual',
    city: str(body.city, 60), venue: str(body.venue, 120), c1: str(body.c1, 10), c3: str(body.c3, 10),
    workstations: int(body.workstations, 'Workstations'), min: int(body.min, 'Minimum entries'), max: int(body.max, 'Maximum entries'),
    infra: ['', 'Ready', 'In progress', 'Not started'].includes(body.infra) ? body.infra : '',
    consumables: ['', 'Yes', 'Partly', 'No'].includes(body.consumables) ? body.consumables : '',
    techLead: str(body.techLead, 120), workshopManager: str(body.workshopManager, 120), gaps: str(body.gaps, 600), notes: str(body.notes, 600),
  };
  d.teamSize = d.type === 'Team' ? int(body.teamSize, 'Team size') : '';
  if (!d.name) fail(400, 'Enter the skill name.');
  if (!isDate(d.c1) || !isDate(d.c3)) fail(400, 'Enter valid competition dates.');
  if (d.min !== '' && d.max !== '' && d.min > d.max) fail(400, "Minimum entries can't be more than the maximum.");
  if (d.max !== '' && d.workstations !== '' && d.max > d.workstations) fail(400, "Maximum entries can't be more than the workstations available.");
  if (d.c1 && d.c3 && d.c3 < d.c1) fail(400, 'C3 must be on or after C1.');
  for (const k of ['c1', 'c3']) if (d[k] && ((st.windowStart && d[k] < st.windowStart) || (st.windowEnd && d[k] > st.windowEnd))) fail(400, `Competition dates must fall between ${st.windowStart} and ${st.windowEnd}.`);
  const status = SKILL_STATUS.includes(body.status) ? body.status : (old ? old.status : 'Proposed');
  if (!isCentral(user) && status !== (old ? old.status || 'Proposed' : 'Proposed') && !['Proposed', 'Withdrawn'].includes(status)) fail(403, 'Only the Central Secretariat sets Official or Demo Skill.');
  d.status = status;
  d.open = isCentral(user) ? body.open !== false : (old ? old.open !== false : true);
  return d;
}
route('POST', '/api/skills', ({ user, body }) => {
  const st = getSettings(); const d = skillFromBody(body, null, user, st);
  const id = `${d.host.toLowerCase()}-${slug(d.name)}-${newId().slice(0, 4)}`;
  store.put('skills', id, { ...d, createdBy: user.id, createdAt: Date.now(), updatedBy: user.id, updatedAt: Date.now() });
  changed(user, asOf(user, d.host), 'Added skill', `${d.host} · ${d.name}`);
  return { ok: true, id, note: d.c1 && d.c3 && dayDiff(d.c1, d.c3) !== 2 ? 'C1 to C3 is usually three consecutive days.' : '' };
});
route('PUT', '/api/skills/:id', ({ user, params, body }) => {
  const st = getSettings(); const old = store.get('skills', params.id); if (!old) fail(404, 'Skill not found.');
  if (!canEditSkill(user, old, st)) fail(403, "You can only manage your own country's skills.");
  const d = skillFromBody(body, old, user, st);
  store.put('skills', old.id, { ...old, ...d, updatedBy: user.id, updatedAt: Date.now() });
  changed(user, asOf(user, d.host), 'Edited skill', `${d.host} · ${d.name}${(old.status || 'Proposed') !== d.status ? ` · status ${old.status || 'Proposed'} → ${d.status}` : ''}`);
  return { ok: true, note: d.c1 && d.c3 && dayDiff(d.c1, d.c3) !== 2 ? 'C1 to C3 is usually three consecutive days.' : '' };
});

/* ================================================================== HOSTS */
route('PUT', '/api/hosts/:c', ({ user, params, body }) => {
  const st = getSettings(), c = params.c;
  if (!COUNTRIES[c] || !isHostCountry(c, st)) fail(400, 'Not a host country.');
  if (!isCentral(user) && !(isCountry(user) && user.country === c)) fail(403, "You can only edit your own host information.");
  const old = store.get('hosts', c) || {};
  store.put('hosts', c, { ...old, contact: str(body.contact, 120), email: str(body.email, 120), phone: str(body.phone, 40), cities: str(body.cities, 120), announcement: str(body.announcement, 600), updatedBy: user.id, updatedAt: Date.now() });
  changed(user, asOf(user, c), 'Edited host information', COUNTRIES[c]);
  return { ok: true };
});

/* ================================================================ ENTRIES */
route('POST', '/api/entries', ({ user, body }) => {
  const st = getSettings(); const country = actorCountry(user, str(body.country, 4));
  const cur = currentStage(st); if (!cur) fail(409, 'Registration is closed. Entries can be added only while a registration stage is open.');
  const sk = store.get('skills', str(body.skillId, 80)); if (!sk) fail(400, 'Choose a skill.');
  if (sk.status === 'Withdrawn' || sk.open === false) fail(409, 'This skill is not open for entries.');
  const e = { skillId: sk.id, country, competitors: str(body.competitors, 200), expert: str(body.expert, 100), notes: str(body.notes, 500), stage: cur, decision: 'Pending',
    createdBy: user.id, createdAt: Date.now(), updatedBy: user.id, updatedAt: Date.now() };
  if (cur === 'Definitive' && (!e.competitors || !e.expert)) fail(400, 'At the Definitive stage, enter the competitor name(s) and the expert name.');
  const id = newId(); store.put('entries', id, e);
  changed(user, asOf(user, country), 'Added entry', `${COUNTRIES[country]} → ${sk.host} ${sk.name} · ${cur}`);
  return { ok: true, id };
});
route('PUT', '/api/entries/:id', ({ user, params, body }) => {
  const st = getSettings(); const old = store.get('entries', params.id); if (!old) fail(404, 'Entry not found.');
  if (!canEditEntry(user, old)) fail(403, "You can only edit your own country's entries.");
  const cur = currentStage(st);
  if (!isCentral(user) && !cur) fail(409, 'Registration is closed. Your changes were not saved.');
  if (!isCentral(user) && decisionOf(old) === 'Withdrawn') fail(409, 'This entry was withdrawn.');
  const stage = cur && STAGES.indexOf(cur) > STAGES.indexOf(old.stage || 'Interest') ? cur : (old.stage || 'Interest');
  const e = { ...old, competitors: str(body.competitors, 200), expert: str(body.expert, 100), notes: str(body.notes, 500), stage, updatedBy: user.id, updatedAt: Date.now() };
  if (isCentral(user) && DECISIONS.includes(body.decision)) e.decision = body.decision;
  if (stage === 'Definitive' && (!e.competitors || !e.expert)) fail(400, 'At the Definitive stage, enter the competitor name(s) and the expert name.');
  store.put('entries', old.id, e);
  const sk = store.get('skills', old.skillId) || {};
  changed(user, asOf(user, old.country), 'Edited entry', `${COUNTRIES[old.country]} → ${sk.host} ${sk.name} · ${stage}${old.stage !== stage ? ` (was ${old.stage})` : ''}`);
  return { ok: true };
});
route('POST', '/api/entries/:id/decision', ({ user, params, body }) => {
  const st = getSettings(); const e = store.get('entries', params.id); if (!e) fail(404, 'Entry not found.');
  const sk = store.get('skills', e.skillId);
  if (!canDecide(user, e, sk, st)) fail(403, 'Only the host of this skill or the Central Secretariat records decisions.');
  if (!DECISIONS.includes(body.decision)) fail(400, 'Choose a decision.');
  const from = decisionOf(e);
  store.put('entries', e.id, { ...e, decision: body.decision, decidedBy: user.id, decidedAt: Date.now(), updatedBy: user.id, updatedAt: Date.now() });
  changed(user, asOf(user, sk && sk.host), 'Changed entry decision', `${COUNTRIES[e.country]} → ${sk ? `${sk.host} ${sk.name}` : 'skill'}: ${from} → ${body.decision}`);
  return { ok: true };
});
route('POST', '/api/entries/:id/withdraw', ({ user, params }) => {
  const e = store.get('entries', params.id); if (!e) fail(404, 'Entry not found.');
  if (!canEditEntry(user, e)) fail(403, "You can only withdraw your own country's entries.");
  store.put('entries', e.id, { ...e, decision: 'Withdrawn', updatedBy: user.id, updatedAt: Date.now() });
  const sk = store.get('skills', e.skillId) || {};
  changed(user, asOf(user, e.country), 'Withdrew entry', `${COUNTRIES[e.country]} → ${sk.host} ${sk.name}`);
  return { ok: true };
});

/* ============================================================== DELEGATES */
function delegateFields(body) {
  const d = { name: str(body.name, 100), position: str(body.position, 150), email: str(body.email, 120), phone: str(body.phone, 40), notes: str(body.notes, 400) };
  if (!d.name) fail(400, 'Enter the full name.');
  if (d.email && !emailOk(d.email)) fail(400, 'Check the email address.');
  return d;
}
route('POST', '/api/delegates', ({ user, body }) => {
  const st = getSettings(); const country = actorCountry(user, str(body.country, 4));
  if (!isCentral(user) && !delegOpen(st)) fail(409, 'Delegation registration is closed.');
  const role = (st.roles || []).find((r) => r.id === body.role); if (!role) fail(400, 'This role is no longer in use.');
  const used = store.all('delegates').filter((d) => d.country === country && d.role === role.id).length;
  if (used >= role.max) fail(409, `All ${role.max} ${role.name} place${role.max === 1 ? ' is' : 's are'} filled for ${COUNTRIES[country]}.`);
  const id = newId();
  store.put('delegates', id, { country, role: role.id, ...delegateFields(body), createdBy: user.id, createdAt: Date.now(), updatedBy: user.id, updatedAt: Date.now() });
  changed(user, asOf(user, country), 'Added delegate', `${COUNTRIES[country]} · ${role.name}`);
  return { ok: true, id };
});
route('PUT', '/api/delegates/:id', ({ user, params, body }) => {
  const st = getSettings(); const old = store.get('delegates', params.id); if (!old) fail(404, 'Not found.');
  if (!canManageDelegation(user, old.country)) fail(403, "You can only manage your own country's delegation.");
  if (!isCentral(user) && !delegOpen(st)) fail(409, 'Delegation registration is closed.');
  store.put('delegates', old.id, { ...old, ...delegateFields(body), updatedBy: user.id, updatedAt: Date.now() });
  changed(user, asOf(user, old.country), 'Edited delegate', `${COUNTRIES[old.country]} · ${(st.roles.find((r) => r.id === old.role) || {}).name || old.role}`);
  return { ok: true };
});
route('DELETE', '/api/delegates/:id', ({ user, params }) => {
  const st = getSettings(); const old = store.get('delegates', params.id); if (!old) fail(404, 'Not found.');
  if (!canManageDelegation(user, old.country)) fail(403, "You can only manage your own country's delegation.");
  if (!isCentral(user) && !delegOpen(st)) fail(409, 'Delegation registration is closed.');
  store.del('delegates', old.id);
  changed(user, asOf(user, old.country), 'Removed delegate', `${COUNTRIES[old.country]} · ${(st.roles.find((r) => r.id === old.role) || {}).name || old.role}`);
  return { ok: true };
});

/* ================================================================== FILES */
function fileTargetCheck(user, scope, target, st) {
  if (scope === 'skill') { const sk = store.get('skills', target); if (!sk) fail(404, 'Skill not found.'); if (!canEditSkill(user, sk, st)) fail(403, "You can only add documents to your own country's skills."); return sk.name; }
  if (scope === 'host') { if (!isCentral(user) && !(isCountry(user) && user.country === target && isHostCountry(target, st))) fail(403, 'You can only add your own host documents.'); return COUNTRIES[target] || target; }
  if (scope === 'entry') { const e = store.get('entries', target); if (!e) fail(404, 'Entry not found.'); if (!canEditEntry(user, e)) fail(403, "You can only add documents to your own country's entries."); return COUNTRIES[e.country]; }
  fail(400, 'Unknown document type.');
}
route('POST', '/api/files', async ({ req, user, query }) => {
  const st = getSettings(), scope = str(query.get('scope'), 10), target = str(query.get('target'), 80);
  const label = fileTargetCheck(user, scope, target, st);
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (!UPLOAD_TYPES[mime]) fail(415, 'This file type is not accepted. Upload PDF, PNG, JPG, WEBP, CSV, TXT, MD or JSON.');
  const len = Number(req.headers['content-length'] || 0);
  if (len > CFG.maxUpload) fail(413, 'The file is over 20 MB.');
  const buf = await readBody(req, CFG.maxUpload);
  if (!buf.length) fail(400, 'The file is empty.');
  const id = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(path.join(UPLOAD_DIR, id), buf);
  const name = str(query.get('name'), 150) || `document.${UPLOAD_TYPES[mime]}`;
  db.prepare('INSERT INTO files (id, scope, target, name, kind, mime, size, by, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, scope, target, name, str(query.get('kind'), 60), mime, buf.length, user.id, Date.now());
  changed(user, asOf(user, scope === 'host' ? target : ''), 'Uploaded document', `${label}: ${name}`);
  return { ok: true, id };
}, { raw: true });
route('GET', '/api/files/:id', ({ user, res, params }) => {
  const f = db.prepare('SELECT * FROM files WHERE id = ?').get(params.id); if (!f) fail(404, 'File not found.');
  if (f.scope === 'entry') {
    const e = store.get('entries', f.target); const sk = e && store.get('skills', e.skillId);
    if (!e || !canSeeEntry(user, e, sk)) fail(404, 'File not found.');
  }
  const p = path.join(UPLOAD_DIR, f.id); if (!fs.existsSync(p)) fail(404, 'File not found.');
  const disp = INLINE_TYPES.has(f.mime) ? 'inline' : 'attachment';
  res.writeHead(200, {
    'Content-Type': f.mime, 'Content-Length': f.size, 'Cache-Control': 'private, max-age=300',
    'Content-Disposition': `${disp}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff',
  });
  fs.createReadStream(p).pipe(res);
  return undefined;
}, { auth: 'any' });
route('DELETE', '/api/files/:id', ({ user, params }) => {
  const st = getSettings(); const f = db.prepare('SELECT * FROM files WHERE id = ?').get(params.id); if (!f) fail(404, 'File not found.');
  const label = fileTargetCheck(user, f.scope, f.target, st);
  db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
  fs.rmSync(path.join(UPLOAD_DIR, f.id), { force: true });
  changed(user, asOf(user, f.scope === 'host' ? f.target : ''), 'Removed document', `${label}: ${f.name}`);
  return { ok: true };
});

/* ================================================================= EXPORT */
function csv(rows) {
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
route('GET', '/api/export/:kind', ({ user, res, params }) => {
  if (!isCentral(user)) fail(403, 'Only the Central Secretariat can export.');
  const st = getSettings(); let rows;
  if (params.kind === 'entries.csv') {
    const sk = new Map(store.all('skills').map((s) => [s.id, s]));
    rows = [['Host', 'Skill', 'Skill status', 'Country', 'Competitor(s)', 'Expert', 'Stage', 'Decision', 'Notes', 'Updated']];
    for (const e of store.all('entries')) { const s = sk.get(e.skillId) || {}; rows.push([s.host, s.name, s.status || 'Proposed', COUNTRIES[e.country], e.competitors, e.expert, e.stage, decisionOf(e), e.notes, new Date(e.updatedAt || 0).toISOString()]); }
  } else if (params.kind === 'delegates.csv') {
    rows = [['Country', 'Role', 'Name', 'Position and organisation', 'Email', 'Phone', 'Notes']];
    for (const d of store.all('delegates')) rows.push([COUNTRIES[d.country], (st.roles.find((r) => r.id === d.role) || {}).name || d.role, d.name, d.position, d.email, d.phone, d.notes]);
  } else if (params.kind === 'skills.csv') {
    rows = [['Host', 'Skill', 'Type', 'Status', 'City', 'Venue', 'C1', 'C3', 'Workstations', 'Minimum', 'Maximum', 'Technical lead', 'Workshop manager']];
    for (const s of store.all('skills')) rows.push([s.host, s.name, s.type, s.status || 'Proposed', s.city, s.venue, s.c1, s.c3, s.workstations, s.min, s.max, s.techLead, s.workshopManager]);
  } else fail(404, 'Unknown export.');
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="ws-asean-2027-${params.kind}"`, 'Cache-Control': 'no-store' });
  res.end(csv(rows));
  return undefined;
});

/* ================================================================= SERVER */
const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const p = path.normalize(path.join(CFG.publicDir, rel));
  if (!p.startsWith(CFG.publicDir + path.sep) || !fs.existsSync(p) || !fs.statSync(p).isFile()) {
    if (req.method === 'GET' && !path.extname(pathname)) rel = '/index.html'; else { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
  }
  const file = path.normalize(path.join(CFG.publicDir, rel));
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': STATIC_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
    ...(ext === '.html' ? { 'Content-Security-Policy': CSP } : {}),
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (CFG.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Method not allowed.');
      return serveStatic(req, res, url.pathname);
    }
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) fail(404, 'Not found.');
    if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'fetch') fail(403, 'Request blocked.');
    const params = {}; const m = url.pathname.match(r.re); r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    const user = sessionUser(req);
    if (r.auth !== 'none' && !user) fail(401, 'Please sign in.');
    if (r.auth === 'active' && !isActive(user)) fail(403, 'Your account is waiting for approval by the Central Secretariat.');
    let body = {};
    if (!r.raw && req.method !== 'GET') {
      const buf = await readBody(req, 1024 * 1024);
      if (buf.length) { try { body = JSON.parse(buf.toString('utf8')); } catch { fail(400, 'Invalid request.'); } }
      if (!body || typeof body !== 'object') body = {};
    }
    const result = await r.handler({ req, res, user, params, query: url.searchParams, body });
    if (result !== undefined && !res.headersSent) send(res, 200, result);
  } catch (e) {
    if (res.headersSent) { res.end(); return; }
    if (e instanceof HttpError) send(res, e.status, { error: e.message });
    else { console.error(e); send(res, 500, { error: 'Something went wrong on the server. Try again.' }); }
  }
});

/* ------------------------------------------------------------------- boot */
function bootstrap() {
  if (!db.prepare('SELECT 1 FROM kv WHERE key = ?').get('settings')) putSettings(DEFAULT_SETTINGS);
  if (db.prepare('SELECT COUNT(*) AS n FROM skills').get().n === 0) {
    const now = Date.now();
    for (const [host, name, team] of SEED_SKILLS) {
      store.put('skills', `${host.toLowerCase()}-${slug(name)}`, { host, name, type: team ? 'Team' : 'Individual', teamSize: team || '', status: 'Proposed', open: true,
        city: '', venue: '', c1: '', c3: '', workstations: '', min: '', max: '', infra: '', consumables: '', techLead: '', workshopManager: '', gaps: '', notes: '', createdAt: now, updatedAt: now });
    }
    console.log(`Seeded ${SEED_SKILLS.length} proposed skills.`);
  }
  const centrals = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'central' AND status = 'active'").get().n;
  if (!centrals) {
    const email = str(process.env.ADMIN_EMAIL, 160).toLowerCase(), pw = String(process.env.ADMIN_PASSWORD || '');
    if (emailOk(email) && pw.length >= 10) {
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) db.prepare("UPDATE users SET role = 'central', country = NULL, status = 'active', pass = ? WHERE id = ?").run(hashPassword(pw), existing.id);
      else db.prepare('INSERT INTO users (id, email, name, pass, role, country, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(newId(), email, str(process.env.ADMIN_NAME, 100) || 'Central Secretariat', hashPassword(pw), 'central', null, 'active', Date.now());
      console.log(`Central Secretariat account ready: ${email}`);
    } else {
      console.warn('No Central Secretariat account yet. Set ADMIN_EMAIL and ADMIN_PASSWORD (10+ characters) and restart.');
    }
  }
}
bootstrap();
server.listen(CFG.port, CFG.host, () => console.log(`WorldSkills ASEAN 2027 registry listening on port ${server.address().port}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(); db.close(); process.exit(0); });
