'use strict';
// End-to-end checks of the server rules. Run with: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let proc, base, dataDir;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = (days) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws27-'));
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: dataDir, COOKIE_SECURE: 'false', ADMIN_EMAIL: 'central@example.org', ADMIN_PASSWORD: 'central-pass-123' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  base = await new Promise((resolve, reject) => {
    let out = '';
    proc.stdout.on('data', (c) => { out += c; const m = out.match(/listening on port (\d+)/); if (m) resolve(`http://127.0.0.1:${m[1]}`); });
    proc.on('exit', (code) => reject(new Error('server exited ' + code)));
  });
});
after(() => { proc.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

function client() {
  let cookie = '';
  return async function call(method, url, body, extra = {}) {
    const headers = { 'X-Requested-With': 'fetch', ...(extra.headers || {}) };
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (extra.raw) { payload = extra.raw; headers['Content-Type'] = extra.type; }
    else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    const res = await fetch(base + url, { method, headers, body: payload });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}

const central = client(), vn = client(), sg = client(), th = client();
let vnId, entryId, sgSkill;

test('health check and static page', async () => {
  const h = await fetch(base + '/healthz'); assert.equal(h.status, 200);
  const p = await fetch(base + '/'); assert.equal(p.status, 200); assert.match(await p.text(), /Skills Registry/);
});

test('requests without the fetch header are blocked', async () => {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});

test('central signs in and sees the seeded skills', async () => {
  assert.equal((await central('POST', '/api/auth/login', { email: 'central@example.org', password: 'wrong-password' })).status, 401);
  assert.equal((await central('POST', '/api/auth/login', { email: 'central@example.org', password: 'central-pass-123' })).status, 200);
  const s = await central('GET', '/api/state');
  assert.equal(s.data.me.role, 'central');
  assert.equal(s.data.skills.length, 17);
  sgSkill = s.data.skills.find((x) => x.host === 'SG').id;
});

test('a new country account waits for approval', async () => {
  assert.equal((await vn('POST', '/api/auth/register', { name: 'VN Secretariat', email: 'vn@example.org', password: 'vn-password-1', country: 'VN' })).status, 200);
  const s = await vn('GET', '/api/state');
  assert.equal(s.data.me.status, 'pending');
  assert.equal((await vn('POST', '/api/entries', { skillId: sgSkill })).status, 403);
  const users = (await central('GET', '/api/state')).data.users;
  vnId = users.find((u) => u.email === 'vn@example.org').id;
  assert.equal((await central('PUT', `/api/users/${vnId}`, { status: 'active' })).status, 200);
});

test('central creates accounts with a temporary password', async () => {
  const a = await central('POST', '/api/users', { name: 'SG Secretariat', email: 'sg@example.org', role: 'country', country: 'SG' });
  assert.equal(a.status, 200); assert.ok(a.data.password.length >= 12);
  assert.equal((await sg('POST', '/api/auth/login', { email: 'sg@example.org', password: a.data.password })).status, 200);
  assert.equal((await sg('GET', '/api/state')).data.me.mustChange, true);
  const b = await central('POST', '/api/users', { name: 'TH Secretariat', email: 'th@example.org', role: 'country', country: 'TH' });
  assert.equal((await th('POST', '/api/auth/login', { email: 'th@example.org', password: b.data.password })).status, 200);
});

test('entries only while a registration stage is open, stage fixed by the schedule', async () => {
  const st = (await central('GET', '/api/state')).data.settings;
  const closedAll = { Interest: { open: shift(-30), close: shift(-20) }, Provisional: { open: shift(-10), close: shift(-5) }, Definitive: { open: shift(5), close: shift(10) } };
  assert.equal((await central('PUT', '/api/settings', { ...st, registration: closedAll })).status, 200);
  assert.equal((await vn('POST', '/api/entries', { skillId: sgSkill })).status, 409);
  assert.equal((await central('POST', '/api/entries', { skillId: sgSkill, country: 'VN' })).status, 409);
  const provOpen = { ...closedAll, Provisional: { open: shift(-1), close: shift(1) } };
  assert.equal((await central('PUT', '/api/settings', { ...st, registration: provOpen })).status, 200);
  const r = await vn('POST', '/api/entries', { skillId: sgSkill, stage: 'Definitive', country: 'TH' });
  assert.equal(r.status, 200); entryId = r.data.id;
  const e = (await vn('GET', '/api/state')).data.entries.find((x) => x.id === entryId);
  assert.equal(e.stage, 'Provisional'); assert.equal(e.country, 'VN');
  assert.equal((await central('PUT', '/api/settings', { ...st, registration: closedAll })).status, 200);
  assert.equal((await vn('PUT', `/api/entries/${entryId}`, { competitors: 'A' })).status, 409);
  assert.equal((await central('PUT', '/api/settings', { ...st, registration: provOpen })).status, 200);
});

test('countries see only their own entries; the host sees entries in its skills', async () => {
  assert.equal((await th('GET', '/api/state')).data.entries.length, 0);
  assert.equal((await sg('GET', '/api/state')).data.entries.length, 1);
  assert.equal((await th('GET', '/api/state')).data.stats[sgSkill].n, 1);
  assert.equal((await th('POST', `/api/entries/${entryId}/decision`, { decision: 'Accepted' })).status, 403);
  assert.equal((await sg('POST', `/api/entries/${entryId}/decision`, { decision: 'Accepted' })).status, 200);
});

test('only the host or central edits a skill; only central sets Official', async () => {
  const sk = (await sg('GET', '/api/state')).data.skills.find((x) => x.id === sgSkill);
  assert.equal((await vn('PUT', `/api/skills/${sgSkill}`, { ...sk, min: 2 })).status, 403);
  assert.equal((await sg('PUT', `/api/skills/${sgSkill}`, { ...sk, min: 9, max: 4 })).status, 400);
  assert.equal((await sg('PUT', `/api/skills/${sgSkill}`, { ...sk, status: 'Official' })).status, 403);
  assert.equal((await sg('PUT', `/api/skills/${sgSkill}`, { ...sk, min: 4, max: 8, workstations: 8, c1: '2027-08-16', c3: '2027-08-18' })).status, 200);
  assert.equal((await sg('PUT', `/api/skills/${sgSkill}`, { ...sk, c1: '2027-06-01' })).status, 400);
  assert.equal((await central('PUT', `/api/skills/${sgSkill}`, { ...sk, status: 'Official' })).status, 200);
});

test('delegation places are capped per role', async () => {
  assert.equal((await vn('POST', '/api/delegates', { role: 'od', name: 'First OD' })).status, 200);
  assert.equal((await vn('POST', '/api/delegates', { role: 'od', name: 'Second OD' })).status, 409);
  assert.equal((await th('GET', '/api/state')).data.delegates.length, 0);
  const st = (await central('GET', '/api/state')).data.settings;
  const roles = st.roles.filter((r) => r.id !== 'od');
  assert.equal((await central('PUT', '/api/settings/delegation', { roles, delegationReg: st.delegationReg })).status, 400);
  assert.equal((await central('PUT', '/api/settings/delegation', { roles: [...st.roles, { name: 'Interpreter', max: 2 }], delegationReg: st.delegationReg })).status, 200);
  assert.ok((await central('GET', '/api/state')).data.settings.roles.some((r) => r.name === 'Interpreter'));
});

test('entry files are private to the country, its host and central', async () => {
  const up = await vn('POST', `/api/files?scope=entry&target=${entryId}&kind=Consent%20form&name=consent.txt`, undefined, { raw: Buffer.from('signed'), type: 'text/plain' });
  assert.equal(up.status, 200);
  assert.equal((await vn('GET', `/api/files/${up.data.id}`)).status, 200);
  assert.equal((await sg('GET', `/api/files/${up.data.id}`)).status, 200);
  assert.equal((await th('GET', `/api/files/${up.data.id}`)).status, 404);
  assert.equal((await vn('POST', `/api/files?scope=entry&target=${entryId}`, undefined, { raw: Buffer.from('<html>'), type: 'text/html' })).status, 415);
});

test('withdraw works any time; the last central account is protected', async () => {
  assert.equal((await vn('POST', `/api/entries/${entryId}/withdraw`, {})).status, 200);
  const me = (await central('GET', '/api/state')).data.me;
  assert.equal((await central('PUT', `/api/users/${me.id}`, { status: 'disabled' })).status, 400);
  assert.equal((await central('GET', '/api/export/entries.csv')).status, 200);
  assert.equal((await vn('GET', '/api/export/entries.csv')).status, 403);
});
