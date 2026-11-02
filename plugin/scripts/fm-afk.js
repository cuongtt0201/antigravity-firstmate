// firstmate: work through the captain's requests while they are away. Each queued request gets its own headless
// first-mate chat (`agy -p --agent firstmate`), one after another, so no chat grows long and every item starts
// from the commit the last one left.
//   fm.js queue <repo> [add "<request>" ["<request>"…] | drop <id>]
//   fm.js afk   <repo> [--max <n>] [--detach] | --stop
// The runner needs merge mode commit, a branch that is not protected and a clean working tree, and it stops when an
// item leaves uncommitted changes behind. Records: <repo>/.firstmate/queue.json, <notes>/afk.jsonl (tokens),
// <notes>/afk.out (a detached runner's output).

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { notesDir, wtRoot } = require('./fm-paths.js');
const { withLock } = require('./fm-lock.js');
const { loadConfig } = require('./fm-config.js');
const { agyPath } = require('./fm-crew.js');
const { usable, forget } = require('./fm-quota.js');

class AfkError extends Error {}

const queueFile = (r) => path.join(r, '.firstmate', 'queue.json');
const pidFile = (r) => path.join(notesDir(r), 'afk.pid');
const stopFile = (r) => path.join(notesDir(r), 'afk.stop');
const now = () => new Date().toISOString();
const slash = (p) => String(p).split(path.sep).join('/');
const git = (r, args) => { const x = spawnSync('git', args, { cwd: r, encoding: 'utf8' }); return x.status === 0 ? x.stdout.trim() : ''; };
const globRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);

function needInit(r) { if (!fs.existsSync(path.join(r, '.firstmate'))) throw new AfkError(`run fm.js init ${r} first`); }
function readQueue(r) { try { const q = JSON.parse(fs.readFileSync(queueFile(r), 'utf8')); return Array.isArray(q) ? q : []; } catch { return []; } }
function editQueue(r, fn) {
  return withLock(r, () => { const q = readQueue(r); const res = fn(q); fs.writeFileSync(queueFile(r), `${JSON.stringify(q, null, 2)}\n`); return res; });
}

function runnerPid(r) {
  const pid = Number((() => { try { return fs.readFileSync(pidFile(r), 'utf8'); } catch { return 0; } })()) || 0;
  if (!pid) return 0;
  try { process.kill(pid, 0); return pid; } catch (e) { return e.code === 'EPERM' ? pid : 0; }
}

function add(r, requests) {
  needInit(r);
  const items = requests.map((x) => String(x || '').trim()).filter(Boolean);
  if (!items.length) throw new AfkError('nothing to queue: fm.js queue <repo> add "<request>" ["<request>"…]');
  return editQueue(r, (q) => items.map((request) => {
    const id = q.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
    q.push({ id, request, state: 'waiting', added: now() });
    return id;
  }));
}

function drop(r, id) {
  needInit(r);
  editQueue(r, (q) => {
    const i = q.findIndex((x) => x.id === id);
    if (i < 0) throw new AfkError(`no queued item #${id}`);
    if (q[i].state !== 'waiting') throw new AfkError(`item #${id} is ${q[i].state}; only a waiting item can be dropped`);
    q.splice(i, 1);
  });
}

function list(r) {
  const pid = runnerPid(r);
  const q = readQueue(r);
  const head = `[fm] queue for ${r}: ${pid ? `an afk runner is working on it (pid ${pid})` : 'no afk runner'}`;
  if (!q.length) return [head, '  (empty) add with: fm.js queue <repo> add "<request>"'];
  const one = (s) => String(s || '').replace(/\s+/g, ' ').slice(0, 90);
  return [head, ...q.map((x) => `  #${x.id} ${x.state.padEnd(8)}| ${one(x.request)}${x.summary ? ` | ${one(x.summary.split('\n').filter(Boolean).pop())}` : ''}`)];
}

// Why the runner may not start; throws AfkError. An empty queue is not checked here.
function checkReady(r, cfg) {
  needInit(r);
  if (cfg.merge !== 'commit') throw new AfkError(`afk delivers one task after another, each as its own commit, but the merge mode is '${cfg.merge}'. The captain sets it with: fm.js config ${r} merge commit`);
  const branch = git(r, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if ((cfg.protectedBranches || []).some((g) => globRe(g).test(branch)) && !cfg.commitOnProtected) throw new AfkError(`${branch} is protected, so deliveries there are not committed; switch to a work branch first (git switch -c <name>)`);
  if (git(r, ['status', '--porcelain'])) throw new AfkError('the working tree has uncommitted changes; commit or stash them first, so every item starts from a clean branch');
  const pid = runnerPid(r);
  if (pid) throw new AfkError(`an afk runner is already working on this repo (pid ${pid}); stop it with: fm.js afk ${r} --stop`);
}

function matePrompt(item) {
  return [
    `You are running unattended: the captain is away (fm.js afk, queue item #${item.id}). Do the request below the usual way: brief the tasks and run them with one fm.js run --batch call.`,
    '- Do not ask questions. When the request has two readings, take the narrower one and say so in your report.',
    '- Run only fm.js commands: the gate already runs the project\'s checks.',
    '- High risk stays for the captain: when fm.js deliver stops with exit 3, leave that task and say so.',
    '- No quota stops you too: when an fm.js command exits 4, do not retry; leave the task and say what waits.',
    '- End with a short report: what was delivered (task and commit), what waits for the captain and why.',
    '',
    'REQUEST:',
    item.request,
  ].join('\n');
}

// The run's own permissions, for this chat only: fm.js, the brief folder and the task workspaces.
function mateArgs(r, cfg, prompt) {
  const settings = { permissions: { allow: [`command(node ${slash(path.join(__dirname, 'fm.js'))})`, `write_file(${slash(r)}/.firstmate/briefs)`, `read_file(${slash(wtRoot())})`] } };
  return ['-p', prompt, '--agent', 'firstmate', '--model', mateModel(cfg), '--output-format', 'json', '--print-timeout', `${Number(cfg.afkItemTimeoutSec) || 3600}s`, '--settings', JSON.stringify(settings)];
}

function runMate(r, args, timeoutSec) {
  const agy = agyPath();
  const [cmd, argv] = agy.endsWith('.js') ? [process.execPath, [agy, ...args]] : [agy, args];
  const t0 = Date.now();
  return new Promise((resolve) => {
    let out = ''; let err = ''; let child;
    try { child = spawn(cmd, argv, { cwd: r, env: { ...process.env, FM_AFK: '1' }, windowsHide: true }); } catch (e) { resolve({ ok: false, error: e.message, ms: 0 }); return; }
    const killer = setTimeout(() => { try { child.kill(); } catch {} }, (timeoutSec + 120) * 1000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { err += e.message; });
    child.on('close', (code) => {
      clearTimeout(killer);
      let json = null;
      try { json = JSON.parse(out.trim().split('\n').filter(Boolean).pop() || ''); } catch {}
      const ok = code === 0 && json && json.status === 'SUCCESS';
      const denied = json && Array.isArray(json.denied_actions) && json.denied_actions.length ? ` (refused: ${json.denied_actions.map((x) => x.display_name || x.action).join(', ')})` : '';
      resolve({ ok, json, error: ok ? '' : `${(json && json.response) || err.trim().split('\n').slice(-3).join(' ') || `exit ${code}`}${denied}`, ms: Date.now() - t0 });
    });
  });
}

const mateModel = (cfg) => (cfg.models && (cfg.models.mate || cfg.models.standard)) || 'gemini-3.8-flash-medium';
const sleepMs = (ms) => new Promise((res) => setTimeout(res, ms));

// Waits while the first mate's quota group is empty and comes back within afkMaxWaitHours. Resolves to '' when the
// first mate may run, or to why the runner must stop.
async function waitForQuota(r, cfg, log) {
  const poll = Number(process.env.FM_AFK_POLL_MS) || 60000;
  const pad = process.env.FM_AFK_PAD_MS !== undefined ? Number(process.env.FM_AFK_PAD_MS) : 30000;
  const maxWait = (Number(cfg.afkMaxWaitHours) || 6) * 3600 * 1000;
  for (;;) {
    const u = usable(mateModel(cfg), cfg);
    if (u.ok) return '';
    if (!u.quota) return `the first mate's model ${mateModel(cfg)} is ${u.why}`;
    const until = Date.parse(u.until) || 0;
    if (!until || until - Date.now() > maxWait) return `${u.why}, later than afkMaxWaitHours (${Number(cfg.afkMaxWaitHours) || 6} h)`;
    log(`[fm] afk: waiting for quota: ${u.why}`);
    while (Date.now() < until + pad) {
      if (fs.existsSync(stopFile(r))) return 'stopped with fm.js afk --stop';
      await sleepMs(Math.min(poll, until + pad - Date.now() + 1));
    }
    forget();
  }
}

// Whether anything was delivered since an item started (ledger rows), so a cut-short item is not run twice.
function deliveredSince(r, iso) {
  try { return fs.readFileSync(path.join(notesDir(r), 'ledger.tsv'), 'utf8').split('\n').slice(1).some((l) => l.split('\t')[0] >= iso); } catch { return false; }
}

// Runs waiting items until the queue is empty, --max is reached, --stop is asked or an item leaves a mess.
// Resolves to the exit code: 0, or 1 when an item failed or the runner had to halt.
async function afk(r, { max = 0, log }) {
  needInit(r);
  if (!readQueue(r).some((x) => x.state === 'waiting')) { log(`[fm] nothing queued for ${r}; add with: fm.js queue ${r} add "<request>"`); return 0; }
  const cfg = loadConfig(r);
  checkReady(r, cfg);
  fs.mkdirSync(notesDir(r), { recursive: true });
  fs.writeFileSync(pidFile(r), String(process.pid));
  fs.rmSync(stopFile(r), { force: true });
  const cleanup = () => { if (runnerPid(r) === process.pid) fs.rmSync(pidFile(r), { force: true }); fs.rmSync(stopFile(r), { force: true }); };
  const onSignal = () => { cleanup(); process.exit(130); };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  // an item still marked running belongs to a runner that was killed: the captain checks it
  editQueue(r, (q) => q.forEach((x) => { if (x.state === 'running') Object.assign(x, { state: 'failed', summary: 'interrupted: the runner stopped during this item; check fm.js report' }); }));
  const startedAt = now();
  let ran = 0; let failed = 0; let why = 'the queue is empty';
  try {
    for (;;) {
      if (fs.existsSync(stopFile(r))) { why = 'stopped with fm.js afk --stop'; break; }
      if (max && ran >= max) { why = `ran ${max} item(s) (--max)`; break; }
      if (!readQueue(r).some((x) => x.state === 'waiting')) break;
      const blocked = await waitForQuota(r, cfg, log);
      if (blocked) { why = blocked; failed += 1; break; }
      const item = editQueue(r, (q) => { const it = q.find((x) => x.state === 'waiting'); if (it) Object.assign(it, { state: 'running', started: now() }); return it ? { ...it } : null; });
      if (!item) break;
      log(`[fm] afk: item #${item.id} started: ${item.request}`);
      const res = await runMate(r, mateArgs(r, cfg, matePrompt(item)), Number(cfg.afkItemTimeoutSec) || 3600);
      ran += 1;
      const said = res.ok ? String(res.json.response || '').trim() || '(the first mate ended without a report)' : `FAILED: ${res.error}`;
      const u = (res.json && res.json.usage) || {};
      // Cut short because the first mate's quota ran out, with nothing delivered yet: back in the queue, to run once
      // the quota is back (the next turn of the loop waits for it).
      if (!res.ok) forget();
      if (!res.ok && usable(mateModel(cfg), cfg).quota && !deliveredSince(r, item.started)) {
        editQueue(r, (q) => { const it = q.find((x) => x.id === item.id); if (it) Object.assign(it, { state: 'waiting', summary: `put back: the quota ran out during the run (${said.slice(0, 200)})` }); });
        log(`[fm] afk: item #${item.id} put back in the queue: the quota ran out during it and nothing was delivered`);
        ran -= 1;
        if (git(r, ['status', '--porcelain'])) { why = `item #${item.id} left uncommitted changes in the working tree; stopped so the next item does not start on top of them`; failed += 1; break; }
        continue;
      }
      editQueue(r, (q) => { const it = q.find((x) => x.id === item.id); if (it) Object.assign(it, { state: res.ok ? 'done' : 'failed', finished: now(), seconds: Math.round(res.ms / 1000), conversation_id: res.json && res.json.conversation_id, summary: said.slice(0, 4000) }); });
      fs.appendFileSync(path.join(notesDir(r), 'afk.jsonl'), `${JSON.stringify({ time: now(), id: item.id, ok: res.ok, conversation_id: res.json && res.json.conversation_id, seconds: Math.round(res.ms / 1000), usage: u })}\n`);
      log(`[fm] afk: item #${item.id} ${res.ok ? 'done' : 'FAILED'} in ${Math.round(res.ms / 1000)}s: ${said.split('\n').filter(Boolean).pop().slice(0, 200)}`);
      if (!res.ok) failed += 1;
      if (git(r, ['status', '--porcelain'])) { why = `item #${item.id} left uncommitted changes in the working tree; stopped so the next item does not start on top of them`; failed += 1; break; }
    }
  } finally { cleanup(); process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal); }
  log(`[fm] afk finished: ${ran} item(s) run, ${why}. Details: fm.js queue ${r} and fm.js report ${r} --since ${startedAt}`);
  return failed ? 1 : 0;
}

// Starts the runner as a background process that outlives the chat that started it.
function detach(r, rest) {
  needInit(r);
  if (!readQueue(r).some((x) => x.state === 'waiting')) throw new AfkError(`nothing queued for ${r}; add with: fm.js queue ${r} add "<request>"`);
  checkReady(r, loadConfig(r));
  fs.mkdirSync(notesDir(r), { recursive: true });
  const outFile = path.join(notesDir(r), 'afk.out');
  const fd = fs.openSync(outFile, 'a');
  const child = spawn(process.execPath, [path.join(__dirname, 'fm.js'), 'afk', r, ...rest.filter((x) => x !== '--detach')], { cwd: r, detached: true, stdio: ['ignore', fd, fd], windowsHide: true });
  child.unref();
  fs.closeSync(fd);
  return { pid: child.pid, outFile };
}

function stop(r) {
  const pid = runnerPid(r);
  if (!pid) return `[fm] no afk runner is working on ${r}`;
  fs.writeFileSync(stopFile(r), `${now()}\n`);
  return `[fm] the afk runner (pid ${pid}) stops after its current item`;
}

module.exports = { AfkError, add, drop, list, afk, detach, stop, matePrompt, mateArgs };
