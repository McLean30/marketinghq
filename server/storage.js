// Durable local storage for the shared workspace: plain files under HQ_DATA_DIR (default ./data).
// Writes are atomic (temp file + fsync + rename), so a crash or restart never leaves half-written JSON.
//
// Nothing here touches the filesystem when the module is loaded. The data folder is resolved and created on
// first use, which only happens in shared mode (owner password configured). That keeps a browser-only demo
// deployment, such as a Vercel preview with a read-only filesystem and no settings, from crashing at start-up.
const fs = require('fs');
const path = require('path');

/**
 * The app folder (the one holding public/index.html). Found by looking, not by assuming this file's location,
 * because bundlers may flatten files into one (shared __dirname) or not provide __dirname at all. Read-only.
 */
function findAppDir() {
  const starts = [typeof __dirname === 'string' ? __dirname : null, process.cwd()].filter(Boolean);
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 4; i++) {
      if (fs.existsSync(path.join(dir, 'public', 'index.html'))) return dir;
      dir = path.dirname(dir);
    }
  }
  return process.cwd();
}
const APP_DIR = findAppDir();

const dataDir = () => path.resolve(process.env.HQ_DATA_DIR || path.join(APP_DIR, 'data'));

let dirs = null;
/** Resolve and create the data folders (shared mode only). */
function paths() {
  if (!dirs) {
    const DATA_DIR = dataDir();
    const ASSET_DIR = path.join(DATA_DIR, 'assets');
    fs.mkdirSync(ASSET_DIR, { recursive: true });
    dirs = { DATA_DIR, ASSET_DIR };
  }
  return dirs;
}

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

module.exports = { APP_DIR, dataDir, paths, writeAtomic, readJson };
