'use strict';
// Consistent snapshot of the database plus a copy of new uploads into DATA_DIR/backups.
// In Docker:  docker compose exec app npm run backup
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const keep = Number(process.env.BACKUP_KEEP) || 14;
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const dir = path.join(dataDir, 'backups');
fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });

const target = path.join(dir, `registry-${stamp}.db`);
const db = new DatabaseSync(path.join(dataDir, 'registry.db'));
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();

// Uploaded files never change, so copying new ones is enough.
let copied = 0;
for (const f of fs.readdirSync(path.join(dataDir, 'uploads'))) {
  const dest = path.join(dir, 'uploads', f);
  if (!fs.existsSync(dest)) { fs.copyFileSync(path.join(dataDir, 'uploads', f), dest); copied++; }
}

const snaps = fs.readdirSync(dir).filter((f) => /^registry-.*\.db$/.test(f)).sort();
for (const old of snaps.slice(0, Math.max(0, snaps.length - keep))) fs.rmSync(path.join(dir, old));
console.log(`Backup written: ${target} (+${copied} new uploads, keeping last ${keep} snapshots)`);
