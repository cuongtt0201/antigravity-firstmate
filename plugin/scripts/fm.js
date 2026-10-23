#!/usr/bin/env node
// firstmate workspace: the model's own task worktrees, kept out of the captain's branches.
//   fm.js init    <repo> [--new-repo]        exclude .firstmate/ locally, create facts.md, show state
//                                             (a folder that is not a git repo needs --new-repo, after the captain agrees)
//   fm.js fact    <repo> "<fact>" ["<fact>"…]  add dated lines to .firstmate/facts.md (skips duplicates)
//   fm.js start   <repo> <task>              detached worktree at <repo>/.firstmate/wt/<task>
//   fm.js save    <repo> <task> "<message>"  commit the task's changes inside the task
//   fm.js gate    <repo> <task> [command]    run checks (auto-detected, or the given command)
//   fm.js deliver <repo> <task> [--keep]     apply the task diff to the captain's checkout, uncommitted
//   fm.js status  <repo>
//   fm.js clean   <repo> <task|--all>
//   fm.js shape   <brief.md> [--sections] [file]  word counts of a /best brief's deliverables and drafts vs their limits
// Tasks live in refs/firstmate/<task>/{base,head}, never in refs/heads, so `git branch` and pushes never see them.
// Node only (no bash, no ruby), so the same script runs on macOS, Linux and Windows.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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
  fs.mkdirSync(path.join(r, '.firstmate', 'wt'), { recursive: true });
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

function start(repoArg, t) {
  const r = needRepo(repoArg); taskName(t);
  const w = path.join(r, '.firstmate', 'wt', t);
  if (fs.existsSync(w)) die(`task '${t}' already exists at ${w} (use another name, or: fm.js clean ${r} ${t})`);
  if (!fs.existsSync(path.join(r, '.firstmate'))) die(`run: fm.js init ${r}`);
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
  out(`[fm] task ${t}: workspace ${w} (from ${gitOut(r, ['log', '-1', '--format=%h %s', base])})`);
  if (linked) out(`[fm] linked ${linked} git-ignored dependency/env path(s) from your checkout (node_modules, .venv, .env...)`);
  if (gitOut(r, ['status', '--porcelain'])) out("[fm] note: the captain's uncommitted changes are NOT in this workspace");
}

function save(repoArg, t, msg) {
  const r = needRepo(repoArg); taskName(t);
  const w = path.join(r, '.firstmate', 'wt', t);
  if (!fs.existsSync(w)) die(`no workspace for task '${t}'`);
  git(w, ['add', '-A']);
  if (git(w, ['diff', '--cached', '--quiet']).ok) out('[fm] no new changes to save');
  else git(w, [...ID, 'commit', '-q', '-m', msg || `firstmate: ${t}`]);
  git(r, ['update-ref', `refs/firstmate/${t}/head`, gitOut(w, ['rev-parse', 'HEAD'])]);
  out(`[fm] task ${t} saved: ${gitOut(r, ['diff', '--shortstat', `refs/firstmate/${t}/base`, `refs/firstmate/${t}/head`]).trim()}`);
  const stat = lines(gitOut(r, ['diff', '--stat=100', `refs/firstmate/${t}/base`, `refs/firstmate/${t}/head`]));
  if (stat.length) out(stat.slice(0, -1).slice(0, 30).join('\n'));
}

function gate(repoArg, t, cmd) {
  const r = needRepo(repoArg); taskName(t);
  const w = path.join(r, '.firstmate', 'wt', t);
  if (!fs.existsSync(w)) die(`no workspace for task '${t}'`);
  if (gitOut(w, ['status', '--porcelain'])) die(`task '${t}' has unsaved changes; run: fm.js save ${r} ${t} "<message>"`);
  const headc = gitOut(w, ['rev-parse', 'HEAD']);
  if (headc !== gitOut(r, ['rev-parse', `refs/firstmate/${t}/head`])) git(r, ['update-ref', `refs/firstmate/${t}/head`, headc]);
  const note = path.join(r, '.firstmate', 'notes', `${t}.gate`);
  fs.mkdirSync(path.dirname(note), { recursive: true });
  let pass; let log;
  if (cmd) {
    out(`[fm] gate ${t}: running given check in ${w}: ${cmd}`);
    const res = spawnSync(cmd, { cwd: w, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    log = `${res.stdout || ''}${res.stderr || ''}`; pass = res.status === 0;
    out(log.split('\n').slice(-40).join('\n'));
  } else {
    ({ pass, log } = require('./fm-checks.js').runChecks(w, `refs/firstmate/${t}/base`, r));
    out(log);
  }
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

function deliver(repoArg, t, keep) {
  const r = needRepo(repoArg); taskName(t);
  const B = `refs/firstmate/${t}/base`; const H = `refs/firstmate/${t}/head`;
  if (!git(r, ['rev-parse', '-q', '--verify', H]).ok) die(`no task '${t}'`);
  const w = path.join(r, '.firstmate', 'wt', t);
  if (fs.existsSync(w) && gitOut(w, ['status', '--porcelain'])) die(`task '${t}' has unsaved changes; save and gate first`);
  const note = path.join(r, '.firstmate', 'notes', `${t}.gate`);
  let gsha; let gv;
  try { [gsha, gv] = fs.readFileSync(note, 'utf8').trim().split(/\s+/); } catch { die(`task '${t}' has no gate result; run: fm.js gate ${r} ${t}`); }
  if (gsha !== gitOut(r, ['rev-parse', H])) die(`task '${t}' changed after its gate; run the gate again`);
  if (gv !== 'PASS') die(`task '${t}' gate is ${gv}; fix it first`);
  const files = lines(gitOut(r, ['diff', '--name-only', B, H]));
  if (!files.length) die(`task '${t}' has no changes to deliver`);
  const busy = files.filter((f) => gitOut(r, ['status', '--porcelain', '--', f]));
  if (busy.length) die(`you have uncommitted edits in: ${busy.map((f) => `'${f}'`).join(' ')}. Commit or stash them, then deliver again.`);
  const patch = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fm-')), 'task.patch');
  const diff = spawnSync('git', ['diff', '--binary', B, H], { cwd: r, maxBuffer: 256 * 1024 * 1024 });
  fs.writeFileSync(patch, diff.stdout);
  let clean = true;
  try {
    if (git(r, ['apply', '--check', patch]).ok) {
      git(r, ['apply', patch]);
    } else {
      out('[fm] your branch moved since the task started; applying with a 3-way merge');
      const three = git(r, ['apply', '--3way', patch]);
      for (const f of files) git(r, ['reset', '-q', '--', f]);
      const conflict = files.filter((f) => { try { return /^<{7} /m.test(fs.readFileSync(path.join(r, f), 'utf8')); } catch { return false; } });
      if (conflict.length) {
        clean = false;
        out(`[fm] CONFLICT markers left in: ${conflict.map((f) => `'${f}'`).join(' ')}. Resolve them by hand; the task is kept (fm.js clean ${r} ${t} when done).`);
      } else if (!three.ok) {
        die('the task could not be applied to your branch (git apply --3way failed); nothing was changed and the task is kept');
      }
    }
  } finally { fs.rmSync(path.dirname(patch), { recursive: true, force: true }); }
  const branch = gitOut(r, ['rev-parse', '--abbrev-ref', 'HEAD']);
  out(`[fm] delivered task ${t} to ${r} as UNCOMMITTED changes${clean ? '' : ' WITH CONFLICTS'} on branch ${branch}:`);
  out(lines(gitOut(r, ['diff', '--stat=100', '--', ...files])).slice(-30).join('\n'));
  out('[fm] review: git diff | then commit and push yourself');
  fs.mkdirSync(path.join(r, '.firstmate', 'notes'), { recursive: true });
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
  fs.appendFileSync(path.join(r, '.firstmate', 'notes', 'log.md'), `- ${stamp} delivered task ${t} to ${branch}, uncommitted: ${files.join(' ')}${clean ? '' : ' (CONFLICTS)'}\n`);
  out('[fm] logged in .firstmate/notes/log.md');
  if (keep !== '--keep' && clean) {
    if (fs.existsSync(w)) git(r, ['worktree', 'remove', '--force', w]);
    git(r, ['update-ref', '-d', B]); git(r, ['update-ref', '-d', H]);
    fs.rmSync(note, { force: true }); fs.rmSync(`${note}.log`, { force: true });
    out(`[fm] task ${t} removed`);
  }
  if (!clean) throw new Exit(1);
}

const taskNames = (r, re) => [...new Set(lines(gitOut(r, ['for-each-ref', '--format=%(refname)', 'refs/firstmate/'])).map((x) => (x.match(re) || [])[1]).filter(Boolean))];

function status(repoArg) {
  const r = needRepo(repoArg);
  out(`[fm] repo: ${r} | branch: ${gitOut(r, ['rev-parse', '--abbrev-ref', 'HEAD'])} | your uncommitted files: ${lines(gitOut(r, ['status', '--porcelain'])).length}`);
  const tasks = taskNames(r, /^refs\/firstmate\/(.*)\/head$/);
  if (!tasks.length) { out('[fm] no tasks'); return; }
  for (const t of tasks) {
    const w = path.join(r, '.firstmate', 'wt', t); const note = path.join(r, '.firstmate', 'notes', `${t}.gate`);
    let g = '-'; try { g = fs.readFileSync(note, 'utf8').trim().split(/\s+/)[1]; } catch {}
    const d = fs.existsSync(w) ? (gitOut(w, ['status', '--porcelain']) ? 'unsaved' : 'saved') : 'missing';
    out(`  ${t} | workspace: ${d} | gate: ${g} | ${gitOut(r, ['diff', '--shortstat', `refs/firstmate/${t}/base`, `refs/firstmate/${t}/head`]).trim()}`);
  }
}

function clean(repoArg, which) {
  const r = needRepo(repoArg);
  const tasks = which === '--all' ? taskNames(r, /^refs\/firstmate\/([^/]*)\//) : [taskName(which)];
  for (const t of tasks) {
    const w = path.join(r, '.firstmate', 'wt', t);
    if (fs.existsSync(w)) git(r, ['worktree', 'remove', '--force', w]);
    for (const k of ['base', 'head']) git(r, ['update-ref', '-d', `refs/firstmate/${t}/${k}`]);
    for (const f of [`${t}.gate`, `${t}.gate.log`]) fs.rmSync(path.join(r, '.firstmate', 'notes', f), { force: true });
    out(`[fm] removed task ${t}`);
  }
  git(r, ['worktree', 'prune']);
}

function main(argv) {
  if (argv.length < 2) die('usage: fm.js <init|fact|start|save|gate|deliver|status|clean> <repo> [args] | fm.js shape <brief.md> [--sections] [file]');
  const [cmd, arg, ...rest] = argv;
  switch (cmd) {
    case 'shape': return shape(arg, rest);
    case 'init': return init(arg, rest[0]);
    case 'fact': return fact(arg, rest);
    case 'start': return start(arg, rest[0]);
    case 'save': return save(arg, rest[0], rest[1]);
    case 'gate': return gate(arg, rest[0], rest.slice(1).join(' '));
    case 'deliver': return deliver(arg, rest[0], rest[1]);
    case 'status': return status(arg);
    case 'clean': return clean(arg, rest[0]);
    default: return die(`unknown command '${cmd}'`);
  }
}

try { main(process.argv.slice(2)); }
catch (e) {
  if (e instanceof Exit) process.exitCode = e.code;
  else { process.stderr.write(`[fm] ERROR: ${e.message}\n`); process.exitCode = 2; }
}
