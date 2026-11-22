// Durable local storage for the shared workspace: plain files under HQ_DATA_DIR (default ./data).
// Writes are atomic (temp file + fsync + rename), so a crash or restart never leaves half-written JSON.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(process.env.HQ_DATA_DIR || path.join(__dirname, '..', 'data'));
const ASSET_DIR = path.join(DATA_DIR, 'assets');
fs.mkdirSync(ASSET_DIR, { recursive: true });

function writeAtomic(file, data) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error(`Could not read ${path.basename(file)}: ${e.message}. Restore it from a backup or remove it to start empty.`);
  }
}

module.exports = { DATA_DIR, ASSET_DIR, writeAtomic, readJson };
