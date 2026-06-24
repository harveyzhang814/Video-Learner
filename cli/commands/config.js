'use strict';

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { writeWorkRoot, resolveWorkBase, getWorkRoot } = require('../../core/paths');
const { USER_CONFIG_PATH, DEFAULT_WORK_ROOT } = require('../../core/user-config');

const ROOT_DIR = path.resolve(__dirname, '../..');
const SETTINGS_PATH = process.env.VDL_CONFIG_FILE || USER_CONFIG_PATH;

function expandHome(p) {
  if (p === '~') return process.env.HOME || p;
  if (p.startsWith('~/')) return path.join(process.env.HOME || '', p.slice(2));
  return p;
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

function countTaskDirs(workDir) {
  try {
    return fs.readdirSync(workDir).filter(name => {
      try { return fs.statSync(path.join(workDir, name)).isDirectory() && /^[0-9a-f]{12}$/.test(name); }
      catch (_) { return false; }
    }).length;
  } catch (_) { return 0; }
}

function openDb(dbPath, readonly) {
  const Database = require('better-sqlite3');
  if (!readonly) fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  return new Database(dbPath, readonly ? { readonly: true } : {});
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, url TEXT NOT NULL, ts TEXT, title TEXT, lang TEXT,
      duration TEXT, output_lang TEXT DEFAULT 'zh-CN', focus TEXT, uploader TEXT,
      transcripts TEXT DEFAULT '{}', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT,
      mode TEXT DEFAULT 'both', status TEXT, timeout_scale REAL DEFAULT 1,
      width INTEGER, height INTEGER, file_size INTEGER, bit_rate INTEGER,
      upload_date TEXT
    );
    CREATE TABLE IF NOT EXISTS steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
      step_name TEXT NOT NULL, status TEXT DEFAULT 'pending', attempts INTEGER DEFAULT 0,
      error TEXT, started_at TEXT, completed_at TEXT,
      FOREIGN KEY (task_id) REFERENCES tasks(id), UNIQUE(task_id, step_name)
    );
  `);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function migrateWorkDir(oldWorkDir, newWorkDir) {
  // New dir "has data" if it has a DB or any task dirs
  const newHasData = fs.existsSync(path.join(newWorkDir, 'database.sqlite')) ||
                     countTaskDirs(newWorkDir) > 0;

  if (!newHasData) {
    // Simple copy
    process.stdout.write(`复制 ${oldWorkDir} → ${newWorkDir} ...\n`);
    copyDir(oldWorkDir, newWorkDir);
    process.stdout.write(`复制完成。\n`);
    return;
  }

  // Both sides have data: merge
  process.stdout.write(`新路径已有数据，开始合并...\n`);

  const oldDbPath = path.join(oldWorkDir, 'database.sqlite');
  const newDbPath = path.join(newWorkDir, 'database.sqlite');

  let oldDb, newDb;
  try { oldDb = openDb(oldDbPath, true); }
  catch (e) { process.stderr.write(`无法打开旧数据库: ${e.message}\n`); process.exit(1); }
  try { newDb = openDb(newDbPath, false); initSchema(newDb); }
  catch (e) { process.stderr.write(`无法打开新数据库: ${e.message}\n`); process.exit(1); }

  const oldTasks   = oldDb.prepare('SELECT * FROM tasks').all();
  const newTaskIds = new Set(newDb.prepare('SELECT id FROM tasks').all().map(r => r.id));
  const newUrls    = new Set(newDb.prepare('SELECT url FROM tasks').all().map(r => r.url));

  const insertTask = newDb.prepare(`
    INSERT OR IGNORE INTO tasks
      (id, url, ts, title, lang, duration, output_lang, focus, uploader,
       transcripts, created_at, updated_at, deleted_at, mode, status,
       timeout_scale, width, height, file_size, bit_rate, upload_date)
    VALUES
      (@id, @url, @ts, @title, @lang, @duration, @output_lang, @focus, @uploader,
       @transcripts, @created_at, @updated_at, @deleted_at, @mode, @status,
       @timeout_scale, @width, @height, @file_size, @bit_rate, @upload_date)
  `);
  const insertStep = newDb.prepare(`
    INSERT OR IGNORE INTO steps
      (task_id, step_name, status, attempts, error, started_at, completed_at)
    VALUES (@task_id, @step_name, @status, @attempts, @error, @started_at, @completed_at)
  `);

  const skippedIds = new Set();
  let merged = 0, skipped = 0;

  newDb.transaction(() => {
    for (const task of oldTasks) {
      if (newTaskIds.has(task.id) || newUrls.has(task.url)) {
        skippedIds.add(task.id);
        skipped++;
        continue;
      }
      insertTask.run(task);
      for (const step of oldDb.prepare('SELECT * FROM steps WHERE task_id = ?').all(task.id)) {
        insertStep.run(step);
      }
      merged++;
    }
  })();

  oldDb.close();
  newDb.close();

  // Copy task directories for non-skipped tasks
  let filesCopied = 0;
  for (const task of oldTasks) {
    if (skippedIds.has(task.id)) continue;
    const src = path.join(oldWorkDir, task.id);
    if (!fs.existsSync(src)) continue;
    copyDir(src, path.join(newWorkDir, task.id));
    filesCopied++;
  }

  // Append non-skipped entries from index.jsonl
  const oldIndex = path.join(oldWorkDir, 'index.jsonl');
  if (fs.existsSync(oldIndex)) {
    const toAppend = fs.readFileSync(oldIndex, 'utf8').split('\n').filter(l => {
      if (!l.trim()) return false;
      try { return !skippedIds.has(JSON.parse(l).id); } catch (_) { return false; }
    });
    if (toAppend.length) {
      fs.appendFileSync(path.join(newWorkDir, 'index.jsonl'), toAppend.join('\n') + '\n', 'utf8');
    }
  }

  process.stdout.write(
    `合并完成：导入 ${merged} 个任务，跳过 ${skipped} 个重复，复制 ${filesCopied} 个目录。\n`
  );
}

async function run(args) {
  const [action, key, value] = args;

  if (action === 'get') {
    const workRoot = resolveWorkBase(ROOT_DIR);
    const isDefault = workRoot === DEFAULT_WORK_ROOT;
    process.stdout.write(`workRoot: ${isDefault ? '(default — ~/vdl-work)' : workRoot}\n`);
    process.stdout.write(`workDir:  ${getWorkRoot(ROOT_DIR)}\n`);
    process.stdout.write(`config:   ${SETTINGS_PATH}\n`);
    return;
  }

  if (action === 'set') {
    if (key !== 'work-root') {
      process.stderr.write(`Unknown config key: ${key}\nSupported keys: work-root\n`);
      process.exit(1);
    }
    if (!value) {
      process.stderr.write('Usage: vdl config set work-root <path>\n');
      process.exit(1);
    }
    if (!value.startsWith('/') && !value.startsWith('~')) {
      process.stderr.write('Error: work-root must be an absolute path or start with ~\n');
      process.exit(1);
    }

    const newWorkRoot = path.resolve(expandHome(value));
    const newWorkDir  = path.join(newWorkRoot, 'work');
    const oldWorkDir  = getWorkRoot(ROOT_DIR);

    if (path.resolve(oldWorkDir) === path.resolve(newWorkDir)) {
      process.stdout.write(`work-root 已经是该路径，无需变更。\n`);
      return;
    }

    const oldTaskCount = countTaskDirs(oldWorkDir);
    if (oldTaskCount > 0) {
      const ans = await prompt(
        `当前 work 目录有 ${oldTaskCount} 个任务（${oldWorkDir}），是否迁移到新路径？[y/N] `
      );
      if (ans.toLowerCase() === 'y') {
        await migrateWorkDir(oldWorkDir, newWorkDir);
      } else {
        process.stdout.write(`旧数据保留在 ${oldWorkDir}。\n`);
      }
    }

    writeWorkRoot(SETTINGS_PATH, value);
    process.stdout.write(`work-root 已设置为: ${value}\n`);
    process.stdout.write(`配置已写入: ${SETTINGS_PATH}\n`);
    process.stdout.write(`重启后端后生效。\n`);
    return;
  }

  process.stderr.write('Usage:\n  vdl config get\n  vdl config set work-root <path>\n');
  process.exit(1);
}

module.exports = { run };
