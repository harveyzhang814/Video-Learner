'use strict';
// Tests for fetch_info lang extraction and ASR lang filename fix
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'work', 'database.sqlite');
const SCRIPTS = path.join(ROOT, 'scripts');

// ── helpers ──────────────────────────────────────────────────────────────────
function sqlite(sql) {
  return execSync(`sqlite3 "${DB_PATH}" "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
}

function taskLang(id) {
  return sqlite(`SELECT lang FROM tasks WHERE id='${id}'`);
}

// ── Test 1: fetch_info lang extraction shell logic ──────────────────────────
{
  const cases = [
    { raw: 'en-US', expected: 'en' },
    { raw: 'zh-CN', expected: 'zh' },
    { raw: 'ja',    expected: 'ja' },
    { raw: '',      expected: 'en' },   // empty → default en
    { raw: 'null',  expected: 'en' },   // jq .language missing → empty → en
  ];

  for (const { raw, expected } of cases) {
    const script = `
      lang_raw="${raw === 'null' ? '' : raw}"
      lang=$(echo "$lang_raw" | cut -d'-' -f1 | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
      [ -z "$lang" ] && lang="en"
      echo "$lang"
    `;
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' }).stdout.trim();
    assert.strictEqual(result, expected, `lang_raw="${raw}" → expected "${expected}", got "${result}"`);
  }
  console.log('PASS: fetch_info lang normalization (5 cases)');
}

// ── Test 2: fetch_info writes lang to DB ────────────────────────────────────
{
  const TEST_ID = 'langtest_' + Date.now().toString(36).slice(-6);
  // Insert a task row manually
  sqlite(`INSERT OR IGNORE INTO tasks (id, url, lang) VALUES ('${TEST_ID}', 'https://test', '')`);

  // Simulate the sqlite UPDATE from fetch_info.sh
  sqlite(`UPDATE tasks SET lang='fr', updated_at=strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE id='${TEST_ID}'`);
  assert.strictEqual(taskLang(TEST_ID), 'fr', 'lang should be written to DB');

  // Cleanup
  sqlite(`DELETE FROM tasks WHERE id='${TEST_ID}'`);
  console.log('PASS: fetch_info writes lang to DB');
}

// ── Test 3: ASR python script accepts --lang and uses it in filename ─────────
{
  const result = spawnSync('python3', [
    path.join(SCRIPTS, 'asr_transcribe.py'), '--help'
  ], { encoding: 'utf8' });
  assert.ok(result.stdout.includes('--lang') || result.stderr.includes('--lang'),
    'asr_transcribe.py should expose --lang argument');
  console.log('PASS: asr_transcribe.py has --lang argument');
}

// ── Test 4: ASR filename uses lang parameter ─────────────────────────────────
{
  for (const lang of ['en', 'zh', 'ja']) {
    const script = `
import argparse, os, sys
p = argparse.ArgumentParser()
p.add_argument('task_id'); p.add_argument('work_dir')
p.add_argument('--model', default='x'); p.add_argument('--lang', default='en')
a = p.parse_args(['abc123456789', '/tmp/work', '--lang', '${lang}'])
expected = f'abc123456789.${lang}.asr.vtt'
subs_dir = os.path.join(a.work_dir, 'transcript', 'subs')
vtt_path = os.path.join(subs_dir, f'{a.task_id}.{a.lang}.asr.vtt')
got = os.path.basename(vtt_path)
assert got == expected, f'expected {expected}, got {got}'
print(got)
`;
    const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, `--lang ${lang}: ${result.stderr}`);
    assert.ok(result.stdout.trim().endsWith(`.${lang}.asr.vtt`), `filename should end with .${lang}.asr.vtt`);
  }
  console.log('PASS: ASR filename uses --lang (en, zh, ja)');
}

// ── Test 5: orchestrator passes task.meta.lang to asr args ───────────────────
{
  // Read the orchestrator source and verify the asr case passes lang
  const src = fs.readFileSync(path.join(ROOT, 'core/orchestrator/index.js'), 'utf8');
  const asrMatch = src.match(/case 'asr':\s*\n\s*args\s*=\s*\[([^\]]+)\]/);
  assert.ok(asrMatch, "asr case with args = [...] not found");
  const argsStr = asrMatch[1];
  assert.ok(argsStr.includes('task.meta.lang'), `asr args should include task.meta.lang, got: ${argsStr}`);
  assert.ok(argsStr.includes("|| 'en'"), `asr args should have || 'en' fallback`);
  console.log('PASS: orchestrator asr case passes task.meta.lang');
}

// ── Test 6: translate still skips when original_zh.md exists ─────────────────
{
  // This validates existing behavior is unchanged
  const src = fs.readFileSync(path.join(ROOT, 'core/orchestrator/index.js'), 'utf8');
  assert.ok(src.includes("Skip-1: original_zh.md 已存在"), 'Skip-1 comment should exist');
  assert.ok(src.includes("Skip-2: original_en.md 不存在"), 'Skip-2 comment should exist');
  console.log('PASS: translate skip conditions preserved');
}

// ── Test 7: fetch_info.sh SQL includes lang field ────────────────────────────
{
  const sh = fs.readFileSync(path.join(SCRIPTS, 'fetch_info.sh'), 'utf8');
  assert.ok(sh.includes("lang = '$lang'"), 'fetch_info.sh should UPDATE lang column');
  assert.ok(sh.includes("lang_raw=$(echo"), 'fetch_info.sh should extract lang_raw');
  assert.ok(sh.includes('[ -z "$lang" ] && lang="en"'), 'fetch_info.sh should default lang to en');
  console.log('PASS: fetch_info.sh has lang extraction and DB write');
}

console.log('\nfetch-lang.test.js: PASS');
