// firstmate: settings. Defaults, then $FM_HOME/config.json (this machine), then <repo>/.firstmate/config.json
// (this repo). Top-level keys replace; checks, models and caps merge one level deeper.
//   fm.js config <repo> [key [value]]   print everything, print one key, or set one key for the repo

const fs = require('fs');
const path = require('path');
const { fmHome } = require('./fm-paths.js');

const DEFAULTS = {
  merge: 'apply', // propose | apply | commit
  protectedBranches: ['main', 'master', 'release/*'],
  commitOnProtected: false,
  checks: {}, // typecheck, lint, test: commands the gate runs after the per-file checks
  checkTimeoutSec: 600,
  portBase: 3100,
  packs: ['core', 'devops'],
  models: { fast: 'flash', standard: 'flash', strong: 'argon' },
  caps: { perCall: 6, crewPerDay: 40, judgePerDay: 15 },
  autoMergeMaxRisk: 'medium', // highest risk merged without the captain: low | medium
  handoffAtTokens: 150000,
};
const NESTED = ['checks', 'models', 'caps'];

function readJson(file) {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
const globalFile = () => path.join(fmHome(), 'config.json');
const repoFile = (repo) => path.join(repo, '.firstmate', 'config.json');

function merge(base, over) {
  const res = { ...base };
  for (const [k, v] of Object.entries(over)) res[k] = NESTED.includes(k) && v && typeof v === 'object' && !Array.isArray(v) ? { ...(base[k] || {}), ...v } : v;
  return res;
}

function loadConfig(repo) {
  let cfg = merge(JSON.parse(JSON.stringify(DEFAULTS)), readJson(globalFile()));
  if (repo) cfg = merge(cfg, readJson(repoFile(repo)));
  return cfg;
}

function parseValue(v) { try { return JSON.parse(v); } catch { return v; } }

function setRepoConfig(repo, key, value) {
  const file = repoFile(repo);
  const cfg = readJson(file);
  const parts = String(key).split('.');
  let o = cfg;
  for (const p of parts.slice(0, -1)) { if (!o[p] || typeof o[p] !== 'object') o[p] = {}; o = o[p]; }
  o[parts[parts.length - 1]] = parseValue(value);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`);
}

function getKey(cfg, key) {
  let v = cfg;
  for (const p of String(key).split('.')) v = v && typeof v === 'object' ? v[p] : undefined;
  return v;
}
const show = (v) => (v === undefined ? '' : Array.isArray(v) ? v.join(',') : typeof v === 'object' ? JSON.stringify(v) : String(v));

module.exports = { DEFAULTS, loadConfig, setRepoConfig, getKey, show };
