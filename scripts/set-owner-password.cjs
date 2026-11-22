// Sets the owner password for the shared workspace. The password is typed (hidden) in your own terminal,
// hashed with scrypt, and only the hash is written to .env as HQ_OWNER_PASSWORD_HASH. Nothing is printed.
// Usage: npm run set-password
const fs = require('fs');
const path = require('path');
const { hashPassword } = require('../server/auth');

const ENV = path.join(__dirname, '..', '.env');

function ask(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    let value = '';
    if (!stdin.isTTY) {
      // Piped input (e.g. CI): read one line.
      stdin.once('data', (d) => resolve(String(d).split(/\r?\n/)[0]));
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (ch === '\u0003') {
        process.stdout.write('\n');
        process.exit(1);
      } else if (ch === '\u0008' || ch === '\u007f') {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

(async () => {
  const a = await ask('New owner password (min 12 characters, hidden): ');
  if (a.length < 12) { console.error('Too short. Use at least 12 characters.'); process.exit(1); }
  const b = await ask('Type it again: ');
  if (a !== b) { console.error('The two entries did not match. Nothing was changed.'); process.exit(1); }
  const line = `HQ_OWNER_PASSWORD_HASH=${hashPassword(a)}`;
  let env = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8') : '';
  env = /^HQ_OWNER_PASSWORD_HASH=.*$/m.test(env) ? env.replace(/^HQ_OWNER_PASSWORD_HASH=.*$/m, line) : `${env}${env && !env.endsWith('\n') ? '\n' : ''}${line}\n`;
  fs.writeFileSync(ENV, env);
  console.log('Saved the password hash to .env (gitignored). Restart the server with: npm run start:env');
})();
