'use strict';

const path = require('path');
const fs = require('fs');
const DatabaseManager = require('../../electron/src/db');

function getDbPath(rootDir) {
  return path.join(rootDir, 'work', 'database.sqlite');
}

function createDb(rootDir) {
  const dbPath = getDbPath(rootDir);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return new DatabaseManager(dbPath);
}

module.exports = { createDb, getDbPath };
