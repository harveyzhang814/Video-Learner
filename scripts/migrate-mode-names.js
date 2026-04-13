'use strict';

/**
 * Idempotent migration: rename legacy mode values 'both' and 'video' → 'media'.
 * Safe to run multiple times.
 *
 * Usage:
 *   node scripts/migrate-mode-names.js [rootDir]
 *   (rootDir defaults to <project-root>/work)
 */

const path = require('path');
const Database = require('better-sqlite3');

function migrateModeName(rootDir) {
  const dbPath = path.join(rootDir, 'database.sqlite');
  // Return silently if DB doesn't exist yet (fresh install).
  const fs = require('fs');
  if (!fs.existsSync(dbPath)) return 0;

  const db = new Database(dbPath);
  const result = db
    .prepare("UPDATE tasks SET mode = 'media' WHERE mode IN ('both', 'video')")
    .run();
  db.close();
  return result.changes;
}

module.exports = { migrateModeName };

if (require.main === module) {
  const rootDir = process.argv[2] || path.join(__dirname, '..', 'work');
  const n = migrateModeName(rootDir);
  console.log(`migrate-mode-names: updated ${n} task(s).`);
}
