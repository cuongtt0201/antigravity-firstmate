// Shared by guard.js and inject.js: per-chat state, the first mate's read budget, and the agent a chat runs.
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_DIR = process.env.FM_STATE_DIR || path.join(os.tmpdir(), 'flash-ultra-loop-guard');
const CONVO_DB = process.env.FM_CONVO_DB || path.join(os.homedir(), '.gemini', 'antigravity', 'conversation_summaries.db');
const BRAIN_DIR = process.env.FM_BRAIN_DIR || path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
const STATE_TTL_MS = 24 * 60 * 60 * 1000;
const PLUGIN_DIR = path.resolve(__dirname, '..');
const DIRECT_MAX = 6; // first mate's own reads/commands per captain message
const BUDGET_IDLE_RESET_MS = 5 * 60 * 1000; // fallback reset when no new-message signal arrives

const convoKey = (id) => String(id || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
const stateFile = (id, ext) => path.join(STATE_DIR, `${convoKey(id)}.${ext}`);

// Hook payloads carry the common fields either at the top level or under one wrapper object.
function unwrap(p) {
  if (!p || typeof p !== 'object') return {};
  if (p.conversationId || p.toolCall) return p;
  for (const v of Object.values(p)) if (v && typeof v === 'object' && (v.conversationId || v.toolCall)) return v;
  return p;
}

function loadState(id) {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(id, 'json'), 'utf8'));
    if (Date.now() - (s.t || 0) < STATE_TTL_MS) return s;
  } catch {}
  return {};
}

// Write to a temp file and rename, so a concurrent reader never sees a half-written file.
function saveState(id, st) {
  st.t = Date.now();
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const file = stateFile(id, 'json');
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(st));
  fs.renameSync(tmp, file);
}

function budgetLog(id, what) {
  try { fs.appendFileSync(path.join(STATE_DIR, 'budget.log'), `${new Date().toISOString()} ${convoKey(id)} ${what}\n`); } catch {}
}

// The budget is an append-only file (one line per direct read), so parallel guard processes never lose a count.
function resetBudget(id, why) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(stateFile(id, 'direct'), '');
  budgetLog(id, `reset ${why}`);
}
function spendBudget(id, n) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const file = stateFile(id, 'direct');
  try {
    if (Date.now() - fs.statSync(file).mtimeMs > BUDGET_IDLE_RESET_MS) resetBudget(id, 'idle');
  } catch {}
  fs.appendFileSync(file, '1\n'.repeat(n));
  return budgetUsed(id);
}
function budgetUsed(id) {
  try { return fs.readFileSync(stateFile(id, 'direct'), 'utf8').length / 2; } catch { return 0; }
}

// Step index of the captain's latest message, read from the tail of the chat transcript, or undefined.
// Subagent reports and background-task completions also start new executions; only a USER_INPUT step
// is a new captain message.
function lastUserStep(id, ev) {
  const files = [path.join(BRAIN_DIR, String(id), '.system_generated', 'logs', 'transcript.jsonl'), ev && ev.transcriptPath].filter(Boolean);
  for (const f of files) {
    try {
      const fd = fs.openSync(f, 'r');
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, 512 * 1024);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      fs.closeSync(fd);
      const lines = buf.toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"USER_INPUT"')) continue;
        try { const d = JSON.parse(lines[i]); if (d.type === 'USER_INPUT') return d.step_index; } catch {}
      }
    } catch {}
  }
  return undefined;
}

// The agent a chat runs (firstmate, worker, explorer, checker, or '' for the default agent), read from
// the App's conversation index. A row with an empty agent name is cached as 'none'. The App indexes a
// chat only after its first model call, so a chat that is not indexed yet and runs on Argon is treated
// as a first mate (not cached); a missing row is retried on the next call.
function agentOf(id, st, model) {
  if (!st.agent && id) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(CONVO_DB, { readOnly: true });
      const row = db.prepare('select agent_name from conversation_summaries where conversation_id = ?').get(String(id));
      db.close();
      if (row) st.agent = row.agent_name || 'none';
    } catch {}
  }
  if (!st.agent) return /argon/i.test(String(model || '')) ? 'firstmate' : '';
  return st.agent !== 'none' ? st.agent : '';
}

module.exports = { STATE_DIR, PLUGIN_DIR, DIRECT_MAX, unwrap, loadState, saveState, agentOf, lastUserStep, resetBudget, spendBudget, budgetUsed, budgetLog };
