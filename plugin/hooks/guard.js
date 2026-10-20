#!/usr/bin/env node
// flash-ultra guard (PreToolUse). Two jobs, nothing else:
//  1. Loop guard: deny the 4th identical read of a file that has not changed since, and nudge
//     once after 40 read/search calls in a row with no edit or command.
//  2. Tamper protection: agents may not edit or disable this plugin or the hook config.
// Fails open: any error → allow.

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_SAME_READ = 3;
const MAX_READ_STREAK = 40;
const STATE_DIR = path.join(os.tmpdir(), 'flash-ultra-loop-guard');
const STATE_TTL_MS = 24 * 60 * 60 * 1000;

const READ_TOOLS = new Set(['read_file', 'view_file', 'view_file_outline', 'view_code_item', 'grep_search', 'find_by_name', 'list_dir', 'codebase_search']);
const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'write_to_file', 'replace_file_content', 'multi_replace_file_content', 'create_file']);
const PROTECTED_RE = /\.gemini[\\/]+config[\\/]+(plugins[\\/]+flash-ultra|hooks\.json|config\.json)|flash-ultra[\\/]+(hooks|agents|plugin\.json)|guard\.js/;

const out = (obj) => { process.stdout.write(JSON.stringify(obj)); process.exit(0); };
const allow = () => out({ decision: 'allow' });

function parseArgs(a) {
  if (typeof a === 'string') { try { return JSON.parse(a); } catch { return {}; } }
  return a && typeof a === 'object' ? a : {};
}
function pick(obj, keys) {
  for (const k of keys) if (typeof obj[k] === 'string' && obj[k]) return obj[k];
  return '';
}

function main() {
  const raw = fs.readFileSync(0, 'utf8');
  if (!raw.trim()) return allow();
  const p = JSON.parse(raw);
  const ev = p.preToolHookArgs || p.toolHookArgs || p;
  const call = ev.toolCall || {};
  const tool = call.name || ev.tool_name || '';
  const args = parseArgs(call.args !== undefined ? call.args : ev.tool_input);
  if (!tool) return allow();

  // Running the plugin's own firstmate scripts is allowed, also inside a chained command: the script
  // calls are blanked out first, so any other mention of the plugin path in the command is still denied.
  const cmd = String(args.CommandLine || args.command || '');
  const FM_CALL_RE = /\bbash\s+\S*flash-ultra\/scripts\/fm-(init|status|merge)\.sh\b/g;
  const subject = tool === 'run_command' ? `${cmd.replace(FM_CALL_RE, 'bash fm-script')} ${args.Cwd || ''}` : JSON.stringify(args);
  if ((WRITE_TOOLS.has(tool) || tool === 'run_command') && PROTECTED_RE.test(subject)) {
    return out({ decision: 'deny', reason: '[guard] This is the user\'s guardrail (flash-ultra plugin / hook config). You may not modify or disable it. If you are blocked, tell the user.' });
  }

  // Pin worker subagents to Flash. The app's system prompt tends to pass "Model":"inherit",
  // which overrides the agent file's `model: flash` (antigravity-cli #1195) and would run the
  // workers on the expensive orchestrator model. `overwrite` is shallow-merged into the args.
  const FLASH_AGENTS = /^(worker|checker)$/;
  let overwrite = null;
  if (tool === 'invoke_subagent') {
    if (Array.isArray(args.Subagents)) {
      if (args.Subagents.some((s) => FLASH_AGENTS.test(String(s && s.TypeName)))) {
        overwrite = { Subagents: args.Subagents.map((s) => (s && FLASH_AGENTS.test(String(s.TypeName)) ? { ...s, Model: 'flash' } : s)) };
      }
    } else if (FLASH_AGENTS.test(String(args.TypeName))) {
      overwrite = { Model: 'flash' };
    }
  }

  const convo = String(ev.conversationId || p.conversationId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const file = path.join(STATE_DIR, `${convo}.json`);
  let st = { reads: {}, streak: 0 };
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - (s.t || 0) < STATE_TTL_MS) st = { reads: s.reads || {}, streak: s.streak || 0, model: s.model };
  } catch {}

  // Record which model each conversation runs on (first sighting), to verify model routing.
  const model = ev.modelName || p.modelName;
  if (model && st.model !== model) {
    st.model = model;
    try { fs.appendFileSync(path.join(STATE_DIR, 'models.log'), `${new Date().toISOString()} ${convo} ${model}\n`); } catch {}
  }

  let decision = { decision: 'allow' };
  const target = pick(args, ['Path', 'AbsolutePath', 'TargetFile', 'filePath', 'path']);
  if (WRITE_TOOLS.has(tool)) {
    // A write changes the file, so re-reading it is legitimate again.
    for (const k of Object.keys(st.reads)) if (!target || k.startsWith(target + '#')) delete st.reads[k];
    st.streak = 0;
  } else if (tool === 'run_command' || tool === 'invoke_subagent') {
    st.streak = 0;
  } else if (READ_TOOLS.has(tool)) {
    st.streak += 1;
    if ((tool === 'read_file' || tool === 'view_file') && target) {
      const range = `${args.StartLine ?? args.Offset ?? ''}-${args.EndLine ?? args.Limit ?? ''}`;
      const key = `${target}#${range}`;
      st.reads[key] = (st.reads[key] || 0) + 1;
      if (st.reads[key] > MAX_SAME_READ) {
        decision = { decision: 'deny', reason: `[loop-guard] You already read ${path.basename(target)} (${range === '-' ? 'whole file' : 'lines ' + range}) ${st.reads[key] - 1} times and it has not changed. Do not read it again: act on what you know (edit, run the check, or write notes to a file).` };
      }
    }
    if (decision.decision === 'allow' && st.streak > MAX_READ_STREAK) {
      decision = { decision: 'deny', reason: `[loop-guard] ${st.streak - 1} read/search calls in a row with no edit or command — you are probably looping. Summarize what you found in a notes file, then act on it.` };
      st.streak = 0;
    }
  }
  st.t = Date.now();
  fs.writeFileSync(file, JSON.stringify(st));
  if (overwrite && decision.decision === 'allow') decision.overwrite = overwrite;
  out(decision);
}

try { main(); } catch { allow(); }
