// firstmate: which models this Antigravity account can use right now, so no run starts on a model that cannot answer.
// `agy models` lists the models the account offers (kept a day). `agy -p /usage` gives each quota group's share left
// and when it comes back, without spending tokens (kept five minutes, dropped after a failed run). The groups are
// separate: Gemini (Flash, Pro), Claude and GPT, and Gemini 4 Argon. A model may run when the account offers it and
// its group has more than `quotaReserve` left. When agy cannot tell, every model may run.
//   fm.js quota [<repo>]   every group, what is left, when an empty one comes back, and which roles it serves

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { fmHome, agyPath } = require('./fm-paths.js');

const cacheFile = () => path.join(fmHome(), 'quota.json');
const ttlMs = (sec) => (process.env.FM_QUOTA_TTL_SEC !== undefined ? Number(process.env.FM_QUOTA_TTL_SEC) : sec) * 1000;
// model id → its quota group, matched on the group names agy /usage gives; Argon is checked before the other Geminis
const GROUP_OF = [[/argon/i, /argon/i], [/^gemini/i, /^gemini models$/i], [/claude|gpt/i, /claude|gpt/i]];

function agy(args) {
  const a = agyPath();
  const [cmd, argv] = a.endsWith('.js') ? [process.execPath, [a, ...args]] : [a, args];
  const r = spawnSync(cmd, argv, { cwd: os.tmpdir(), encoding: 'utf8', timeout: 30000, windowsHide: true });
  return r.status === 0 ? String(r.stdout || '') : '';
}
function readCache() { try { return JSON.parse(fs.readFileSync(cacheFile(), 'utf8')); } catch { return {}; } }
function writeCache(patch) { try { fs.mkdirSync(fmHome(), { recursive: true }); fs.writeFileSync(cacheFile(), JSON.stringify({ ...readCache(), ...patch })); } catch {} }

// The model ids the account offers, or null when agy cannot tell.
function offered() {
  const c = readCache();
  if (c.modelsAt && Date.now() - c.modelsAt < ttlMs(86400)) return c.models;
  const ids = agy(['models']).split('\n').map((l) => (l.match(/^([\w.-]+)\t/) || [])[1]).filter(Boolean);
  const models = ids.length ? ids : null;
  writeCache({ models, modelsAt: Date.now() });
  return models;
}

// [{ name, left (the lowest share of its buckets), reset (when that bucket comes back), buckets }], or null.
function groups() {
  const c = readCache();
  if (c.groupsAt && Date.now() - c.groupsAt < ttlMs(300)) return c.groups;
  let gs = null;
  try {
    const j = JSON.parse(agy(['-p', '/usage', '--output-format', 'json']).trim().split('\n').filter(Boolean).pop());
    gs = j.command.data.groups.map((g) => {
      const buckets = (g.buckets || []).map((b) => ({ window: b.window || b.id, left: Number(b.remaining_fraction), reset: b.reset_time || '' }));
      const low = buckets.slice().sort((x, y) => x.left - y.left)[0] || { left: 1, reset: '' };
      return { name: g.name, left: low.left, reset: low.reset, buckets };
    });
  } catch { gs = null; }
  writeCache({ groups: gs, groupsAt: Date.now() });
  return gs;
}

// After a failed run the quota may have run out: ask agy again next time.
function forget() { writeCache({ groupsAt: 0 }); }

function groupOf(id, gs) {
  for (const [m, g] of GROUP_OF) if (m.test(id)) return (gs || []).find((x) => g.test(x.name)) || null;
  return null;
}

const reserveOf = (cfg) => (cfg && cfg.quotaReserve !== undefined ? Number(cfg.quotaReserve) : 0.02);

// { ok } or { ok: false, why, quota (true when it comes back on its own), until }
function usable(id, cfg) {
  const list = offered();
  if (list && !list.includes(id)) return { ok: false, why: 'not offered on this account (agy models)', quota: false };
  const g = groupOf(id, groups());
  if (g && g.left <= reserveOf(cfg)) return { ok: false, why: `${g.name} quota at ${Math.round(g.left * 100)}% until ${g.reset}`, quota: true, until: g.reset };
  return { ok: true };
}

function describe(cfg) {
  const gs = groups();
  if (!gs) return ['[fm] quota: agy did not say (agy -p /usage); every model may run'];
  const keys = Object.entries((cfg && cfg.models) || {});
  return ['[fm] quota (agy -p /usage):', ...gs.map((g) => {
    const users = keys.filter(([, id]) => groupOf(id, gs) === g).map(([k]) => k);
    const left = g.buckets.map((b) => `${b.window} ${Math.round(b.left * 100)}%`).join(', ');
    return `  ${g.name.padEnd(22)} ${left}${g.left <= reserveOf(cfg) ? ` | EMPTY until ${g.reset}` : ''} | used for: ${users.join(', ') || '-'}`;
  })];
}

module.exports = { usable, forget, describe, offered, groups };
