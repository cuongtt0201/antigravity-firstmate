// The core pack, for every developer: no pushes or publishing, no destroying the captain's uncommitted work,
// no secrets in commands or written files, a question before touching a production database, and no package
// installs over dependencies a task workspace borrows from the captain's checkout.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PROD_RE, words, sub } = require('./shell');
const { findSecret } = require('./secrets');

const GIT_FLAGS = new Set(['-C', '-c', '--git-dir', '--work-tree']);
const DB_CLIENTS = new Set(['psql', 'mysql', 'mongosh', 'mongo', 'redis-cli', 'pg_dump', 'pg_restore']);
const PKG = new Set(['npm', 'pnpm', 'yarn']);
const INSTALL = new Set(['install', 'i', 'add', 'ci']);

function judgeCommand(seg, ctx, { deny, ask }) {
  const w = words(seg);
  const p = w[0];
  if (!p) return null;
  if (p === 'git') {
    const { name, rest } = sub(w, GIT_FLAGS);
    if (name === 'push') return deny('pushes to the remote');
    // -C, --work-tree and --git-dir point git somewhere else: judge the place git will act on
    const targets = [];
    for (let i = 1; i < w.length; i++) {
      if ((w[i] === '-C' || w[i] === '--work-tree' || w[i] === '--git-dir') && w[i + 1]) targets.push(w[i + 1]);
      const m = w[i].match(/^--(work-tree|git-dir)=(.+)$/); if (m) targets.push(m[2]);
    }
    const inWorkspace = targets.length ? targets.every((d) => ctx.isWorkspace(path.resolve(ctx.cwd || '.', d))) : ctx.inWorkspace;
    if (inWorkspace) return null;
    if (name === 'reset' && rest.includes('--hard')) return deny("throws away the captain's uncommitted work");
    if (name === 'clean' && rest.some((x) => /^-[a-zA-Z]*f/.test(x) || x === '--force')) return deny("deletes the captain's untracked files");
    if ((name === 'checkout' || name === 'restore') && rest.includes('.') && !rest.includes('--staged')) return deny("throws away the captain's uncommitted work");
    if (name === 'branch' && rest.some((x) => x === '-D' || x === '--force')) return deny("deletes the captain's branch");
    if (name === 'stash' && ['drop', 'clear'].includes(rest[0])) return deny("drops the captain's stash");
    return null;
  }
  if (PKG.has(p) && (w[1] === 'publish' || (w[1] === 'npm' && w[2] === 'publish'))) return deny('publishes a package');
  if ((p === 'twine' && w[1] === 'upload') || (p === 'docker' && w[1] === 'push') || (p === 'gem' && w[1] === 'push') || (p === 'cargo' && w[1] === 'publish')) return deny('publishes a package or an image');
  if (DB_CLIENTS.has(p) && PROD_RE.test(w.slice(1).join(' '))) return ask('connects to what looks like a production database');
  if (PKG.has(p) && INSTALL.has(w[1]) && ctx.inWorkspace && ctx.cwd) {
    try { if (fs.lstatSync(path.join(ctx.cwd, 'node_modules')).isSymbolicLink()) return deny("installs packages into node_modules borrowed from the captain's checkout; a dependency change is a high-risk task for the captain"); } catch {}
  }
  return null;
}

// Secrets in a write: denied unless the file is the AWS CLI's own credentials store.
function judgeWrite(target, args, { deny }) {
  const what = findSecret(JSON.stringify(args));
  if (!what) return null;
  const aws = path.join(os.homedir(), '.aws') + path.sep;
  if (target && path.resolve(String(target)).startsWith(aws)) return null;
  return deny(`would write ${what} into ${target || 'a file'}`);
}

module.exports = { judgeCommand, judgeWrite, findSecret };
