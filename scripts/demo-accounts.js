'use strict';
// Creates one demo Country Secretariat account per ASEAN member state, for testing and training.
//   docker compose exec app npm run demo-accounts            create missing accounts, print their passwords
//   docker compose exec app npm run demo-accounts -- --reset give every demo account a new password
//   docker compose exec app npm run demo-accounts -- --remove delete all demo accounts
// Demo emails use the reserved example.org domain: <code>.secretariat@example.org (e.g. vn.secretariat@example.org).
const { COUNTRIES, openDb, hashPassword, tempPassword, newId, logAct } = require('./accounts-lib');

const db = openDb();
const mode = process.argv.includes('--remove') ? 'remove' : process.argv.includes('--reset') ? 'reset' : 'create';
const emailFor = (c) => `${c.toLowerCase()}.secretariat@example.org`;

if (mode === 'remove') {
  let n = 0;
  for (const c of Object.keys(COUNTRIES)) n += Number(db.prepare('DELETE FROM users WHERE email = ?').run(emailFor(c)).changes);
  logAct(db, 'Removed demo accounts', `${n} accounts`);
  console.log(`Removed ${n} demo accounts. Entries and delegates they added stay in the registry.`);
  process.exit(0);
}

const rows = [];
for (const [c, name] of Object.entries(COUNTRIES)) {
  const email = emailFor(c), pw = tempPassword();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing && mode === 'create') { rows.push([name, email, '(already exists; use --reset for a new password)']); continue; }
  if (existing) {
    db.prepare("UPDATE users SET pass = ?, role = 'country', country = ?, status = 'active', must_change = 0 WHERE id = ?").run(hashPassword(pw), c, existing.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
  } else {
    db.prepare('INSERT INTO users (id, email, name, pass, role, country, status, must_change, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)')
      .run(newId(), email, `Demo ${name} Secretariat`, hashPassword(pw), 'country', c, 'active', Date.now());
  }
  rows.push([name, email, pw]);
}
logAct(db, mode === 'reset' ? 'Reset demo account passwords' : 'Created demo accounts', `${Object.keys(COUNTRIES).length} countries`);

const w = [Math.max(...rows.map((r) => r[0].length)), Math.max(...rows.map((r) => r[1].length))];
console.log(`\n${'Country'.padEnd(w[0])}  ${'Email'.padEnd(w[1])}  Password`);
for (const r of rows) console.log(`${r[0].padEnd(w[0])}  ${r[1].padEnd(w[1])}  ${r[2]}`);
console.log('\nPasswords are shown only now. Demo accounts are not asked to change them. Remove them before go-live with: npm run demo-accounts -- --remove\n');
