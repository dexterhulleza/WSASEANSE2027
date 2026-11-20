'use strict';
// Shared helpers for the account scripts. Same password format as server.js.
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const COUNTRIES = { BN: 'Brunei Darussalam', KH: 'Cambodia', ID: 'Indonesia', LA: 'Lao PDR', MY: 'Malaysia', MM: 'Myanmar', PH: 'Philippines', SG: 'Singapore', TH: 'Thailand', TL: 'Timor-Leste', VN: 'Viet Nam' };

function openDb() {
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const db = new DatabaseSync(path.join(dataDir, 'registry.db'));
  db.exec('PRAGMA busy_timeout = 5000;');
  const hasUsers = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (!hasUsers) { console.error('No registry database found. Start the app once first.'); process.exit(1); }
  return db;
}
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `s1$${salt.toString('base64')}$${crypto.scryptSync(pw, salt, 64).toString('base64')}`;
}
function tempPassword() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(12), (b) => abc[b % abc.length]).join('');
}
const newId = () => crypto.randomBytes(9).toString('base64url');
function logAct(db, action, detail) {
  db.prepare('INSERT INTO log (at, by, as_, action, detail) VALUES (?, ?, ?, ?, ?)').run(Date.now(), null, 'CENTRAL', action, detail);
}

module.exports = { COUNTRIES, openDb, hashPassword, tempPassword, newId, logAct };
