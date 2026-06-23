'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const readline = require('readline');
const paths = require('../core/paths');

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vl-migrate-'));
}

function makeDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, url TEXT NOT NULL, ts TEXT, title TEXT, lang TEXT,
      duration TEXT, output_lang TEXT DEFAULT 'zh-CN', focus TEXT, uploader TEXT,
      transcripts TEXT DEFAULT '{}', created_at TEXT, updated_at TEXT, deleted_at TEXT,
      mode TEXT DEFAULT 'both', status TEXT, timeout_scale REAL DEFAULT 1,
      width INTEGER, height INTEGER, file_size INTEGER, bit_rate INTEGER, upload_date TEXT
    );
    CREATE TABLE IF NOT EXISTS steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT, step_name TEXT,
      status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0,
      error TEXT, started_at TEXT, completed_at TEXT
    );
  `);
  return db;
}

function addTask(db, id, url, title = '') {
  db.prepare('INSERT INTO tasks (id,url,title) VALUES (?,?,?)').run(id, url, title);
}

function addStep(db, taskId, stepName, status = 'completed') {
  db.prepare('INSERT INTO steps (task_id,step_name,status,attempts) VALUES (?,?,?,1)')
    .run(taskId, stepName, status);
}

function makeTaskDir(workDir, taskId, content = 'file') {
  const dir = path.join(workDir, taskId, 'transcript');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'original.md'), content);
}

// Stub readline so prompt answers 'y' automatically
function stubPromptYes() {
  const orig = readline.createInterface;
  readline.createInterface = () => ({ question: (_, cb) => cb('y'), close: () => {} });
  return () => { readline.createInterface = orig; };
}

// Run config.run(['set','work-root',value]) with WORK_ROOT env stubbed to oldBase
async function runSetWorkRoot(oldBase, newValue) {
  const savedEnv = process.env.WORK_ROOT;
  process.env.WORK_ROOT = oldBase;
  // Stub writeWorkRoot so it doesn't write to the real settings.conf
  const origWrite = paths.writeWorkRoot;
  paths.writeWorkRoot = () => {};
  try {
    // Clear require cache so config.js picks up fresh env
    delete require.cache[require.resolve('../cli/commands/config')];
    const config = require('../cli/commands/config');
    await config.run(['set', 'work-root', newValue]);
  } finally {
    paths.writeWorkRoot = origWrite;
    if (savedEnv === undefined) delete process.env.WORK_ROOT;
    else process.env.WORK_ROOT = savedEnv;
    delete require.cache[require.resolve('../cli/commands/config')];
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

let failures = 0;
function check(name, fn) {
  return Promise.resolve().then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch(e => { failures++; console.error(`  ✗ ${name}: ${e.message}`); });
}

async function run() {

  // 1. Old work dir empty → no prompt, straight copy skipped (no files to copy)
  await check('no old files → writes config, no migration', async () => {
    const tmp = makeTmp();
    const oldBase = path.join(tmp, 'old');
    const newBase = path.join(tmp, 'new');
    fs.mkdirSync(path.join(oldBase, 'work'), { recursive: true });
    await runSetWorkRoot(oldBase, newBase);
    // New work dir should NOT be created (no copy triggered)
    assert.ok(!fs.existsSync(path.join(newBase, 'work', 'database.sqlite')),
      'no DB should be created when old dir is empty');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // 2. Old has tasks, user says N → no copy
  await check('user declines migration → no files copied', async () => {
    const tmp = makeTmp();
    const oldBase = path.join(tmp, 'old');
    const newBase = path.join(tmp, 'new');
    const oldWork = path.join(oldBase, 'work');
    const db = makeDb(path.join(oldWork, 'database.sqlite'));
    addTask(db, 'aaaaaaaaaaaa', 'https://url-A', 'Task A');
    db.close();
    makeTaskDir(oldWork, 'aaaaaaaaaaaa');

    const orig = readline.createInterface;
    readline.createInterface = () => ({ question: (_, cb) => cb('n'), close: () => {} });
    await runSetWorkRoot(oldBase, newBase);
    readline.createInterface = orig;

    assert.ok(!fs.existsSync(path.join(newBase, 'work', 'aaaaaaaaaaaa')),
      'task dir should not be copied when user declines');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // 3. Old has tasks, new is empty → simple copy
  await check('new dir empty → full copy', async () => {
    const tmp = makeTmp();
    const oldBase = path.join(tmp, 'old');
    const newBase = path.join(tmp, 'new');
    const oldWork = path.join(oldBase, 'work');
    const db = makeDb(path.join(oldWork, 'database.sqlite'));
    addTask(db, 'aaaaaaaaaaaa', 'https://url-A', 'Task A');
    addStep(db, 'aaaaaaaaaaaa', 'fetch');
    db.close();
    makeTaskDir(oldWork, 'aaaaaaaaaaaa', '# A content');

    const restore = stubPromptYes();
    await runSetWorkRoot(oldBase, newBase);
    restore();

    const newWork = path.join(newBase, 'work');
    assert.ok(fs.existsSync(path.join(newWork, 'database.sqlite')), 'DB should be copied');
    assert.ok(fs.existsSync(path.join(newWork, 'aaaaaaaaaaaa', 'transcript', 'original.md')),
      'task dir should be copied');
    const content = fs.readFileSync(path.join(newWork,'aaaaaaaaaaaa','transcript','original.md'),'utf8');
    assert.strictEqual(content, '# A content');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // 4.
  await check('merge: task A dir NOT copied when duplicate, task B dir copied', async () => {
    const tmp = makeTmp();
    const oldBase = path.join(tmp, 'old');
    const newBase = path.join(tmp, 'new');
    const oldWork = path.join(oldBase, 'work');
    const newWork = path.join(newBase, 'work');

    const oldDb = makeDb(path.join(oldWork, 'database.sqlite'));
    addTask(oldDb, 'aaaaaaaaaaaa', 'https://url-A', 'Task A old');
    addTask(oldDb, 'bbbbbbbbbbbb', 'https://url-B', 'Task B');
    oldDb.close();
    makeTaskDir(oldWork, 'aaaaaaaaaaaa', '# A old');
    makeTaskDir(oldWork, 'bbbbbbbbbbbb', '# B content');

    const newDb = makeDb(path.join(newWork, 'database.sqlite'));
    addTask(newDb, 'aaaaaaaaaaaa', 'https://url-A', 'Task A new');
    newDb.close();
    // No aaaaaaaaaaaa dir in new work (only DB entry)

    const restore = stubPromptYes();
    await runSetWorkRoot(oldBase, newBase);
    restore();

    // Task B: should be in new work dir
    assert.ok(
      fs.existsSync(path.join(newWork, 'bbbbbbbbbbbb', 'transcript', 'original.md')),
      'Task B dir should be copied'
    );
    const bContent = fs.readFileSync(
      path.join(newWork, 'bbbbbbbbbbbb', 'transcript', 'original.md'), 'utf8'
    );
    assert.strictEqual(bContent, '# B content', 'Task B content intact');

    // Task A: old dir should NOT be copied to new (duplicate → skipped)
    // Since there was no aaaaaaaaaaaa dir in new before migration,
    // if migration skips it, there should be no dir
    assert.ok(
      !fs.existsSync(path.join(newWork, 'aaaaaaaaaaaa', 'transcript', 'original.md')),
      'Task A old dir should NOT be copied (duplicate)'
    );

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // 5. Same path → no-op
  await check('same path → no-op message', async () => {
    const tmp = makeTmp();
    const base = path.join(tmp, 'base');
    const out = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s) => { out.push(s); return true; };
    await runSetWorkRoot(base, base);
    process.stdout.write = origWrite;
    assert.ok(out.some(s => s.includes('无需变更')), `expected no-op message, got: ${out.join('')}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  if (failures > 0) {
    console.error(`cli-config-migrate.test.js: FAIL (${failures})`);
    process.exit(1);
  }
  console.log('cli-config-migrate.test.js: PASS');
}

run().catch(e => { console.error(e); process.exit(1); });
