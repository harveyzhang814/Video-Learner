'use strict';
const path = require('path');
const fmt = require('../lib/format');
const { getDbPath } = require('../../core/paths');

async function run(_args) {
  let Database;
  try { Database = require('better-sqlite3'); }
  catch { fmt.printError('better-sqlite3 not installed. Run: npm install'); process.exit(1); }

  const DB_PATH = getDbPath(path.resolve(__dirname, '../..'));
  let db;
  try {
    db = new Database(DB_PATH, { readonly: true });
  } catch (err) {
    const msg = err.message || '';
    if (err.code === 'SQLITE_CANTOPEN' || msg.toLowerCase().includes('cannot open') || msg.includes('directory does not exist')) {
      process.stdout.write('No tasks found.\n');
      return;
    }
    fmt.printError(`Cannot open database: ${err.message}`);
    process.exit(1);
  }

  const rows = db.prepare(
    `SELECT id, url, title, created_at FROM tasks ORDER BY created_at DESC LIMIT 20`
  ).all();
  db.close();

  if (!rows.length) {
    process.stdout.write('No tasks found.\n');
    return;
  }

  process.stdout.write(`${'ID'.padEnd(14)} ${'CREATED'.padEnd(20)} TITLE\n`);
  process.stdout.write(`${'-'.repeat(14)} ${'-'.repeat(20)} ${'-'.repeat(30)}\n`);
  for (const r of rows) {
    const title = (r.title || r.url || '').slice(0, 50);
    const created = r.created_at ? String(r.created_at).slice(0, 19) : '';
    process.stdout.write(`${r.id.padEnd(14)} ${created.padEnd(20)} ${title}\n`);
  }
}

module.exports = { run };
