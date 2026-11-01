// firstmate: token use of a chat and the subagents it started, read from the chat transcripts.
//   fm.js usage <conversation-id> [--brain <dir>]...
// One row per chat (the main chat first, then each subagent it created), then the share of the strong
// model (anything that is not Flash) in new input, cached input and output.

const fs = require('fs');
const os = require('os');
const path = require('path');

function defaultBrainDirs() {
  if (process.env.FM_BRAIN_DIR) return [process.env.FM_BRAIN_DIR];
  const home = path.join(os.homedir(), '.gemini');
  return ['antigravity', 'antigravity-ide', 'antigravity-cli'].map((d) => path.join(home, d, 'brain'));
}

function modelsLog() {
  return path.join(process.env.FM_STATE_DIR || path.join(os.tmpdir(), 'flash-ultra-loop-guard'), 'models.log');
}

function transcriptOf(id, brainDirs) {
  for (const d of brainDirs) {
    const f = path.join(d, id, '.system_generated', 'logs', 'transcript.jsonl');
    if (fs.existsSync(f)) return f;
  }
  return null;
}

function readSteps(file) {
  const steps = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { steps.push(JSON.parse(line)); } catch {}
  }
  return steps;
}

// model per conversation from the guard's models.log (last sighting wins)
function readModels(file) {
  const m = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const p = line.trim().split(/\s+/);
      if (p.length >= 3) m[p[1]] = p.slice(2).join(' ');
    }
  } catch {}
  return m;
}

function sum(steps) {
  const t = { calls: 0, newIn: 0, cacheRead: 0, out: 0 };
  for (const d of steps) {
    if (d.type !== 'PLANNER_RESPONSE') continue;
    t.calls += 1;
    t.newIn += Number(d.input_tokens) || 0;
    t.cacheRead += Number(d.cache_read_tokens) || 0;
    t.out += Number(d.output_tokens) || 0;
  }
  return t;
}

// subagents a chat created, from the tool results that follow invoke_subagent
function childrenOf(steps) {
  const ids = [];
  for (const d of steps) {
    if (d.type !== 'GENERIC' || typeof d.content !== 'string' || !d.content.includes('conversationId')) continue;
    for (const m of d.content.matchAll(/"conversationId"\s*:\s*"([^"]+)"/g)) if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

const strong = (row) => (row.model === '?' ? row.role === 'main' : !/flash/i.test(row.model));

function usage(id, opts = {}) {
  const brainDirs = opts.brainDirs && opts.brainDirs.length ? opts.brainDirs : defaultBrainDirs();
  const models = readModels(opts.modelsLog || modelsLog());
  const main = transcriptOf(id, brainDirs);
  if (!main) return null;
  const mainSteps = readSteps(main);
  const rows = [{ id, role: 'main', model: models[id] || '?', missing: false, ...sum(mainSteps) }];
  for (const c of childrenOf(mainSteps)) {
    const f = transcriptOf(c, brainDirs);
    rows.push({ id: c, role: 'sub', model: models[c] || '?', missing: !f, ...(f ? sum(readSteps(f)) : sum([])) });
  }
  const pct = (k) => {
    const all = rows.reduce((a, r) => a + r[k], 0);
    const s = rows.filter(strong).reduce((a, r) => a + r[k], 0);
    return all ? Math.floor((100 * s) / all) : 0;
  };
  return { rows, share: { newIn: pct('newIn'), cacheRead: pct('cacheRead'), out: pct('out') } };
}

function formatUsage(res) {
  const lines = res.rows.map((r) => `${r.id} ${r.role} ${r.model} calls=${r.calls} new_in=${r.newIn} cache=${r.cacheRead} out=${r.out}${r.missing ? ' (transcript missing)' : ''}`);
  lines.push(`strong share: new_in ${res.share.newIn}%, cache ${res.share.cacheRead}%, out ${res.share.out}%`);
  return lines.join('\n');
}

module.exports = { usage, formatUsage, defaultBrainDirs };
