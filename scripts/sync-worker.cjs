// Copies the shared publishing rules into the Edge Function folder (Supabase deploys only files inside it).
// `npm run worker:sync` writes the copies; `--check` fails if any copy differs (run by the tests).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = ['publishing.js', 'review.js', 'profile.js', 'voice.js'];
const DEST = path.join(ROOT, 'supabase', 'functions', 'hq-scheduler', 'shared');
const check = process.argv.includes('--check');
let stale = [];
fs.mkdirSync(DEST, { recursive: true });
for (const f of FILES) {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'js', f), 'utf8');
  const out = path.join(DEST, f);
  const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
  if (cur === src) continue;
  if (check) stale.push(f);
  else fs.writeFileSync(out, src);
}
if (check && stale.length) {
  console.error(`The worker's copies are out of date: ${stale.join(', ')}. Run npm run worker:sync.`);
  process.exit(1);
}
console.log(check ? 'Worker copies match public/js.' : `Worker copies written to ${path.relative(ROOT, DEST)}.`);
