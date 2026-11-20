'use strict';
// Sets a new temporary password for a Central Secretariat account (or makes an existing account Central).
//   docker compose exec app npm run reset-admin -- you@example.org
// Without an email it lists the Central Secretariat accounts.
const { openDb, hashPassword, tempPassword, logAct } = require('./accounts-lib');

const db = openDb();
const email = String(process.argv[2] || '').trim().toLowerCase();
if (!email) {
  const list = db.prepare("SELECT email, name, status FROM users WHERE role = 'central' ORDER BY email").all();
  console.log(list.length ? 'Central Secretariat accounts:\n' + list.map((u) => `  ${u.email}  (${u.name}, ${u.status})`).join('\n') : 'No Central Secretariat accounts yet.');
  console.log('\nUsage: npm run reset-admin -- <email>');
  process.exit(0);
}
const u = db.prepare('SELECT id, name FROM users WHERE email = ?').get(email);
if (!u) { console.error(`No account with the email ${email}.`); process.exit(1); }
const pw = tempPassword();
db.prepare("UPDATE users SET pass = ?, role = 'central', country = NULL, status = 'active', must_change = 1 WHERE id = ?").run(hashPassword(pw), u.id);
db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
logAct(db, 'Reset Central Secretariat password (server command)', u.name);
console.log(`\nNew temporary password for ${email}: ${pw}\nSign in with it; you'll be asked to set your own password.\n`);
