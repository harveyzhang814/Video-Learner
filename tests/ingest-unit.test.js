'use strict';
const assert = require('assert');
const { isLocalPath, detectFileType } = require('../cli/lib/ingest');

// isLocalPath
assert.strictEqual(isLocalPath('/abs/path.mp3'), true,  'absolute path');
assert.strictEqual(isLocalPath('./rel/path.mp3'), true,  'relative ./');
assert.strictEqual(isLocalPath('../up/path.mp3'), true,  'relative ../');
assert.strictEqual(isLocalPath('https://youtube.com'), false, 'url');
assert.strictEqual(isLocalPath('rerun'), false, 'subcommand');
assert.strictEqual(isLocalPath('--focus'),  false, 'flag');

// detectFileType — audio
for (const ext of ['mp3','m4a','wav','aac','flac','ogg','opus']) {
  assert.strictEqual(detectFileType(`/f.${ext}`), 'audio', ext);
  assert.strictEqual(detectFileType(`/f.${ext.toUpperCase()}`), 'audio', `${ext} uppercase`);
}

// detectFileType — video
for (const ext of ['mp4','mkv','mov','avi','webm','ts','m4v']) {
  assert.strictEqual(detectFileType(`/f.${ext}`), 'video', ext);
}

// detectFileType — unknown
assert.strictEqual(detectFileType('/f.txt'),  null, 'txt');
assert.strictEqual(detectFileType('/f.pdf'),  null, 'pdf');
assert.strictEqual(detectFileType('/f'),      null, 'no ext');

console.log('ingest-unit: all assertions passed');
