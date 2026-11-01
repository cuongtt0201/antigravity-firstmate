#!/usr/bin/env node
// Installs (or removes) the survey plugin fm-probe into a plugins folder.
//   node tools/probe/install.js --target <plugins-dir> [--uninstall]
const fs = require('fs');
const path = require('path');

const i = process.argv.indexOf('--target');
const target = i > 0 ? process.argv[i + 1] : '';
if (!target) { console.error('usage: install.js --target <plugins-dir> [--uninstall]'); process.exit(2); }
const dest = path.join(target, 'fm-probe');
if (process.argv.includes('--uninstall')) { fs.rmSync(dest, { recursive: true, force: true }); console.log(`[probe] removed ${dest}`); process.exit(0); }
fs.mkdirSync(target, { recursive: true });
fs.cpSync(path.join(__dirname, 'plugin'), dest, { recursive: true });
fs.copyFileSync(path.join(__dirname, 'probe.js'), path.join(dest, 'probe.js'));
const probeDir = dest.split(path.sep).join('/');
const node = process.execPath.split(path.sep).join('/');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) return walk(p);
  if (!/\.(json|md)$/.test(e.name)) return;
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('{{PROBE_DIR}}', probeDir).replaceAll('{{NODE}}', node));
});
walk(dest);
console.log(`[probe] installed ${dest}; log: ${process.env.FM_PROBE_LOG || '~/.firstmate-probe/log.jsonl'}`);
