#!/usr/bin/env node
// firstmate workspace: the model's own task worktrees, kept out of the captain's branches.
//   fm.js init    <repo> [--new-repo]        exclude .firstmate/ locally, create facts.md, show state
//                                             (a folder that is not a git repo needs --new-repo, after the captain agrees)
//   fm.js fact    <repo> "<fact>" ["<fact>"…]  add dated lines to .firstmate/facts.md (skips duplicates)
//   fm.js start   <repo> <task>              detached worktree at <FM_WT_ROOT>/<repo-key>/<task> (outside the repo)
//   fm.js save    <repo> <task> "<message>"  commit the task's changes inside the task
//   fm.js gate    <repo> <task> [command]    run checks (auto-detected, or the given command)
//   fm.js review  <repo> <task> [--full]     diff, uses of the changed names, related unchanged files, checklist
//   fm.js deliver <repo> <task> [--keep] [--approve] [--mode propose|apply|commit] [--message "<subject>"]
//                                             merge the task by the repo's mode; high risk waits for --approve (exit 3)
//   fm.js undo    <repo> <task>              revert the task's commit, or reverse its uncommitted patch
//   fm.js path    <repo> <task>              the task's workspace folder
//   fm.js risk    <repo> <task>              low | medium | high, from the files and size of the change
//   fm.js detect  <repo> [--write]           the project's typecheck, lint and test commands (stored as checks with --write)
//   fm.js lock    <repo> <task> <path>...    acceptance tests the worker may not change; the gate fails if they do
//   fm.js config  <repo> [key [value]]       print the settings (defaults < ~/.firstmate/config.json < repo), one key, or set one
//   fm.js status  <repo>
//   fm.js clean   <repo> <task|--all>
//   fm.js clean   <repo> --legacy [--yes] [--force]  list (and remove) worker branches left by v0.7 and Antigravity worktrees
//   fm.js sweep   <repo> [--hours N] [--yes]  list (and remove) tasks idle for N hours (24) or whose workspace is gone
//   fm.js shape   <brief.md> [--sections] [file]  word counts of a /best brief's deliverables and drafts vs their limits
//   fm.js crew    <repo> <task> --role builder|reader|judge [--model ..] [--check "<cmd>"] [--brief ".." | --brief-file f]
//   fm.js crew    <repo> --batch <file.json>  run the crew as headless agy processes, in parallel (see fm-crew.js);
//                                             after each builder, fm.js saves and gates its workspace itself
//   fm.js usage   <conversation-id> [--brain <dir>]...  tokens per chat and subagent, and the strong model's share
// Tasks live in refs/firstmate/<task>/{base,head}, never in refs/heads, so `git branch` and pushes never see them.
// Node only (no bash, no ruby), so the same script runs on macOS, Linux and Windows.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { wtRoot, taskDir, notesDir } = require('./fm-paths.js');
const { withLock } = require('./fm-lock.js');
const { loadConfig, setRepoConfig, getKey, show } = require('./fm-config.js');

const ID = ['-c', 'user.name=firstmate', '-c', 'user.email=firstmate@local'];
const PROTECTED_RE = /^(main|master|prod|production|prod-.*|release\/.*)$/;
const DEP_NAMES = new Set(['node_modules', '.venv', 'venv', 'vendor', '.env', '.env.local', '.env.test', '.env.development', '.env.development.local', '.env.test.local']);

// sandboxed agents may not read ~/.gitconfig; fall back to no global config
try { fs.accessSync(path.join(os.homedir(), '.gitconfig'), fs.constants.R_OK); } catch { if (fs.existsSync(path.join(os.homedir(), '.gitconfig'))) process.env.GIT_CONFIG_GLOBAL = os.platform() === 'win32' ? 'NUL' : '/dev/null'; }

class Exit extends Error { constructor(code) { super(`exit ${code}`); this.code = code; } }
const out = (s) => process.stdout.write(s.endsWith('\n') ? s : `${s}\n`);
function die(msg) { process.stderr.write(`[fm] ERROR: ${msg}\n`); throw new Exit(2); }

// git <args> in <cwd>; returns { ok, out } (stdout trimmed of the final newline, stderr on failure)
function git(cwd, args, opts = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  const text = (r.stdout || '').replace(/\n$/, '');
  return { ok: r.status === 0, out: text, err: (r.stderr || '').trim() };
}
const gitOut = (cwd, args) => { const r = git(cwd, args); return r.ok ? r.out : ''; };
const lines = (s) => (s ? s.split('\n').filter(Boolean) : []);

// main checkout of the repo containing dir (works when given a task workspace path too), or null
function mainCheckout(dir) {
  if (!fs.existsSync(dir) || !git(dir, ['rev-parse', '--show-toplevel']).ok) return null;
  const m = gitOut(dir, ['worktree', 'list', '--porcelain']).match(/^worktree (.+)$/m);
  return m ? path.resolve(m[1]) : null;
}
function needRepo(arg) { return mainCheckout(arg) || die(`'${arg}' is not a git repo; run: fm.js init <repo>`); }
function taskName(t) {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(t || '')) die(`task name must be lowercase letters, digits and dashes: '${t || ''}'`);
  return t;
}
// absolute path of the repo's local-only exclude file (shared by all worktrees)
function excludeFile(r) { return path.join(path.resolve(r, gitOut(r, ['rev-parse', '--git-common-dir'])), 'info', 'exclude'); }
function excludeHas(ex, line) { try { return fs.readFileSync(ex, 'utf8').split(/\r?\n/).includes(line); } catch { return false; } }
function excludeAdd(ex, text) { fs.mkdirSync(path.dirname(ex), { recursive: true }); fs.appendFileSync(ex, text); }
const today = () => new Date().toISOString().slice(0, 10);

// ---------- shape ----------
const isWord = (w) => /[A-Za-z0-9]|[^\x00-\x7F]/.test(w);
const countWords = (text) => text.split(/\s+/).filter((w) => w && isWord(w)).length;
function sections(text) {
  const res = []; let h = null; let n = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('#')) { if (h !== null) res.push([n, h]); h = line; n = 0; }
    else if (h === null) { h = '(before the first heading)'; n = 0; }
    n += countWords(line);
  }
  if (h !== null) res.push([n, h]);
  return res;
}
const globRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);

function shape(brief, args) {
  if (!fs.existsSync(brief)) die(`no brief at '${brief}'`);
  const dir = path.dirname(path.resolve(brief));
  let showSections = false; let only = '';
  for (const a of args) { if (a === '--sections') showSections = true; else only = path.basename(a); }
  // paths are relative to the brief's folder; "best/x.md" written from the task folder means the same file
  const resolve = (p) => {
    let q = p.replace(/^\.\//, '');
    if (path.isAbsolute(q)) return q;
    if (path.basename(dir) === 'best') q = q.replace(/^best\//, '');
    return path.join(dir, q);
  };
  const rel = (f) => path.relative(dir, f).split(path.sep).join('/');
  const DLINE = /^\s*([-*]\s+)?[`*]*deliverable:/;
  const specs = fs.readFileSync(brief, 'utf8').split(/\r?\n/).filter((l) => DLINE.test(l));
  if (!specs.length) die(`no 'deliverable:' lines in ${brief} (one per deliverable: deliverable: final.md words=2500 covers=R1-R10 drafts=draft_*.md)`);
  let found = 0; let over = false; let matched = false;
  const report = (f, lim) => {
    if (only && path.basename(f) !== only) return;
    matched = true;
    if (!fs.existsSync(f)) { out(`  -      ${rel(f)}: not written yet`); return; }
    const text = fs.readFileSync(f, 'utf8');
    const n = countWords(text);
    let st = 'OK';
    if (n > lim + Math.floor(lim / 10)) { st = 'OVER'; over = true; } else if (n < Math.floor((lim * 8) / 10)) st = 'SHORT';
    const pct = Math.trunc(((n - lim) * 100) / lim);
    out(`  ${st.padEnd(6)} ${rel(f)}: ${n} / ${lim} words (${pct >= 0 ? '+' : ''}${pct}%)`);
    if (showSections) for (const [c, h] of sections(text)) out(`      ${String(c).padStart(5)}  ${h}`);
  };
  out("[fm] shape: words per file (markdown symbols not counted) vs the brief's limits; OVER = more than 10% over");
  for (const line of specs) {
    const spec = line.slice(line.indexOf('deliverable:') + 'deliverable:'.length).replace(/\*\*/g, '').replace(/[`"]/g, '');
    const p = spec.trim().split(/\s+/)[0] || '';
    const lim = Number(((spec.match(/words=([0-9][0-9.,]*)/) || [])[1] || '').replace(/[.,]/g, '')) || 0;
    const dr = (spec.match(/drafts=([^\s|]+)/) || [])[1] || '';
    if (!p || !lim) { out(`  ?      cannot read: ${line}`); continue; }
    found += 1;
    report(resolve(p), lim);
    if (dr) {
      const dg = resolve(dr); const re = globRe(path.basename(dg)); const ddir = path.dirname(dg);
      let any = false;
      try { for (const f of fs.readdirSync(ddir).sort()) if (re.test(f) && fs.statSync(path.join(ddir, f)).isFile()) { any = true; report(path.join(ddir, f), lim); } } catch {}
      if (!any && !only) out(`  -      ${rel(dg)}: no drafts yet`);
    }
  }
  if (!found) die(`no readable 'deliverable:' line in ${brief} (it needs a file name and words=<limit>)`);
  if (only && !matched) out(`  -      ${only}: not written yet, or not a deliverable or draft in the brief`);
  if (over) { out('[fm] shape: OVER'); throw new Exit(1); }
  out('[fm] shape: OK');
}

// ---------- commands ----------
function init(repoArg, flag) {
  let isNew = false;
  if (!fs.existsSync(repoArg) || !git(repoArg, ['rev-parse', '--git-dir']).ok) {
    if (flag !== '--new-repo') die(`'${repoArg}' is not a git repo. Task workspaces need one: ask the captain first; if they agree, run: fm.js init ${repoArg} --new-repo (it creates a repo with an initial commit of the folder). Read-only work needs no init.`);
    fs.mkdirSync(repoArg, { recursive: true });
    if (!git(repoArg, ['init', '-q', '-b', 'main']).ok) die(`git init failed in ${repoArg}`);
    isNew = true;
  }
  const r = needRepo(repoArg);
  const ex = excludeFile(r);
  if (!excludeHas(ex, '.firstmate/')) excludeAdd(ex, '\n# firstmate workspace (this machine only)\n.firstmate/\n');
  fs.mkdirSync(path.join(r, '.firstmate', 'notes'), { recursive: true });
  const facts = path.join(r, '.firstmate', 'facts.md');
  if (!fs.existsSync(facts)) fs.writeFileSync(facts, '# Facts about this repo (kept by the first mate; local only, never committed)\n# One line per fact, newest last: "- <fact> (source or date)". Correct wrong lines instead of adding contradictions.\n');
  if (isNew) {
    excludeAdd(ex, '.venv/\nvenv/\n__pycache__/\nnode_modules/\n.DS_Store\n');
    git(r, ['add', '-A']);
    git(r, [...ID, 'commit', '-q', '--allow-empty', '-m', 'initial commit']);
    out('[fm] new repo created with an initial commit');
  }
  if (!git(r, ['rev-parse', '-q', '--verify', 'HEAD']).ok) die('the repo has no commits yet; commit once, then run init again');
  const br = gitOut(r, ['rev-parse', '--abbrev-ref', 'HEAD']);
  out(`[fm] repo: ${r}`);
  out(`[fm] branch: ${br} | last commit: ${gitOut(r, ['log', '-1', '--format=%h %s'])}`);
  if (PROTECTED_RE.test(br)) out(`[fm] note: you are on '${br}'. Delivered changes stay uncommitted; commit them on the branch you choose.`);
  out(`[fm] uncommitted files in your checkout: ${lines(gitOut(r, ['status', '--porcelain'])).length}`);
  out(`[fm] facts: ${facts} (${countFacts(facts)} facts)`);
}
const countFacts = (f) => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.startsWith('- ')).length; } catch { return 0; } };

function fact(repoArg, facts) {
  const r = needRepo(repoArg); const f = path.join(r, '.firstmate', 'facts.md');
  if (!fs.existsSync(f)) die(`run: fm.js init ${r}`);
  if (!facts.length) die('usage: fm.js fact <repo> "<fact>" ["<fact>" ...]');
  for (const raw of facts) {
    const one = raw.replace(/\n/g, ' ').replace(/ +/g, ' ').trim();
    if (!one) continue;
    const known = fs.readFileSync(f, 'utf8').toLowerCase().includes(`- ${one} (`.toLowerCase());
    if (known) out(`[fm] already known: ${one}`);
    else { fs.appendFileSync(f, `- ${one} (${today()})\n`); out(`[fm] fact recorded: ${one}`); }
  }
  out(`[fm] ${countFacts(f)} facts in ${f}`);
}

// link (or, where links are not allowed, copy) a git-ignored dependency or env file into the workspace
function linkDep(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const isDir = fs.statSync(src).isDirectory();
  try { fs.symlinkSync(src, dst, isDir ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file'); }
  catch (e) { if (isDir) throw e; fs.copyFileSync(src, dst); }
}

// ---------- slots: each live task gets a small number, so parallel checks can use their own port ----------
const slotFile = (r, t) => path.join(notesDir(r), `${t}.slot`);
function allocSlot(r, t) {
  const used = new Set();
  try { for (const f of fs.readdirSync(notesDir(r))) if (f.endsWith('.slot')) used.add(Number(fs.readFileSync(path.join(notesDir(r), f), 'utf8').trim())); } catch {}
  let n = 0; while (used.has(n)) n += 1;
  fs.mkdirSync(notesDir(r), { recursive: true });
  fs.writeFileSync(slotFile(r, t), `${n}\n`);
  return n;
}
function slotOf(r, t) { try { return Number(fs.readFileSync(slotFile(r, t), 'utf8').trim()) || 0; } catch { return 0; } }
function touchSlot(r, t) { try { const now = new Date(); fs.utimesSync(slotFile(r, t), now, now); } catch {} }
const portBase = (r) => Number(loadConfig(r).portBase) || 3100;
const slotEnv = (r, t) => ({ ...process.env, FIRSTMATE_SLOT: String(slotOf(r, t)), PORT: String(portBase(r) + slotOf(r, t)) });

function start(repoArg, t) {
  const r = needRepo(repoArg); taskName(t);
  withLock(r, () => startLocked(r, t));
}
function startLocked(r, t) {
  const w = taskDir(r, t);
  if (fs.existsSync(w) || git(r, ['rev-parse', '-q', '--verify', `refs/firstmate/${t}/head`]).ok) die(`task '${t}' already exists at ${w} (use another name, or: fm.js clean ${r} ${t})`);
  if (!fs.existsSync(path.join(r, '.firstmate'))) die(`run: fm.js init ${r}`);
  try { fs.mkdirSync(path.dirname(w), { recursive: true }); fs.accessSync(path.dirname(w), fs.constants.W_OK); }
  catch (e) { die(`cannot create the task workspace folder ${path.dirname(w)} (${e.code || e.message}). Set FM_WT_ROOT to a folder the agents may write to (now: ${wtRoot()}).`); }
  const base = gitOut(r, ['rev-parse', 'HEAD']);
  const add = git(r, ['worktree', 'add', '-q', '--detach', w, base]);
  if (!add.ok) die(`git worktree add failed: ${add.err}`);
  git(r, ['update-ref', `refs/firstmate/${t}/base`, base]);
  git(r, ['update-ref', `refs/firstmate/${t}/head`, base]);
  // git-ignored dependencies and env files are not in a fresh worktree; link them from the captain's
  // checkout so builds and tests run, and exclude them (by exact path) so a save never commits them
  const ex = excludeFile(r); let linked = 0;
  for (let p of lines(gitOut(r, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory']))) {
    p = p.replace(/\/$/, '');
    if (!DEP_NAMES.has(path.posix.basename(p)) || p === '.firstmate' || p.startsWith('.firstmate/')) continue;
    const dst = path.join(w, p);
    if (fs.existsSync(dst)) continue;
    try { linkDep(path.join(r, p), dst); linked += 1; } catch { continue; }
    if (!excludeHas(ex, `/${p}`)) excludeAdd(ex, `/${p}\n`);
  }
  const slot = allocSlot(r, t);
  out(`[fm] task ${t}: workspace ${w} (from ${gitOut(r, ['log', '-1', '--format=%h %s', base])}), slot ${slot} (PORT ${portBase(r) + slot} in checks)`);
  if (linked) out(`[fm] linked ${linked} git-ignored dependency/env path(s) from your checkout (node_modules, .venv, .env...)`);
  if (gitOut(r, ['status', '--porcelain'])) out("[fm] note: the captain's uncommitted changes are NOT in this workspace");
}

function save(repoArg, t, msg) {
  const r = needRepo(repoArg); taskName(t);
  const w = taskDir(r, t); touchSlot(r, t);
  if (!fs.existsSync(w)) die(`no workspace for task '${t}'`);
  git(w, ['add', '-A']);
  if (git(w, ['diff', '--cached', '--quiet']).ok) out('[fm] no new changes to save');
  else {
    // the task's own history: the repo's commit hooks (husky, lint-staged) are for the captain's commits, not these
    const c = git(w, [...ID, 'commit', '-q', '--no-verify', '-m', msg || `firstmate: ${t}`]);
    if (!c.ok) die(`could not record the task's changes: ${(c.err || c.out).split('\n')[0]}`);
  }
  git(r, ['update-ref', `refs/firstmate/${t}/head`, gitOut(w, ['rev-parse', 'HEAD'])]);
  out(`[fm] task ${t} saved: ${gitOut(r, ['diff', '--shortstat', `refs/firstmate/${t}/base`, `refs/firstmate/${t}/head`]).trim()}`);
  const stat = lines(gitOut(r, ['diff', '--stat=100', `refs/firstmate/${t}/base`, `refs/firstmate/${t}/head`]));
  if (stat.length) out(stat.slice(0, -1).slice(0, 30).join('\n'));
}

function gate(repoArg, t, cmd) {
  const r = needRepo(repoArg); taskName(t);
  const w = taskDir(r, t); touchSlot(r, t);
  if (!fs.existsSync(w)) die(`no workspace for task '${t}'`);
  if (gitOut(w, ['status', '--porcelain'])) die(`task '${t}' has unsaved changes; run: fm.js save ${r} ${t} "<message>"`);
  const headc = gitOut(w, ['rev-parse', 'HEAD']);
  if (headc !== gitOut(r, ['rev-parse', `refs/firstmate/${t}/head`])) git(r, ['update-ref', `refs/firstmate/${t}/head`, headc]);
  const note = path.join(r, '.firstmate', 'notes', `${t}.gate`);
  fs.mkdirSync(path.dirname(note), { recursive: true });
  let pass; let log;
  const locked = checkLocks(r, t, w);
  if (cmd) {
    out(`[fm] gate ${t}: running given check in ${w}: ${cmd}`);
    const res = spawnSync(cmd, { cwd: w, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: slotEnv(r, t) });
    log = `${res.stdout || ''}${res.stderr || ''}`; pass = res.status === 0;
    out(log.split('\n').slice(-40).join('\n'));
  } else {
    ({ pass, log } = require('./fm-checks.js').runChecks(w, `refs/firstmate/${t}/base`, r));
    const proj = projectChecks(r, t, w);
    pass = pass && proj.pass; log = [log, ...proj.lines].filter(Boolean).join('\n');
    out(log);
  }
  if (locked.length) { pass = false; log = `${locked.join('\n')}\n${log}`; out(locked.join('\n')); }
  fs.writeFileSync(`${note}.log`, log);
  const left = gitOut(w, ['status', '--porcelain']);
  if (left) {
    out('[fm] the check left files in the workspace; removed so they are not delivered:');
    out(lines(left).slice(0, 20).map((l) => `  ${l}`).join('\n'));
    git(w, ['checkout', '-q', '--', '.']); git(w, ['clean', '-fdq']);
  }
  const v = pass ? 'PASS' : 'FAIL';
  fs.writeFileSync(note, `${headc} ${v}\n`);
  out(`[fm] gate ${t}: ${v}`);
  if (!pass) throw new Exit(1);
}

// The project's own checks from the config (typecheck, lint, test), each with a time limit and the task's slot.
function projectChecks(r, t, w) {
  const cfg = loadConfig(r); const res = []; let pass = true;
  for (const name of ['typecheck', 'lint', 'test']) {
    const cmd = cfg.checks && cfg.checks[name];
    if (!cmd) continue;
    const limit = (Number(cfg.checkTimeoutSec) || 600) * 1000;
    const x = spawnSync(cmd, { cwd: w, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: slotEnv(r, t), timeout: limit });
    if (x.status === 0) { res.push(`PASS  check ${name}: ${cmd}`); continue; }
    pass = false;
    res.push(`FAIL  check ${name}: ${cmd}${x.error && x.error.code === 'ETIMEDOUT' ? ` (timed out after ${limit / 1000}s)` : ''}`);
    res.push(...`${x.stdout || ''}${x.stderr || ''}`.trim().split('\n').slice(-25).map((l) => `      ${l}`));
  }
  return { pass, lines: res };
}

// ---------- locked acceptance tests: files the worker may not change ----------
const lockFile = (r, t) => path.join(notesDir(r), `${t}.locked`);
const sha256 = (f) => require('crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function readLocks(r, t) {
  try { return fs.readFileSync(lockFile(r, t), 'utf8').split('\n').filter(Boolean).map((l) => { const i = l.indexOf('  '); return [l.slice(0, i), l.slice(i + 2)]; }); } catch { return []; }
}
function lock(repoArg, t, files) {
  const r = needRepo(repoArg); taskName(t);
  const w = taskDir(r, t);
  if (!fs.existsSync(w)) die(`no workspace for task '${t}'`);
  if (!files.length) die('usage: fm.js lock <repo> <task> <path>...');
  const locks = new Map(readLocks(r, t).map(([h, p]) => [p, h]));
  for (const f of files) {
    const rel = path.relative(w, path.resolve(w, f)).split(path.sep).join('/');
    if (!fs.existsSync(path.join(w, rel))) die(`${rel} does not exist in task '${t}'`);
    locks.set(rel, sha256(path.join(w, rel)));
    out(`[fm] locked ${rel} for task ${t}`);
  }
  fs.mkdirSync(notesDir(r), { recursive: true });
  fs.writeFileSync(lockFile(r, t), [...locks].map(([p, h]) => `${h}  ${p}`).join('\n') + '\n');
}
function checkLocks(r, t, w) {
  const bad = [];
  for (const [h, p] of readLocks(r, t)) {
    const f = path.join(w, p);
    if (!fs.existsSync(f)) bad.push(`FAIL  locked ${p} deleted after lock`);
    else if (sha256(f) !== h) bad.push(`FAIL  locked ${p} changed after lock`);
  }
  return bad;
}

function deliver(repoArg, t, args) {
  const r = needRepo(repoArg); taskName(t);
  return withLock(r, () => deliverLocked(r, t, args || []));
}

const LEDGER_HEAD = 'time\ttask\tmode\trisk\tgate\tverdict\tfiles\tsha\tundone';
const ledgerFile = (r) => path.join(notesDir(r), 'ledger.tsv');
function readLedger(r) {
  try { return fs.readFileSync(ledgerFile(r), 'utf8').split('\n').filter(Boolean).slice(1).map((l) => l.split('\t')); } catch { return []; }
}
function writeLedger(r, rows) {
  fs.mkdirSync(notesDir(r), { recursive: true });
  fs.writeFileSync(ledgerFile(r), `${[LEDGER_HEAD, ...rows.map((x) => x.join('\t'))].join('\n')}\n`);
}
const globRe2 = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);

function deliverLocked(r, t, args) {
  const opt = { keep: args.includes('--keep'), approve: args.includes('--approve'), mode: '', message: '' };
  for (let i = 0; i < args.length; i++) { if (args[i] === '--mode') opt.mode = args[++i] || ''; else if (args[i] === '--message') opt.message = args[++i] || ''; }
  const B = `refs/firstmate/${t}/base`; const H = `refs/firstmate/${t}/head`;
  if (!git(r, ['rev-parse', '-q', '--verify', H]).ok) die(`no task '${t}'`);
  const w = taskDir(r, t);
  if (fs.existsSync(w) && gitOut(w, ['status', '--porcelain'])) die(`task '${t}' has unsaved changes; save and gate first`);
  const note = path.join(notesDir(r), `${t}.gate`);
  let gsha; let gv;
  try { [gsha, gv] = fs.readFileSync(note, 'utf8').trim().split(/\s+/); } catch { die(`task '${t}' has no gate result; run: fm.js gate ${r} ${t}`); }
  if (gsha !== gitOut(r, ['rev-parse', H])) die(`task '${t}' changed after its gate; run the gate again`);
  if (gv !== 'PASS') die(`task '${t}' gate is ${gv}; fix it first`);
  const files = lines(gitOut(r, ['diff', '--name-only', B, H]));
  if (!files.length) die(`task '${t}' has no changes to deliver`);

  const cfg = loadConfig(r);
  const { ORDER } = require('./fm-risk.js');
  let mode = opt.mode || cfg.merge;
  if (!['propose', 'apply', 'commit'].includes(mode)) die(`unknown merge mode '${mode}' (propose, apply or commit)`);
  const risk = taskRisk(r, t);
  const maxAuto = ORDER.includes(cfg.autoMergeMaxRisk) ? cfg.autoMergeMaxRisk : 'medium';
  if (!opt.approve && mode !== 'propose' && (risk.level === 'high' || ORDER.indexOf(risk.level) > ORDER.indexOf(maxAuto))) {
    out(`[fm] risk ${risk.level} is above what merges without the captain (${risk.level === 'high' ? 'high always waits' : `autoMergeMaxRisk ${maxAuto}`}):`);
    mode = 'propose';
  }
  if (mode === 'propose') {
    out(`[fm] PROPOSED task ${t} (risk ${risk.level}): waiting for the captain. Deliver it with: fm.js deliver ${r} ${t} --approve`);
    out(risk.reasons.map((x) => `- ${x}`).join('\n'));
    out(gitOut(r, ['diff', '--stat=100', B, H]));
    throw new Exit(3);
  }

  const busy = files.filter((f) => gitOut(r, ['status', '--porcelain', '--', f]));
  if (busy.length) die(`you have uncommitted edits in: ${busy.map((f) => `'${f}'`).join(' ')}. Commit or stash them, then deliver again.`);
  const keepPatch = path.join(notesDir(r), `${t}.patch`);
  const diff = spawnSync('git', ['diff', '--binary', B, H], { cwd: r, maxBuffer: 256 * 1024 * 1024 });
  fs.mkdirSync(notesDir(r), { recursive: true });
  fs.writeFileSync(keepPatch, diff.stdout);
  let clean = true;
  if (git(r, ['apply', '--check', keepPatch]).ok) {
    git(r, ['apply', keepPatch]);
  } else {
    out('[fm] your branch moved since the task started; applying with a 3-way merge');
    const three = git(r, ['apply', '--3way', keepPatch]);
    for (const f of files) git(r, ['reset', '-q', '--', f]);
    const conflict = files.filter((f) => { try { return /^<{7} /m.test(fs.readFileSync(path.join(r, f), 'utf8')); } catch { return false; } });
    if (conflict.length) {
      clean = false;
      out(`[fm] CONFLICT markers left in: ${conflict.map((f) => `'${f}'`).join(' ')}. Resolve them by hand; the task is kept (fm.js clean ${r} ${t} when done).`);
    } else if (!three.ok) {
      fs.rmSync(keepPatch, { force: true });
      die('the task could not be applied to your branch (git apply --3way failed); nothing was changed and the task is kept');
    }
  }

  const branch = gitOut(r, ['rev-parse', '--abbrev-ref', 'HEAD']);
  let done = 'apply'; let sha = '-';
  if (mode === 'commit' && clean) {
    if (cfg.protectedBranches.some((g) => globRe2(g).test(branch)) && !cfg.commitOnProtected) {
      out(`[fm] ${branch} is protected: applied, not committed`);
    } else {
      git(r, ['add', '-A', '--', ...files]);
      const cargs = ['commit', '-q', '-m', opt.message || `firstmate: ${t}`, '-m', `Firstmate-Task: ${t}\nFirstmate-Risk: ${risk.level}`, '--', ...files];
      let c = git(r, cargs);
      if (!c.ok && /tell me who you are|user\.email|user\.name|identity/i.test(c.err)) c = git(r, [...ID, ...cargs]);
      if (c.ok) { done = 'commit'; sha = gitOut(r, ['rev-parse', 'HEAD']); }
      else { git(r, ['reset', '-q', '--', ...files]); out(`[fm] commit failed (${(c.err || c.out).split('\n')[0] || 'no message'}); the change is applied, uncommitted`); }
    }
  }
  if (done === 'commit') out(`[fm] delivered task ${t} to ${r} as commit ${sha.slice(0, 7)} on branch ${branch} (undo: fm.js undo ${r} ${t}):`);
  else out(`[fm] delivered task ${t} to ${r} as UNCOMMITTED changes${clean ? '' : ' WITH CONFLICTS'} on branch ${branch}:`);
  out(lines(gitOut(r, done === 'commit' ? ['show', '--stat=100', '--format=', sha] : ['diff', '--stat=100', '--', ...files])).slice(-30).join('\n'));
  if (done !== 'commit') out('[fm] review: git diff | then commit and push yourself');
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  fs.appendFileSync(path.join(notesDir(r), 'log.md'), `- ${stamp} delivered task ${t} to ${branch}, ${done === 'commit' ? `commit ${sha.slice(0, 7)}` : 'uncommitted'}: ${files.join(' ')}${clean ? '' : ' (CONFLICTS)'}\n`);
  if (clean) {
    const rows = readLedger(r);
    rows.push([new Date().toISOString(), t, done, risk.level, 'PASS', '-', files.join(' '), sha, '']);
    writeLedger(r, rows);
  }
  out('[fm] logged in .firstmate/notes/log.md and ledger.tsv');
  if (!opt.keep && clean) {
    if (fs.existsSync(w)) git(r, ['worktree', 'remove', '--force', w]);
    git(r, ['update-ref', '-d', B]); git(r, ['update-ref', '-d', H]);
    for (const f of [note, `${note}.log`, slotFile(r, t)]) fs.rmSync(f, { force: true });
    out(`[fm] task ${t} removed`);
  }
  if (!clean) throw new Exit(1);
}

// Undo the last delivery of a task: revert its commit, or reverse its patch when nothing touched the files since.
function undo(repoArg, t) {
  const r = needRepo(repoArg); taskName(t);
  withLock(r, () => {
    const rows = readLedger(r);
    let i = rows.length - 1;
    while (i >= 0 && !(rows[i][1] === t && !rows[i][8])) i -= 1;
    if (i < 0) die(`no delivery of task '${t}' to undo (see .firstmate/notes/ledger.tsv)`);
    const [, , mode, , , , files, sha] = rows[i];
    if (mode === 'commit') {
      if (!git(r, ['merge-base', '--is-ancestor', sha, 'HEAD']).ok) die(`commit ${sha.slice(0, 7)} of task '${t}' is not on this branch`);
      let rv = git(r, ['revert', '--no-edit', sha]);
      if (!rv.ok && /tell me who you are|user\.email|identity/i.test(rv.err)) { git(r, ['revert', '--abort']); rv = git(r, [...ID, 'revert', '--no-edit', sha]); }
      if (!rv.ok) { git(r, ['revert', '--abort']); die(`git revert of ${sha.slice(0, 7)} failed: ${rv.err.split('\n')[0]}`); }
      out(`[fm] task ${t}: reverted commit ${sha.slice(0, 7)} with ${gitOut(r, ['rev-parse', '--short', 'HEAD'])}`);
    } else {
      const patch = path.join(notesDir(r), `${t}.patch`);
      if (!fs.existsSync(patch)) die(`the patch of task '${t}' is gone; undo by hand`);
      if (!git(r, ['apply', '-R', '--check', patch]).ok) die(`${files} changed since the delivery; undo by hand`);
      git(r, ['apply', '-R', patch]);
      out(`[fm] task ${t}: the uncommitted change is reversed`);
    }
    rows[i][8] = new Date().toISOString();
    writeLedger(r, rows);
  });
}

// ---------- risk ----------
// The level from the change itself, raised (never lowered) by a judge's floor in <task>.riskfloor.
function taskRisk(r, t) {
  const { classify, maxRisk } = require('./fm-risk.js');
  const B = `refs/firstmate/${t}/base`; const H = `refs/firstmate/${t}/head`;
  if (!git(r, ['rev-parse', '-q', '--verify', H]).ok) die(`no task '${t}'`);
  const files = lines(gitOut(r, ['diff', '--name-status', '--no-renames', B, H])).map((l) => { const [st, ...p] = l.split('\t'); return { status: st[0], path: p.join('\t') }; });
  let changed = 0;
  for (const l of lines(gitOut(r, ['diff', '--numstat', B, H]))) { const [a, d] = l.split('\t'); changed += (Number(a) || 0) + (Number(d) || 0); }
  const res = classify({ files, changedLines: changed });
  let floor = '';
  try { floor = fs.readFileSync(path.join(notesDir(r), `${t}.riskfloor`), 'utf8').trim(); } catch {}
  if (floor && maxRisk(floor, res.level) !== res.level) { res.level = floor; res.reasons.unshift(`raised to ${floor} by the judge`); }
  fs.mkdirSync(notesDir(r), { recursive: true });
  fs.writeFileSync(path.join(notesDir(r), `${t}.risk`), `${res.level}\n`);
  return res;
}

const taskNames = (r, re) => [...new Set(lines(gitOut(r, ['for-each-ref', '--format=%(refname)', 'refs/firstmate/'])).map((x) => (x.match(re) || [])[1]).filter(Boolean))];

function status(repoArg) {
  const r = needRepo(repoArg);
  out(`[fm] repo: ${r} | branch: ${gitOut(r, ['rev-parse', '--abbrev-ref', 'HEAD'])} | your uncommitted files: ${lines(gitOut(r, ['status', '--porcelain'])).length}`);
  const tasks = taskNames(r, /^refs\/firstmate\/(.*)\/head$/);
  if (!tasks.length) { out('[fm] no tasks'); return; }
  for (const t of tasks) {
    const w = taskDir(r, t); const note = path.join(r, '.firstmate', 'notes', `${t}.gate`);
    let g = '-'; try { g = fs.readFileSync(note, 'utf8').trim().split(/\s+/)[1]; } catch {}
    const d = fs.existsSync(w) ? (gitOut(w, ['status', '--porcelain']) ? 'unsaved' : 'saved') : 'missing';
    out(`  ${t} | workspace: ${d} | gate: ${g} | ${gitOut(r, ['diff', '--shortstat', `refs/firstmate/${t}/base`, `refs/firstmate/${t}/head`]).trim()}`);
  }
}

function removeTask(r, t) {
  const w = taskDir(r, t);
  if (fs.existsSync(w)) { if (!git(r, ['worktree', 'remove', '--force', w]).ok) fs.rmSync(w, { recursive: true, force: true }); }
  for (const k of ['base', 'head']) git(r, ['update-ref', '-d', `refs/firstmate/${t}/${k}`]);
  for (const f of [`${t}.gate`, `${t}.gate.log`, `${t}.slot`]) fs.rmSync(path.join(notesDir(r), f), { force: true });
  out(`[fm] removed task ${t}`);
}

function clean(repoArg, args) {
  const r = needRepo(repoArg);
  if (args.includes('--legacy')) return cleanLegacy(r, args.includes('--yes'), args.includes('--force'));
  const which = args[0];
  withLock(r, () => {
    const tasks = which === '--all' ? taskNames(r, /^refs\/firstmate\/([^/]*)\//) : [taskName(which)];
    for (const t of tasks) removeTask(r, t);
    git(r, ['worktree', 'prune']);
  });
}

// Worker branches from v0.7 (subagent-*) and worktrees the Antigravity App created under ~/.gemini/antigravity*/
// worktrees. Listed by default; --yes removes the merged ones, --force also the unmerged ones.
function cleanLegacy(r, yes, force) {
  const home = path.join(os.homedir(), '.gemini').split(path.sep).join('/');
  const wts = {}; let cur = null;
  for (const l of lines(gitOut(r, ['worktree', 'list', '--porcelain']))) {
    if (l.startsWith('worktree ')) cur = l.slice(9);
    else if (l.startsWith('branch refs/heads/') && cur) wts[l.slice(18)] = cur;
  }
  const branches = new Set(lines(gitOut(r, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/subagent-*'])));
  for (const [b, w] of Object.entries(wts)) if (w.split(path.sep).join('/').startsWith(`${home}/antigravity`) && /\/worktrees\//.test(w)) branches.add(b);
  if (!branches.size) { out('[fm] no legacy worker branches'); return; }
  withLock(r, () => {
    for (const b of [...branches].sort()) {
      const merged = git(r, ['merge-base', '--is-ancestor', b, 'HEAD']).ok;
      const w = wts[b];
      if (!yes || (!merged && !force)) { out(`  ${b} | ${merged ? 'merged' : 'unmerged'}${w ? ` | worktree ${w}` : ''}${yes ? ' | kept (unmerged; --force removes it)' : ''}`); continue; }
      if (w) git(r, ['worktree', 'remove', '--force', w]);
      git(r, ['branch', '-D', b]);
      out(`  ${b} | ${merged ? 'merged' : 'unmerged'} | removed`);
    }
    git(r, ['worktree', 'prune']);
  });
  if (!yes) out('[fm] dry run: add --yes to remove the merged branches (and --force for the unmerged ones)');
}

function sweep(repoArg, args) {
  const r = needRepo(repoArg);
  const hi = args.indexOf('--hours'); const hours = hi >= 0 ? Number(args[hi + 1]) || 24 : 24;
  const yes = args.includes('--yes');
  const now = Date.now(); const stale = [];
  for (const t of taskNames(r, /^refs\/firstmate\/(.*)\/head$/)) {
    const w = taskDir(r, t);
    if (!fs.existsSync(w)) { stale.push([t, 'workspace missing']); continue; }
    let m; try { m = fs.statSync(slotFile(r, t)).mtimeMs; } catch { m = fs.statSync(w).mtimeMs; }
    const age = (now - m) / 3600000;
    if (age > hours) stale.push([t, `idle ${Math.floor(age)} h`]);
  }
  if (!stale.length) { out(`[fm] nothing idle for more than ${hours} h`); return; }
  for (const [t, why] of stale) out(`  ${t} | ${why}`);
  if (!yes) { out('[fm] dry run: add --yes to remove these tasks'); return; }
  withLock(r, () => { for (const [t] of stale) removeTask(r, t); git(r, ['worktree', 'prune']); });
}

// ---------- review ----------
// What the first mate reads once before it judges a change: the diff (trimmed per file), who else uses what
// changed, related files left unchanged, and a checklist for the kinds of files touched. It finds uses by
// name with git grep, so calls through variables, reflection or built-up names are not seen.
const REVIEW_MAX_LINES = 150;
const REVIEW_MAX_SYMBOLS = 15;
const REVIEW_MAX_HITS = 8;
const REVIEW_TOO_COMMON = 40;
const CODE_EXT = /\.(c?[jt]sx?|mjs|cjs|py|go|rb|java|kt|php|cs|rs|sh|bash)$/;
const CONF_EXT = /\.(ya?ml|json|tf|tfvars|hcl|properties|toml|ini|env)$/;
const CODE_SYM = [
  /\bfunction\s+([A-Za-z_$][\w$]*)/g,
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g,
  /\bdef\s+([A-Za-z_]\w*)/g,
  /\bclass\s+([A-Za-z_$][\w$]*)/g,
  /\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/g,
  /^\s*(?:export\s+)?(?:static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm,
];
const CONF_SYM = [
  /^\s*-?\s*["']?([A-Za-z_][\w.-]*)["']?\s*[:=]/gm,
  /^\s*(?:resource|module|variable|output|data)\s+"[^"]*"\s*(?:"([\w-]+)")?/gm,
];
const COMMON_SYMS = new Set(['name', 'image', 'tag', 'value', 'values', 'enabled', 'type', 'id', 'key', 'labels', 'annotations', 'spec',
  'metadata', 'data', 'kind', 'apiVersion', 'version', 'description', 'default', 'if', 'for', 'while', 'switch', 'catch', 'return',
  'constructor', 'then', 'else', 'test', 'it', 'describe', 'main', 'run', 'get', 'set', 'function', 'async', 'self', 'this']);
const CHECKLISTS = [
  [(f) => /(^|\/)values[^/]*\.ya?ml$/.test(f), 'Helm values: every changed key is read by a template (grep the chart); a change to shared values.yaml also reaches every other environment; what restarts or rolls out when it is applied.'],
  [(f, t) => /\.ya?ml$/.test(f) && /^\s*-?\s*(alert|expr):/m.test(t), 'Alert rules: metric name and window; threshold direction (> vs >=); for: duration; labels.severity; existing rules unchanged.'],
  [(f) => /(^|\/)\.github\/workflows\/|(^|\/)\.gitlab-ci\.ya?ml$|(^|\/)Jenkinsfile$|azure-pipelines/.test(f), 'CI: triggers and path filters still match the files they should; referenced secrets and variables exist; job order and needs.'],
  [(f) => /\.(tf|tfvars|hcl)$/.test(f), 'Terraform: anything replaced or destroyed (a forces-new attribute); renamed resources need a moved block; provider and module versions.'],
  [(f) => /(^|\/)Dockerfile[^/]*$/.test(f), 'Docker: base image pinned; user; exposed ports; build cache order; secrets not baked into layers.'],
  [(f) => /\.(sh|bash)$/.test(f), 'Shell: quoting and paths with spaces; set -e and pipefail behaviour; exit codes callers rely on.'],
  [(f) => CODE_EXT.test(f) && !/\.(sh|bash)$/.test(f), 'Code: boundaries and empty, huge or wrong-type input; error paths and what callers expect back; every unchanged caller under IMPACT; same result when run twice; a test that fails without the change.'],
];

function symbolsOf(file, text) {
  const res = CODE_EXT.test(file) ? CODE_SYM : CONF_EXT.test(file) ? CONF_SYM : [];
  const found = [];
  for (const re of res) for (const m of text.matchAll(re)) {
    const s = (m[1] || '').split('.').pop();
    if (s && s.length >= 3 && !COMMON_SYMS.has(s)) found.push(s);
  }
  return found;
}

function review(repoArg, t, opt) {
  const r = needRepo(repoArg); taskName(t);
  const B = `refs/firstmate/${t}/base`; const H = `refs/firstmate/${t}/head`;
  if (!git(r, ['rev-parse', '-q', '--verify', H]).ok) die(`no task '${t}'`);
  const w = taskDir(r, t);
  if (fs.existsSync(w) && gitOut(w, ['status', '--porcelain'])) die(`task '${t}' has unsaved changes; run: fm.js save ${r} ${t} "<message>"`);
  const files = lines(gitOut(r, ['diff', '--name-only', B, H]));
  if (!files.length) die(`task '${t}' has no changes`);
  const changed = new Set(files);
  let gateState = 'not run';
  try {
    const [gsha, gv] = fs.readFileSync(path.join(r, '.firstmate', 'notes', `${t}.gate`), 'utf8').trim().split(/\s+/);
    gateState = gsha === gitOut(r, ['rev-parse', H]) ? gv : 'stale (the task changed after its gate)';
  } catch {}
  out(`[fm] review ${t}: ${files.length} file(s) changed, gate ${gateState}`);
  out(gitOut(r, ['diff', '--stat', B, H]));

  // Diff, trimmed per file so a long file does not hide the others.
  const full = opt === '--full';
  const perFile = gitOut(r, ['diff', '-U3', '--no-color', B, H]).split(/^(?=diff --git )/m).filter(Boolean);
  const share = full ? Infinity : Math.max(20, Math.floor(REVIEW_MAX_LINES / perFile.length));
  out('\n--- DIFF');
  const texts = {};
  for (const chunk of perFile) {
    const ls = chunk.replace(/\n$/, '').split('\n');
    const file = (ls[0].match(/ b\/(.+)$/) || [])[1] || '';
    // Names in code come from the whole hunk (the enclosing function is often a context line) and git's
    // function hint after @@; in config only changed lines count, so neighbouring keys are not listed.
    const at = ls.findIndex((l) => l.startsWith('@@'));
    const hunk = at < 0 ? [] : ls.slice(at).filter((l) => CODE_EXT.test(file) || /^[+-@]/.test(l));
    texts[file] = hunk.map((l) => (l.startsWith('@@') ? l.replace(/^@@[^@]*@@/, '') : l.slice(1))).join('\n');
    out(ls.slice(0, share).join('\n'));
    if (ls.length > share) out(`... ${ls.length - share} more lines in ${file} (all of it: fm.js review ${r} ${t} --full)`);
  }

  // Impact: where each changed name is used, unchanged files first.
  const counts = new Map();
  for (const f of files) for (const s of symbolsOf(f, texts[f] || '')) counts.set(s, (counts.get(s) || 0) + 1);
  const syms = [...counts.keys()].sort((a, b) => b.length - a.length).slice(0, REVIEW_MAX_SYMBOLS);
  out('\n--- IMPACT (uses by name; calls through variables or reflection are not found)');
  if (!syms.length) out('no function, class or key names found in the changed lines');
  for (const s of syms) {
    const hits = lines(gitOut(r, ['grep', '-n', '-I', '-w', '-F', '-e', s, H, '--', '.', ':(exclude).firstmate']))
      .map((l) => l.slice(H.length + 1).match(/^(.*?):(\d+):(.*)$/)).filter(Boolean)
      .map(([, f, n, txt]) => ({ f, n, txt: txt.trim().slice(0, 100), same: changed.has(f) }))
      .sort((a, b) => a.same - b.same);
    const others = hits.filter((h) => !h.same).length;
    if (hits.length > REVIEW_TOO_COMMON) { out(`${s}: ${hits.length} uses (${others} in unchanged files), too common to list`); continue; }
    out(`${s}: ${hits.length} use(s), ${others} in unchanged files`);
    for (const h of hits.slice(0, REVIEW_MAX_HITS)) out(`  ${h.f}:${h.n}${h.same ? '' : '  [unchanged]'}  ${h.txt}`);
    if (hits.length > REVIEW_MAX_HITS) out(`  ... ${hits.length - REVIEW_MAX_HITS} more`);
  }

  // Related files left unchanged: same stem in the same folder (values-*.yaml, messages_en/_zh) and tests.
  const tree = lines(gitOut(r, ['ls-tree', '-r', '--name-only', H]));
  const stem = (b) => b.replace(/\.[^.]*$/, '').split(/[-_.]/)[0].toLowerCase();
  const related = new Set();
  for (const f of files) {
    const d = path.posix.dirname(f); const b = path.posix.basename(f); const ext = path.posix.extname(f);
    const name = b.slice(0, b.length - ext.length).replace(/\.(test|spec)$/, '');
    for (const x of tree) {
      if (changed.has(x)) continue;
      const xb = path.posix.basename(x);
      const sibling = path.posix.dirname(x) === d && path.posix.extname(x) === ext && stem(b).length >= 3 && stem(xb) === stem(b);
      const test = [`${name}.test${ext}`, `${name}.spec${ext}`, `test_${name}${ext}`, `${name}_test${ext}`, `${name}${ext}`].includes(xb) && xb !== b;
      if (sibling || test) related.add(x);
    }
  }
  out('\n--- RELATED, UNCHANGED');
  out(related.size ? [...related].slice(0, 12).map((x) => `  ${x}`).join('\n') : 'none');

  out('\n--- CHECKLIST');
  const items = CHECKLISTS.filter(([test]) => files.some((f) => test(f, texts[f] || ''))).map(([, text]) => `- ${text}`);
  out(items.length ? items.join('\n') : '- Every requested change is present and nothing unrequested changed.');
  out(`\n[fm] review ${t}: compare with the captain's words, then give the checker 3 to 5 scenarios (situation or input, expected result, why risky with file:line).`);
}

function usageCmd(id, args) {
  const brainDirs = [];
  for (let i = 0; i < args.length; i++) if (args[i] === '--brain' && args[i + 1]) brainDirs.push(args[++i]);
  const { usage, formatUsage } = require('./fm-usage.js');
  const res = usage(id, { brainDirs });
  if (!res) die(`no transcript for conversation '${id}'`);
  out(formatUsage(res));
}

// ---------- crew: headless agy processes, one per task ----------
async function crewCmd(repoArg, rest) {
  const r = needRepo(repoArg);
  const { crew, format, CrewError } = require('./fm-crew.js');
  let specs;
  const bi = rest.indexOf('--batch');
  if (bi >= 0) {
    try { specs = JSON.parse(fs.readFileSync(path.resolve(rest[bi + 1] || ''), 'utf8')); } catch (e) { die(`cannot read the batch file: ${e.message}`); }
    if (!Array.isArray(specs) || !specs.length) die('the batch file must hold a non-empty JSON array of { task, role, brief }');
  } else {
    const spec = { task: rest[0] };
    for (let i = 1; i < rest.length; i++) {
      const k = rest[i]; const v = rest[i + 1];
      if (k === '--role') { spec.role = v; i++; } else if (k === '--model') { spec.model = v; i++; } else if (k === '--skills') { spec.skills = v; i++; }
      else if (k === '--brief') { spec.brief = v; i++; } else if (k === '--brief-file') { spec.briefFile = v; i++; } else if (k === '--as') { spec.as = v; i++; }
      else if (k === '--check') { spec.check = v; i++; }
    }
    specs = [spec];
  }
  let results;
  try { results = await crew(r, specs); } catch (e) { if (e instanceof CrewError) die(e.message); throw e; }
  let failed = results.some((x) => !x.ok);
  for (const res of results) {
    out(format(res));
    if (!res.ok || res.m.role !== 'builder') continue;
    // the builder only edits; recording and checking its work is code, not something it may skip
    try {
      save(r, res.m.task, `crew: ${String(res.m.as || res.m.brief || res.m.task).split('\n')[0].slice(0, 60)}`);
      gate(r, res.m.task, res.m.check || '');
    } catch (e) { if (e instanceof Exit) failed = true; else throw e; }
  }
  if (failed) throw new Exit(1);
}

function main(argv) {
  if (argv.length < 2) die('usage: fm.js <init|fact|start|save|gate|review|deliver|status|clean> <repo> [args] | fm.js shape <brief.md> [--sections] [file] | fm.js usage <conversation-id>');
  const [cmd, arg, ...rest] = argv;
  switch (cmd) {
    case 'shape': return shape(arg, rest);
    case 'usage': return usageCmd(arg, rest);
    case 'crew': return crewCmd(arg, rest);
    case 'init': return init(arg, rest[0]);
    case 'fact': return fact(arg, rest);
    case 'start': return start(arg, rest[0]);
    case 'save': return save(arg, rest[0], rest[1]);
    case 'gate': return gate(arg, rest[0], rest.slice(1).join(' '));
    case 'review': return review(arg, rest[0], rest[1]);
    case 'deliver': return deliver(arg, rest[0], rest.slice(1));
    case 'undo': return undo(arg, rest[0]);
    case 'status': return status(arg);
    case 'clean': return clean(arg, rest);
    case 'sweep': return sweep(arg, rest);
    case 'lock': return lock(arg, rest[0], rest.slice(1));
    case 'detect': {
      const r = needRepo(arg); const found = require('./fm-detect.js').detectChecks(r);
      const names = Object.keys(found);
      if (!names.length) return out('[fm] no project checks found (package.json scripts, tsconfig, go.mod, Cargo.toml, pytest, Makefile)');
      for (const k of names) out(`${k}: ${found[k]}`);
      if (rest.includes('--write')) { for (const k of names) setRepoConfig(r, `checks.${k}`, JSON.stringify(found[k])); out('[fm] stored as checks in .firstmate/config.json'); }
      return undefined;
    }
    case 'risk': { const r = needRepo(arg); taskName(rest[0]); const res = taskRisk(r, rest[0]); return out([`RISK: ${res.level}`, ...res.reasons.map((x) => `- ${x}`)].join('\n')); }
    case 'config': {
      const r = needRepo(arg);
      if (rest.length >= 2) { setRepoConfig(r, rest[0], rest.slice(1).join(' ')); return out(show(getKey(loadConfig(r), rest[0]))); }
      return out(rest.length ? show(getKey(loadConfig(r), rest[0])) : JSON.stringify(loadConfig(r), null, 2));
    }
    case 'path': { const r = needRepo(arg); taskName(rest[0]); return out(taskDir(r, rest[0])); }
    default: return die(`unknown command '${cmd}'`);
  }
}

function fail(e) {
  if (e instanceof Exit) process.exitCode = e.code;
  else { process.stderr.write(`[fm] ERROR: ${e.message}\n`); process.exitCode = 2; }
}
try { const res = main(process.argv.slice(2)); if (res && typeof res.then === 'function') res.catch(fail); }
catch (e) { fail(e); }
