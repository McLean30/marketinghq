// Preload (node -r) that makes the filesystem read-only, like a Vercel function's /var/task:
// any attempt to create, write or rename files throws EROFS. Reads still work.
const fs = require('fs');
const deny = (name) => function () {
  const e = new Error(`EROFS: read-only file system, ${name} '${arguments[0]}'`);
  e.code = 'EROFS';
  throw e;
};
for (const name of ['mkdirSync', 'writeFileSync', 'appendFileSync', 'renameSync', 'rmSync', 'unlinkSync', 'copyFileSync']) fs[name] = deny(name);
const openSync = fs.openSync;
fs.openSync = function (file, flags, ...rest) {
  if (flags && flags !== 'r' && flags !== fs.constants.O_RDONLY) return deny('openSync').call(this, file);
  return openSync.call(this, file, flags, ...rest);
};
