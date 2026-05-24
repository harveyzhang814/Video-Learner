#!/usr/bin/env node
'use strict';

const args = process.argv.slice(2);
const sub = args[0];

const commands = {
  status: () => require('./commands/status').run(args.slice(1)),
  result: () => require('./commands/result').run(args.slice(1)),
  rerun:  () => require('./commands/rerun').run(args.slice(1)),
  list:   () => require('./commands/list').run(args.slice(1)),
  gui:    () => require('./commands/gui').run(),
};

function printUsage() {
  process.stdout.write(`
Usage:
  vdl <url> [--focus <text>] [--mode transcript|media|audio|full]
            [--lang zh-CN|en] [--force] [--json]
            [--long] [--ultra-long] [--timeout-scale <n>]

  --long            超长任务模式：所有步骤超时 ×3（适合 1-3 小时视频）
  --ultra-long      超超长任务模式：所有步骤超时 ×6（适合 4+ 小时视频）
  --timeout-scale   自定义倍率，如 --timeout-scale 4

  vdl status <task_id>
  vdl result <task_id> [--type summary|article]
  vdl rerun  <task_id> <step> [--reset downstream|step|off]
  vdl list
  vdl gui
\n`);
}

if (!sub || sub === '--help' || sub === '-h') {
  printUsage();
  process.exit(0);
}

if (commands[sub]) {
  commands[sub]().catch(err => {
    require('./lib/format').printError(err.message);
    process.exit(1);
  });
} else if (sub.startsWith('http') || sub.startsWith('-')) {
  // Route to run: either URL is first arg, or flags precede the URL
  require('./commands/run').run(args).catch(err => {
    require('./lib/format').printError(err.message);
    process.exit(1);
  });
} else {
  process.stderr.write(`Unknown command: ${sub}\n`);
  printUsage();
  process.exit(1);
}
