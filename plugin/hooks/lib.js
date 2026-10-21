// Shared by guard.js and inject.js: per-chat state and the agent a chat runs.
const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_DIR = process.env.FM_STATE_DIR || path.join(os.tmpdir(), 'flash-ultra-loop-guard');
const CONVO_DB = process.env.FM_CONVO_DB || path.join(os.homedir(), '.gemini', 'antigravity', 'conversation_summaries.db');
const STATE_TTL_MS = 24 * 60 * 60 * 1000;
const PLUGIN_DIR = path.resolve(__dirname, '..');

const convoKey = (id) => String(id || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');

// Hook payloads carry the common fields either at the top level or under one wrapper object.
function unwrap(p) {
  if (!p || typeof p !== 'object') return {};
  if (p.conversationId || p.toolCall) return p;
  for (const v of Object.values(p)) if (v && typeof v === 'object' && (v.conversationId || v.toolCall)) return v;
  return p;
}

function loadState(id) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(STATE_DIR, `${convoKey(id)}.json`), 'utf8'));
    if (Date.now() - (s.t || 0) < STATE_TTL_MS) return s;
  } catch {}
  return {};
}

function saveState(id, st) {
  st.t = Date.now();
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(STATE_DIR, `${convoKey(id)}.json`), JSON.stringify(st));
}

// The agent a chat runs (firstmate, worker, explorer, checker, or '' when unknown), read from the
// App's conversation index. Only a found name is cached, so a chat not yet indexed is retried.
function agentOf(id, st) {
  if (st.agent) return st.agent;
  if (!id) return '';
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(CONVO_DB, { readOnly: true });
    const row = db.prepare('select agent_name from conversation_summaries where conversation_id = ?').get(String(id));
    db.close();
    if (row && row.agent_name) st.agent = row.agent_name;
  } catch {}
  return st.agent || '';
}

module.exports = { STATE_DIR, PLUGIN_DIR, unwrap, loadState, saveState, agentOf };
