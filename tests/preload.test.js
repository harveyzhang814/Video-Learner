const assert = require('assert');
const { registerPreloadApis } = require('../electron/src/preload-helpers');

async function run() {
  const exposed = {};
  const fakeContextBridge = {
    exposeInMainWorld(name, api) {
      exposed[name] = api;
    },
  };
  const fakePayload = { baseUrl: 'http://127.0.0.1:12345', token: 'test-token' };
  const fakeIpcRenderer = {
    invoke: async (channel) => {
      if (channel === 'service:getInfo') return fakePayload;
      throw new Error('not implemented in test');
    },
  };

  registerPreloadApis({ contextBridge: fakeContextBridge, ipcRenderer: fakeIpcRenderer });

  // P1: only service.getServiceInfo exposed, no old IPC
  assert.ok(exposed.service);
  assert.strictEqual(typeof exposed.service.getServiceInfo, 'function');
  assert.strictEqual(exposed.api, undefined);
  assert.strictEqual(typeof exposed.runPipeline, 'undefined');
  console.log('P1: ok');

  // P2: getServiceInfo returns Promise with { baseUrl, token }
  const result = await exposed.service.getServiceInfo();
  assert.ok(result && typeof result === 'object');
  assert.strictEqual(typeof result.baseUrl, 'string');
  assert.strictEqual(typeof result.token, 'string');
  assert.ok(result.baseUrl.length > 0);
  assert.ok(result.token.length > 0);
  assert.strictEqual(result.baseUrl, fakePayload.baseUrl);
  assert.strictEqual(result.token, fakePayload.token);
  console.log('P2: ok');

  console.log('preload.test.js: all passed');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
