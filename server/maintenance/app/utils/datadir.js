const fs = require('fs');
const path = require('path');

function resolveDataDir() {
  try {
    fs.mkdirSync('/data', { recursive: true });
    fs.accessSync('/data', fs.constants.W_OK);
    return '/data';
  } catch {
    const fallback = path.join(__dirname, '..', '.local_data');
    fs.mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

const DATA_DIR = resolveDataDir();
module.exports = DATA_DIR;
