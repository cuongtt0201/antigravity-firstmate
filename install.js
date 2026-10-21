#!/usr/bin/env node
// Installs the flash-ultra (firstmate) plugin into Antigravity's shared config.
//   npx github:<owner>/antigravity-firstmate              install or update
//   npx github:<owner>/antigravity-firstmate --uninstall  remove
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
  log('next: restart the Antigravity App, then see README "After installing".');
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
  if (process.argv.includes('--uninstall')) uninstall(); else install();
} catch (e) {
  console.error(`[firstmate] ERROR: ${e.message}`);
  process.exit(1);
}
