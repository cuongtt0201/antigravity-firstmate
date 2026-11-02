#!/usr/bin/env node
// Installs the flash-ultra (firstmate) plugin into Antigravity's shared config.
//   npx github:<owner>/antigravity-firstmate              install or update
//   npx github:<owner>/antigravity-firstmate --uninstall  remove
//   npx github:<owner>/antigravity-firstmate --check      report what this machine has and lacks; installs nothing
//   npx github:<owner>/antigravity-firstmate --grant      let the first mate run fm.js and read task workspaces
//                                                         without asking (Antigravity's global permission grants)
// No dependencies. Re-running replaces the installed copy (the old one is backed up).

const fs = require('fs');
const os = require('os');
const path = require('path');

const NAME = 'flash-ultra';
const CONFIG_DIR = path.join(os.homedir(), '.gemini', 'config');
const PLUGINS_DIR = path.join(CONFIG_DIR, 'plugins');
const TARGET = path.join(PLUGINS_DIR, NAME);
const CONFIG = path.join(CONFIG_DIR, 'config.json');
const SOURCE = path.join(__dirname, 'plugin');
const TEMPLATED_EXT = new Set(['.md', '.json']);

const log = (m) => console.log(`[firstmate] ${m}`);
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);

function walk(dir, fn) {
  fn(dir, true);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, fn); else fn(p, false);
  }
}

// The installed copy is read-only on purpose (agents may not edit it); unlock before touching it.
function unlock(dir) {
  if (fs.existsSync(dir)) walk(dir, (p, isDir) => fs.chmodSync(p, isDir ? 0o755 : 0o644));
}

function lock(dir) {
  walk(dir, (p, isDir) => {
    if (isDir) return;
    fs.chmodSync(p, p.endsWith('.sh') ? 0o555 : 0o444);
  });
  // Directories last, after their contents are locked.
  const dirs = [];
  walk(dir, (p, isDir) => { if (isDir) dirs.push(p); });
  for (const d of dirs.reverse()) fs.chmodSync(d, 0o555);
}

function editConfig(fn) {
  let cfg = {};
  if (fs.existsSync(CONFIG)) {
    fs.copyFileSync(CONFIG, `${CONFIG}.bak-${NAME}-${stamp()}`);
    cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  }
  fn(cfg);
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
}

// The permissions the first mate needs so Antigravity does not stop to ask before each step (the headless CLI
// cannot ask at all, so it refuses): running fm.js and reading the task workspaces outside the repo. Added only
// with --grant; uninstall takes back exactly these.
function grants() {
  const slash = (p) => p.split(path.sep).join('/');
  return [`command(node ${slash(TARGET)}/scripts/fm.js)`, `read_file(${slash(require('./plugin/scripts/fm-paths.js').wtRoot())})`];
}
function grantedAll() {
  try { const allow = JSON.parse(fs.readFileSync(CONFIG, 'utf8')).userSettings.globalPermissionGrants.allow; return grants().every((g) => allow.includes(g)); } catch { return false; }
}

function grant() {
  editConfig((cfg) => {
    const us = (cfg.userSettings = cfg.userSettings || {});
    const g = (us.globalPermissionGrants = us.globalPermissionGrants || {});
    g.allow = Array.isArray(g.allow) ? g.allow : [];
    for (const x of grants()) if (!g.allow.includes(x)) g.allow.push(x);
  });
  log(`granted in ${CONFIG}:`);
  for (const x of grants()) log(`  ${x}`);
  log('the guard still checks every command; uninstall takes these back');
}

const WIN = process.platform === 'win32';
// Prefer a stable node path: process.execPath is often a versioned Cellar path that breaks on upgrade.
// On Windows the installer puts node on PATH and the hooks call it as `node` (a quoted program path
// does not start a command in PowerShell).
function nodePath() {
  if (WIN) return process.execPath;
  return ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'].find((p) => fs.existsSync(p)) || process.execPath;
}

function install() {
  const node = nodePath();
  // The hooks need node:sqlite (Node 22.13+). Without it they fail open and the guard would allow everything.
  try {
    require('child_process').execFileSync(node, ['-e', "require('node:sqlite')"], { stdio: 'ignore', timeout: 10000 });
  } catch {
    throw new Error(`${node} has no node:sqlite; the hooks need Node.js 22.13 or newer (found ${(() => { try { return require('child_process').execFileSync(node, ['--version'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })()})`);
  }

  // Windows hook commands carry the plugin path unquoted (see below), so it cannot have a space.
  if (WIN && TARGET.includes(' ')) throw new Error(`${TARGET} has a space; Windows hook commands cannot quote the plugin path`);

  if (fs.existsSync(TARGET)) {
    const backup = path.join(os.tmpdir(), `${NAME}-backup-${stamp()}`);
    unlock(TARGET);
    fs.cpSync(TARGET, backup, { recursive: true });
    fs.rmSync(TARGET, { recursive: true, force: true });
    log(`previous version backed up to ${backup}`);
  }

  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  fs.cpSync(SOURCE, TARGET, { recursive: true });
  // Fill machine-specific paths into every manifest, agent and skill that mentions them. Forward slashes
  // on Windows too: node and git accept them, and they need no escaping in JSON or Markdown.
  const dir = TARGET.split(path.sep).join('/');
  walk(TARGET, (f, isDir) => {
    if (isDir || !TEMPLATED_EXT.has(path.extname(f))) return;
    let text = fs.readFileSync(f, 'utf8');
    if (!text.includes('{{')) return;
    // Windows hook commands: plain `node` from PATH, unquoted script paths (the App passes the quotes
    // through to node, which then resolves `"C:/..."` as a relative path), and no `|| echo` fallback
    // (Windows PowerShell 5.1 has no ||)
    if (WIN && path.basename(f) === 'hooks.json') text = text.replaceAll('\\"{{NODE}}\\"', 'node').replace(/\\"({{PLUGIN_DIR}}[^"\\]*)\\"/g, '$1').replace(/ \|\| echo '[^']*'/g, '');
    fs.writeFileSync(f, text.replaceAll('{{PLUGIN_DIR}}', dir).replaceAll('{{NODE}}', node.split(path.sep).join('/')));
  });
  lock(TARGET);

  editConfig((cfg) => {
    cfg.plugins = cfg.plugins || {};
    cfg.plugins[NAME] = { ...(cfg.plugins[NAME] || {}), enabled: true };
  });

  const version = JSON.parse(fs.readFileSync(path.join(SOURCE, 'plugin.json'), 'utf8')).version;
  log(`installed ${NAME} v${version} -> ${TARGET}`);
  log('next: restart Antigravity (IDE or App). In the IDE, type /firstmate in a chat; in the App, RE-SELECT the');
  log('      firstmate agent (pick another agent, then firstmate again): the App keeps a snapshot of the selected');
  log("      agent's prompt until you re-select it. The crew runs through agy (check: node install.js --check).");
  if (!grantedAll()) log('      To let the first mate run fm.js and read task workspaces without asking each time, run this again with --grant.');
}

// What the plugin needs, checked without changing anything. Exit code 1 when something required is missing.
function check() {
  const { spawnSync } = require('child_process');
  const win = process.platform === 'win32';
  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 10000 });
    return r.status === 0 ? String(r.stdout || r.stderr).trim().split('\n')[0] : null;
  };
  const rows = [];
  let missing = 0;
  const add = (state, what, detail) => { rows.push(`  ${state.padEnd(8)} ${what.padEnd(26)} ${detail || ''}`); if (state === 'MISSING') missing += 1; };

  add('OK', 'operating system', `${process.platform} ${os.release()}`);
  const nodeAt = nodePath();
  const nodeVer = run(nodeAt, ['--version']);
  const sqlite = run(nodeAt, ['-e', "require('node:sqlite');console.log('ok')"]) === 'ok';
  add(sqlite ? 'OK' : 'MISSING', 'node with node:sqlite', `${nodeAt} ${nodeVer || '?'}${sqlite ? '' : ' (needs Node.js 22.13 or newer)'}`);
  if (win) { const onPath = run('node', ['--version']); add(onPath ? 'OK' : 'MISSING', 'node on PATH', onPath || 'the hooks call `node`; add the Node.js folder to PATH'); }
  const git = run('git', ['--version']);
  add(git ? 'OK' : 'MISSING', 'git', git || 'install git');
  for (const [cmd, args] of [['helm', ['version', '--short']], ['terraform', ['version']], ['terragrunt', ['--version']], ['hadolint', ['--version']], [win ? 'python' : 'python3', ['--version']]]) {
    const v = run(cmd, args); add(v ? 'OK' : 'OPTIONAL', cmd, v || 'not found; its checks are skipped');
  }
  const agyAt = require('./plugin/scripts/fm-crew.js').agyPath();
  const agy = run(agyAt, ['--version']) || (fs.existsSync(agyAt) ? 'present' : null);
  add(agy ? 'OK' : 'MISSING', 'agy (Antigravity CLI)', agy ? `${agyAt} ${agy}` : 'fm.js crew runs the crew with it; install the Antigravity CLI (it puts agy in ~/.gemini/bin)');
  const wt = require('./plugin/scripts/fm-paths.js').wtRoot();
  let wtOk = false; let probe = wt;
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe); // the check creates nothing
  try { fs.accessSync(probe, fs.constants.W_OK); wtOk = true; } catch {}
  add(wtOk ? 'OK' : 'MISSING', 'task workspaces', `${wt}${wtOk ? '' : ' is not writable; set FM_WT_ROOT'}`);
  for (const app of ['/Applications/Antigravity IDE.app', '/Applications/Antigravity.app']) if (process.platform === 'darwin' && fs.existsSync(app)) add('NOTE', path.basename(app, '.app'), app);
  if (win) add('NOTE', 'terminal shell', `ComSpec=${process.env.ComSpec || '?'}; PowerShell ${run('powershell', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']) || 'not found'}`);
  add(fs.existsSync(CONFIG_DIR) ? 'OK' : 'MISSING', 'Antigravity config folder', CONFIG_DIR);
  let installed = 'not installed';
  try { installed = JSON.parse(fs.readFileSync(path.join(TARGET, 'plugin.json'), 'utf8')).version; } catch {}
  add('NOTE', 'installed plugin', `${installed} at ${TARGET}`);
  let enabled = false;
  try { enabled = !!JSON.parse(fs.readFileSync(CONFIG, 'utf8')).plugins[NAME].enabled; } catch {}
  add('NOTE', 'enabled in config.json', String(enabled));
  add('NOTE', 'crew permissions', grantedAll() ? 'granted: fm.js runs and task workspaces are read without asking' : 'not set: Antigravity asks before each fm.js call (the headless CLI refuses); add them with --grant');

  console.log(`[firstmate] check (installs nothing), this package: v${JSON.parse(fs.readFileSync(path.join(SOURCE, 'plugin.json'), 'utf8')).version}`);
  console.log(rows.join('\n'));
  console.log(missing ? `[firstmate] ${missing} required item(s) missing` : '[firstmate] everything required is present');
  if (missing) process.exitCode = 1;
}

function uninstall() {
  if (fs.existsSync(TARGET)) {
    unlock(TARGET);
    fs.rmSync(TARGET, { recursive: true, force: true });
    log(`removed ${TARGET}`);
  } else {
    log('plugin folder not found, nothing to remove');
  }
  if (fs.existsSync(CONFIG)) {
    editConfig((cfg) => {
      if (cfg.plugins) delete cfg.plugins[NAME];
      const g = cfg.userSettings && cfg.userSettings.globalPermissionGrants;
      if (g && Array.isArray(g.allow)) g.allow = g.allow.filter((x) => !grants().includes(x));
    });
    log('removed the plugin entry and its permission grants from config.json');
  }
}

try {
  if (process.argv.includes('--check')) check();
  else if (process.argv.includes('--uninstall')) uninstall();
  else if (process.argv.includes('--grant')) grant();
  else install();
} catch (e) {
  console.error(`[firstmate] ERROR: ${e.message}`);
  process.exit(1);
}
