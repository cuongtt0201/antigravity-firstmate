// firstmate: where task workspaces live. Shared by fm.js and the guard.
// New workspaces live outside the repo, at <FM_WT_ROOT>/<repo-key>/<task>, so the IDE does not index every
// file twice; a v0.12 workspace inside the repo (<repo>/.firstmate/wt/<task>) is still found.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fmHome = () => process.env.FM_HOME || path.join(os.homedir(), '.firstmate');
const wtRoot = () => process.env.FM_WT_ROOT || path.join(fmHome(), 'wt');

function realpath(p) { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } }

// <folder name>-<first 8 hex of sha1 of the repo's real path>: readable, and unique per checkout
function repoKey(repo) {
  const name = path.basename(path.resolve(repo)).replace(/[^A-Za-z0-9._-]+/g, '_') || 'repo';
  return `${name}-${crypto.createHash('sha1').update(realpath(repo)).digest('hex').slice(0, 8)}`;
}

const legacyTaskDir = (repo, task) => path.join(repo, '.firstmate', 'wt', task);

function taskDir(repo, task) {
  const legacy = legacyTaskDir(repo, task);
  return fs.existsSync(legacy) ? legacy : path.join(wtRoot(), repoKey(repo), task);
}

const notesDir = (repo) => path.join(repo, '.firstmate', 'notes');

// The task workspace that contains dir, as { repo, task, root }, or null when dir is not inside one. A workspace is
// a git worktree: its .git is a file pointing at <repo>/.git/worktrees/<name>.
function repoOfWorkspace(dir) {
  let d = path.resolve(String(dir || ''));
  for (;;) {
    const g = path.join(d, '.git');
    let st = null;
    try { st = fs.statSync(g); } catch {}
    if (st && st.isDirectory()) return null; // a main checkout
    if (st && st.isFile()) {
      const m = fs.readFileSync(g, 'utf8').match(/^gitdir:\s*(.+)$/m);
      if (!m) return null;
      const gitdir = path.resolve(d, m[1].trim());
      const common = path.dirname(path.dirname(gitdir)); // <repo>/.git
      return { repo: path.dirname(common), task: path.basename(d), root: d };
    }
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

module.exports = { fmHome, wtRoot, repoKey, taskDir, legacyTaskDir, notesDir, repoOfWorkspace };
