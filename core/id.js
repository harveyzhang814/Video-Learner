'use strict';

const crypto = require('crypto');

/**
 * Generate stable task id from URL. Must match Electron orchestrator (url + '\n').
 * @param {string} url - Video URL
 * @returns {string} 12-char hex id
 */
function generateId(url) {
  return crypto.createHash('sha1').update(url + '\n').digest('hex').slice(0, 12);
}

module.exports = { generateId };
