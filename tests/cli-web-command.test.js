'use strict';
const assert = require('assert');
const path = require('path');
const Module = require('module');

// Stub agent-connect and child_process before requiring the command.
const stubs = {
  connectCalls: [],
  spawnCalls: [],
  exitCode: null,
};

const realResolve = Module._resolveFilename;
const realRequire = Module.prototype.require;

const agentConnectPath = require.resolve('../core/agent-connect');
const cpPath = 'child_process';

Module.prototype.require = function (id) {
  if (id === '../../core/agent-connect' || id === path.relative(path.join(__dirname, '../cli/commands'), agentConnectPath).replace(/\\/g, '/')) {
    return {
      connect: async (opts) => { stubs.connectCalls.push(opts); return { baseUrl: opts.baseUrl || 'http://127.0.0.1:3000', token: 't', heartbeatHandle: null }; },
    };
  }
  if (id === 'child_process') {
    const real = realRequire.call(this, id);
    return {
      ...real,
      spawn: (cmd, args, opts) => { stubs.spawnCalls.push({ cmd, args, opts }); return { unref() {}, on() {} }; },
    };
  }
  return realRequire.call(this, id);
};

// Capture process.exit
const realExit = process.exit;
process.exit = (code) => { stubs.exitCode = code; throw new Error(`__exit:${code}`); };

(async () => {
  // Need a clean cache for the command module
  delete require.cache[require.resolve('../cli/commands/web')];
  const { run } = require('../cli/commands/web');

  // Case 1: default — connects with noHeartbeat:true and opens browser
  stubs.connectCalls.length = 0;
  stubs.spawnCalls.length = 0;
  stubs.exitCode = null;
  try { await run([]); } catch (e) { if (!String(e.message).startsWith('__exit:')) throw e; }
  assert.strictEqual(stubs.connectCalls.length, 1, 'connect called once');
  assert.strictEqual(stubs.connectCalls[0].noHeartbeat, true, 'connect called with noHeartbeat:true');
  assert.strictEqual(stubs.spawnCalls.length, 1, 'spawn called once (browser open)');
  assert.ok(['open', 'xdg-open', 'cmd'].includes(stubs.spawnCalls[0].cmd), `unexpected opener: ${stubs.spawnCalls[0].cmd}`);
  const openArgs = stubs.spawnCalls[0].args.join(' ');
  assert.ok(openArgs.includes('http://127.0.0.1:3000'), `expected URL in args, got: ${openArgs}`);
  assert.strictEqual(stubs.exitCode, 0, 'process.exit(0)');

  // Case 2: --no-browser skips opener
  stubs.connectCalls.length = 0;
  stubs.spawnCalls.length = 0;
  stubs.exitCode = null;
  delete require.cache[require.resolve('../cli/commands/web')];
  const { run: run2 } = require('../cli/commands/web');
  try { await run2(['--no-browser']); } catch (e) { if (!String(e.message).startsWith('__exit:')) throw e; }
  assert.strictEqual(stubs.spawnCalls.length, 0, '--no-browser skips spawn');
  assert.strictEqual(stubs.exitCode, 0);

  // Case 3: --port overrides
  stubs.connectCalls.length = 0;
  stubs.spawnCalls.length = 0;
  stubs.exitCode = null;
  delete require.cache[require.resolve('../cli/commands/web')];
  const { run: run3 } = require('../cli/commands/web');
  try { await run3(['--port', '4000']); } catch (e) { if (!String(e.message).startsWith('__exit:')) throw e; }
  assert.strictEqual(stubs.connectCalls[0].baseUrl, 'http://127.0.0.1:4000', 'baseUrl reflects --port');
  assert.ok(stubs.spawnCalls[0].args.join(' ').includes('http://127.0.0.1:4000'));

  process.exit = realExit;
  console.log('cli-web-command: PASS');
})().catch(err => { process.exit = realExit; console.error(err); process.exit(1); });
