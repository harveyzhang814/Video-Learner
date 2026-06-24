'use strict';
const os = require('os');
const path = require('path');

const USER_CONFIG_DIR   = path.join(os.homedir(), '.config', 'vdl');
const USER_CONFIG_PATH  = path.join(USER_CONFIG_DIR, 'settings.conf');
const DEFAULT_WORK_ROOT = path.join(os.homedir(), 'vdl-work');

module.exports = { USER_CONFIG_DIR, USER_CONFIG_PATH, DEFAULT_WORK_ROOT };
