#!/usr/bin/env node
// Installs the flash-ultra (firstmate) plugin into Antigravity's shared config.
//   npx github:<owner>/antigravity-firstmate              install or update
//   npx github:<owner>/antigravity-firstmate --uninstall  remove
//   npx github:<owner>/antigravity-firstmate --check      report what this machine has and lacks; installs nothing
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

function install() {
  // Prefer a stable node path: process.execPath is often a versioned Cellar path that breaks on upgrade.
  const node = ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'].find((p) => fs.existsSync(p)) || process.execPath;
  if (/\s/.test(TARGET) || /\s/.test(node)) {
    throw new Error(`paths with spaces are not supported by the hook command: ${TARGET} / ${node}`);
  }
  // The hooks need node:sqlite (Node 22.13+). Without it they fail open and the guard would allow everything.
  try {
    require('child_process').execFileSync(node, ['-e', "require('node:sqlite')"], { stdio: 'ignore', timeout: 10000 });
  } catch {
    throw new Error(`${node} has no node:sqlite; the hooks need Node.js 22.13 or newer (found ${(() => { try { return require('child_process').execFileSync(node, ['--version'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; } })()})`);
  }

  if (fs.existsSync(TARGET)) {
    const backup = path.join(os.tmpdir(), `${NAME}-backup-${stamp()}`);
    unlock(TARGET);
    fs.cpSync(TARGET, backup, { recursive: true });
    fs.rmSync(TARGET, { recursive: true, force: true });
    log(`previous version backed up to ${backup}`);
  }

  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  fs.cpSync(SOURCE, TARGET, { recursive: true });
  // Fill machine-specific paths into every manifest, agent and skill that mentions them.
  walk(TARGET, (f, isDir) => {
    if (isDir || !TEMPLATED_EXT.has(path.extname(f))) return;
    const text = fs.readFileSync(f, 'utf8');
    if (text.includes('{{')) fs.writeFileSync(f, text.replaceAll('{{PLUGIN_DIR}}', TARGET).replaceAll('{{NODE}}', node));
  });
  lock(TARGET);

  editConfig((cfg) => {
    cfg.plugins = cfg.plugins || {};
    cfg.plugins[NAME] = { ...(cfg.plugins[NAME] || {}), enabled: true };
  });

  const version = JSON.parse(fs.readFileSync(path.join(SOURCE, 'plugin.json'), 'utf8')).version;
  log(`installed ${NAME} v${version} -> ${TARGET}`);
  log('next: restart the Antigravity App, then RE-SELECT the firstmate agent in the agent picker');
  log('      (pick another agent, then firstmate again). The App keeps a snapshot of the selected');
  log("      agent's prompt and tools, so new chats keep using the old version until you re-select it.");
}

// What the plugin needs, checked without changing anything. Exit code 1 when something required is missing.
function check() {
  const { spawnSync } = require('child_process');
  const win = process.platform === 'win32';
  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 10000, shell: win });
    return r.status === 0 ? String(r.stdout || r.stderr).trim().split('\n')[0] : null;
  };
  const where = (cmd) => run(win ? 'where' : 'which', [cmd]);
  const rows = [];
  let missing = 0;
  const add = (state, what, detail) => { rows.push(`  ${state.padEnd(8)} ${what.padEnd(26)} ${detail || ''}`); if (state === 'MISSING') missing += 1; };

  add(win ? 'NOTE' : 'OK', 'operating system', `${process.platform} ${os.release()}${win ? ' (Windows is not supported yet; this report says what a port needs)' : ''}`);
  const nodeAt = win ? process.execPath : (['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node'].find((p) => fs.existsSync(p)) || process.execPath);
  const nodeVer = run(nodeAt, ['--version']);
  const sqlite = run(nodeAt, ['-e', "require('node:sqlite');console.log('ok')"]) === 'ok';
  add(sqlite ? 'OK' : 'MISSING', 'node with node:sqlite', `${nodeAt} ${nodeVer || '?'}${sqlite ? '' : ' (needs Node.js 22.13 or newer)'}`);
  if (/\s/.test(nodeAt) || /\s/.test(TARGET)) add('MISSING', 'paths without spaces', `${nodeAt} / ${TARGET} (the hook command cannot quote them yet)`);
  const git = run('git', ['--version']);
  add(git ? 'OK' : 'MISSING', 'git', git || 'install git');
  const bash = run('bash', ['--version']);
  add(bash ? 'OK' : 'MISSING', 'bash', bash ? `${bash} (${where('bash') || '?'})` : 'needed by fm.sh (on Windows: Git for Windows provides Git Bash)');
  const ruby = run('ruby', ['--version']);
  add(ruby ? 'OK' : 'OPTIONAL', 'ruby', ruby || 'YAML and helmfile checks are skipped without it');
  for (const [cmd, args] of [['helm', ['version', '--short']], ['terraform', ['version']], ['docker', ['--version']]]) {
    const v = run(cmd, args); add(v ? 'OK' : 'OPTIONAL', cmd, v || 'not found; its checks are skipped');
  }
  if (win) add('NOTE', 'terminal shell', `ComSpec=${process.env.ComSpec || '?'}; PowerShell ${run('powershell', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']) || 'not found'}`);
  add(fs.existsSync(CONFIG_DIR) ? 'OK' : 'MISSING', 'Antigravity config folder', CONFIG_DIR);
  let installed = 'not installed';
  try { installed = JSON.parse(fs.readFileSync(path.join(TARGET, 'plugin.json'), 'utf8')).version; } catch {}
  add('NOTE', 'installed plugin', `${installed} at ${TARGET}`);
  let enabled = false;
  try { enabled = !!JSON.parse(fs.readFileSync(CONFIG, 'utf8')).plugins[NAME].enabled; } catch {}
  add('NOTE', 'enabled in config.json', String(enabled));

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
    editConfig((cfg) => { if (cfg.plugins) delete cfg.plugins[NAME]; });
    log('removed the plugin entry from config.json');
  }
}

try {
  if (process.argv.includes('--check')) check();
  else if (process.platform === 'win32') throw new Error('Windows is not supported yet. Run with --check and send the report to the maintainer.');
  else if (process.argv.includes('--uninstall')) uninstall();
  else install();
} catch (e) {
  console.error(`[firstmate] ERROR: ${e.message}`);
  process.exit(1);
}
