'use strict';
const path = require('path');
const fmt = require('../lib/format');

const DB_PATH = path.resolve(__dirname, '../../work/database.sqlite');

async function run(_args) {
  let Database;
  try { Database = require('better-sqlite3'); }
  catch { fmt.printError('better-sqlite3 not installed. Run: npm install'); process.exit(1); }

  let db;
  try {
    db = new Database(DB_PATH, { readonly: true });
  } catch (err) {
    if (err.code === 'SQLITE_CANTOPEN' || err.message.includes('cannot open')) {
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
