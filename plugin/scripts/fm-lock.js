// firstmate: one fm.js command at a time per repo, so two chats (or parallel calls) never pick the same task
// name or slot. The lock is a directory, created atomically; a lock older than STALE_MS is taken over.

const fs = require('fs');
const path = require('path');

const WAIT_MS = 5000;
const STALE_MS = 60 * 1000;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function withLock(repo, fn) {
  const base = path.join(repo, '.firstmate');
  if (!fs.existsSync(base)) return fn(); // not initialised: nothing to share yet
  const lock = path.join(base, '.lock');
  const until = Date.now() + WAIT_MS;
  for (;;) {
    try { fs.mkdirSync(lock); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > STALE_MS) { fs.rmSync(lock, { recursive: true, force: true }); continue; } } catch {}
      if (Date.now() > until) throw new Error(`another firstmate command holds the lock on ${repo} (${lock}); try again`);
      sleep(50);
    }
  }
  try { return fn(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

module.exports = { withLock };
