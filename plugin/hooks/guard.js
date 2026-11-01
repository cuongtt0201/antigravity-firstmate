#!/usr/bin/env node
// flash-ultra guard (PreToolUse). Its jobs:
//  1. Tamper protection: agents may not edit or disable this plugin or the hook config.
//  2. Command policy by pack (policy/): core for every developer (no push or publish, no destroying the
//     captain's uncommitted work, no secrets, prod databases ask) and devops (clusters, cloud, buckets are read-only).
//  3. Pin worker/checker subagents to Flash, and cap subagent launches per chat.
//  4. Loop guard: deny the 4th identical read of an unchanged file; nudge after 40 reads in a row.
//  5. First-mate budget: in chats run by the firstmate agent, each read tool call or command counts 1
//     (command text is not parsed). After DIRECT_MAX the injected rules tell it to delegate; HARD_MAX denies.
//  6. Parallel workers each get their own task workspace: one invoke_subagent may not send two workers
//     into the same .firstmate/wt/<task>.
//  7. The crew may run fm.js save and gate, but may not write gate results, notes, facts or task refs itself.
// It is a safety net, not a sandbox: it reads the command text and can be fooled by obfuscation.
// Fails open: any error → allow.

const fs = require('fs');
const path = require('path');
const { STATE_DIR, PLUGIN_DIR, DIRECT_MAX, HARD_MAX, unwrap, loadState, saveState, agentOf, spendBudget } = require('./lib');

const MAX_SAME_READ = 3;
const MAX_READ_STREAK = 40;
const MAX_SUBAGENTS = 12; // per chat per day

const READ_TOOLS = new Set(['read_file', 'view_file', 'view_file_outline', 'view_code_item', 'grep_search', 'find_by_name', 'list_dir', 'codebase_search']);
const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'write_to_file', 'replace_file_content', 'multi_replace_file_content', 'create_file']);
const PROTECTED_RE = /\.gemini[\\/]+config[\\/]+(plugins[\\/]+flash-ultra|hooks\.json|config\.json)|flash-ultra[\\/]+(hooks|agents|plugin\.json)|guard\.js/;
// Paths the first mate may read without spending budget: its facts file and its notes (not task workspaces).
const FREE_PATH_RE = /[\\/]\.firstmate[\\/](facts\.md|notes[\\/])/;
// Records that delivery trusts and only fm.js writes: gate results and notes, facts.md and the settings.
const RECORD_RE = /[\\/]\.firstmate[\\/](facts\.md|config\.json|notes([\\/]|\b))/;
// Commands that change files: redirects into a file, in-place edits, moves, deletes, copies and git changes.
const WRITE_CMD_RE = /(^|[^\w>&-])(\d?>>?|&>)\s*(?!\/dev\/null\b|&\d)[^\s|;&]|\b(sed|perl)\s+(-\w*\s+)*-i|\b(rm|mv|cp|tee|truncate|chmod|chown|ln|mkdir|touch|rsync)\s|\bgit\s+(\S+\s+)*?(checkout|reset|commit|add|stash|clean|restore|apply|merge|rebase|push|cherry-pick|rm|mv)\b|\b(npm|yarn|pnpm|pip|pip3)\s+(install|i|add|remove|uninstall)\b/;
// The plugin's workspace script, `node "<plugin>/scripts/fm.js"` (or the old `bash .../fm.sh`), installed or repo copy.
const PLUGIN_DIR_SRC = PLUGIN_DIR.split(/[\\/]+/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\\\/]+');
const PLUGIN_RE_SRC = `(?:[^"\\s]*flash-ultra|${PLUGIN_DIR_SRC})[\\\\/]+scripts[\\\\/]+fm\\.(?:js|sh)`;
const FM_HEAD_SRC = `\\b(?:bash|node(?:\\.exe)?)\\s+(?:"[^"]*?${PLUGIN_RE_SRC}"|${PLUGIN_RE_SRC})`;
const FM_CALL_RE = new RegExp(FM_HEAD_SRC, 'g'); // the script itself, blanked before the tamper check
const FM_SCRIPT_RE = new RegExp(`${FM_HEAD_SRC}[^&;|\\n]*`, 'g'); // one call with its arguments

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

// ---------- command and write policy, by pack (core always; devops unless the config leaves it out) ----------
const shell = require('./policy/shell');
const core = require('./policy/core');
const devops = require('./policy/devops');
const { repoOfWorkspace } = require('../scripts/fm-paths.js');

function deciders(seg) {
  const s = seg.trim().slice(0, 160);
  return {
    deny: (what) => ({ decision: 'deny', reason: `[guard] "${s}" ${what}. Agents never run this. Give the captain the exact command to run, and continue from the output they paste.` }),
    ask: (what) => ({ decision: 'force_ask', reason: `[guard] "${s}" ${what}; the captain must approve it.` }),
  };
}

// The repo a folder belongs to (the main checkout, also for a task workspace), or ''.
function repoRootOf(dir) {
  if (!dir) return '';
  const ws = repoOfWorkspace(dir);
  if (ws) return ws.repo;
  let d = path.resolve(String(dir));
  for (;;) {
    try { if (fs.statSync(path.join(d, '.git')).isDirectory()) return d; } catch {}
    const up = path.dirname(d);
    if (up === d) return '';
    d = up;
  }
}

function packsFor(dir) {
  try { return require('../scripts/fm-config.js').loadConfig(repoRootOf(dir) || undefined).packs || ['core', 'devops']; } catch { return ['core', 'devops']; }
}

// MCP tools. Only tools whose name reads as a read (get, list, read, search, …, or *read_only*) pass;
// everything else asks the captain, and explorers (read-only) are denied. The name is normalised from
// camelCase and kebab-case, so deleteObject and delete-object are caught. The structure viewer only
// changes what its own panel shows, so it is exempt.
const MCP_READ_VERBS = new Set(['get', 'list', 'read', 'search', 'describe', 'lookup', 'fetch', 'find', 'view', 'answer',
  'count', 'check', 'inspect', 'show', 'explain', 'preview', 'retrieve', 'browse', 'stat', 'head', 'info']);
const MCP_CHANGE_VERBS = new Set(['delete', 'drop', 'create', 'update', 'restore', 'import', 'export', 'commit', 'write',
  'insert', 'clone', 'upgrade', 'cancel', 'patch', 'replace', 'remove', 'truncate', 'move', 'copy', 'deploy', 'send',
  'post', 'put', 'push', 'merge', 'add', 'run', 'execute', 'start', 'stop', 'restart', 'apply', 'grant', 'revoke',
  'rename', 'upload', 'publish', 'archive', 'enable', 'disable', 'reset', 'trigger', 'set', 'modify', 'edit',
  'approve', 'close', 'submit', 'assign', 'invite', 'transfer', 'kill', 'scale', 'rollback', 'download']);
const MCP_EXEMPT_RE = /biomolecular_structure_viewer/i;
const MCP_SERVER_KEYS = ['ServerName', 'serverName', 'server_name', 'Server', 'server'];
const MCP_TOOL_KEYS = ['ToolName', 'toolName', 'tool_name', 'Tool', 'tool', 'Name', 'name', 'Method', 'method'];
const nameWords = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
function mcpTool(tool, args) {
  if (tool === 'call_mcp_tool') {
    const server = MCP_SERVER_KEYS.map((k) => args[k]).find((v) => typeof v === 'string') || '';
    const name = MCP_TOOL_KEYS.map((k) => args[k]).find((v) => typeof v === 'string') || '';
    return { server, name };
  }
  if (tool.startsWith('mcp_')) return { server: '', name: tool };
  return null;
}
// 'read' | 'change' | 'unknown'
function mcpKind(name) {
  if (/(^|_)execute_sql_read_?only$/i.test(name)) return 'read';
  const w = nameWords(name);
  if (w.some((x) => MCP_CHANGE_VERBS.has(x))) return 'change';
  if (w.some((x) => MCP_READ_VERBS.has(x))) return 'read';
  return 'unknown';
}
function mcpPolicy(tool, args, agent) {
  const t = mcpTool(tool, args);
  if (!t) return null;
  const label = `MCP tool "${t.name || '?'}"${t.server ? ` on ${t.server}` : ''}`;
  if (!t.name) return { decision: 'force_ask', reason: `[guard] ${label}: the tool name could not be read; the captain must approve it.` };
  if (MCP_EXEMPT_RE.test(`${t.server} ${t.name}`)) return null;
  const kind = mcpKind(t.name);
  if (kind === 'read') return null;
  if (agent === 'explorer') return { decision: 'deny', reason: `[guard] Explorers are read-only. ${label} is not a read. Report what you would run under OPEN QUESTIONS.` };
  return { decision: 'force_ask', reason: `[guard] ${label} ${kind === 'change' ? 'changes data or infrastructure' : 'is not a recognised read'}; the captain must approve it.` };
}

// The task workspace a brief names, as "<repo-key>/<task>" (workspaces outside the repo, v1) or "<task>"
// (v0.12, inside the repo), lower-cased so Windows paths compare too; '' when the brief names none.
const REPO_KEY_RE = /^[A-Za-z0-9._-]+-[0-9a-f]{8}$/;
function workspaceKey(prompt) {
  const m = String(prompt || '').match(/\.firstmate[\\/]+wt[\\/]+([^\s"'`\\/]+)(?:[\\/]+([^\s"'`\\/]+))?/);
  if (!m) return '';
  return (REPO_KEY_RE.test(m[1]) && m[2] ? `${m[1]}/${m[2]}` : m[1]).toLowerCase();
}

// The task workspace two or more parallel workers in one invoke_subagent call would share, or ''.
function sharedTask(args) {
  if (!Array.isArray(args.Subagents)) return '';
  const seen = new Set();
  for (const s of args.Subagents) {
    if (!s || String(s.TypeName) !== 'worker') continue;
    const k = workspaceKey(s.Prompt || s.prompt);
    if (!k) continue;
    if (seen.has(k)) return k;
    seen.add(k);
  }
  return '';
}

// The locked file a write would change, as { task, path }, or null.
function lockedTarget(tool, args, target, cmd) {
  const { repoOfWorkspace } = require('../scripts/fm-paths.js');
  const where = WRITE_TOOLS.has(tool) ? target : (tool === 'run_command' && WRITE_CMD_RE.test(cmd) ? String(args.Cwd || '') : '');
  if (!where) return null;
  const ws = repoOfWorkspace(where);
  if (!ws) return null;
  let locks = [];
  try { locks = fs.readFileSync(path.join(ws.repo, '.firstmate', 'notes', `${ws.task}.locked`), 'utf8').split('\n').filter(Boolean).map((l) => l.slice(l.indexOf('  ') + 2)); } catch { return null; }
  if (WRITE_TOOLS.has(tool)) {
    const rel = path.relative(ws.root, path.resolve(target)).split(path.sep).join('/');
    return locks.includes(rel) ? { task: ws.task, path: rel } : null;
  }
  const hit = locks.find((p) => cmd.includes(p) || cmd.includes(path.basename(p)));
  return hit ? { task: ws.task, path: hit } : null;
}

function commandPolicy(cmd, cwd0) {
  const secret = core.findSecret(cmd);
  if (secret) return { decision: 'deny', reason: `[guard] This command carries ${secret} in its text. Never put secrets on a command line: the captain stores them (for AWS: aws configure --profile <name>) and commands refer to the profile.` };
  const packs = packsFor(cwd0);
  let cwd = cwd0 ? String(cwd0) : '';
  for (const seg of shell.segments(cmd)) {
    const w = shell.words(seg);
    if (w[0] === 'cd' && w[1]) { cwd = path.resolve(cwd || '.', w[1]); continue; }
    const ctx = { cwd, inWorkspace: !!(cwd && repoOfWorkspace(cwd)) };
    const d = core.judgeCommand(seg, ctx, deciders(seg)) || (packs.includes('devops') ? devops.judge(seg, deciders(seg)) : null);
    if (d) return d;
  }
  return null;
}

function main() {
  const raw = fs.readFileSync(0, 'utf8');
  if (!raw.trim()) return allow();
  const p = JSON.parse(raw);
  const ev = unwrap(p);
  const call = ev.toolCall || {};
  const tool = call.name || ev.tool_name || '';
  const args = parseArgs(call.args !== undefined ? call.args : ev.tool_input);
  if (!tool) return allow();

  // Running the plugin's own workspace script is allowed, also inside a chained command: the script
  // calls are blanked out first, so any other mention of the plugin path in the command is still denied.
  const cmd = String(args.CommandLine || args.command || '');
  const subject = tool === 'run_command' ? `${cmd.replace(FM_CALL_RE, 'bash fm-script')} ${args.Cwd || ''}` : JSON.stringify(args);
  if ((WRITE_TOOLS.has(tool) || tool === 'run_command') && PROTECTED_RE.test(subject)) {
    return out({ decision: 'deny', reason: '[guard] This is the user\'s guardrail (flash-ultra plugin / hook config). You may not modify or disable it. If you are blocked, tell the user.' });
  }
  if (tool === 'run_command') {
    const d = commandPolicy(cmd, args.Cwd);
    if (d) return out(d);
  }
  if (WRITE_TOOLS.has(tool)) {
    const where = pick(args, ['Path', 'AbsolutePath', 'TargetFile', 'filePath', 'path']);
    const d = core.judgeWrite(where, args, deciders(where || tool));
    if (d) return out(d);
  }

  const convoId = ev.conversationId || p.conversationId || '';
  const convo = String(convoId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
  const st = { reads: {}, streak: 0, subagents: 0, ...loadState(convoId) };

  // Record which model each conversation runs on (first sighting), to verify model routing.
  const model = ev.modelName || p.modelName;
  if (model && st.model !== model) {
    st.model = model;
    try { fs.appendFileSync(path.join(STATE_DIR, 'models.log'), `${new Date().toISOString()} ${convo} ${model}\n`); } catch {}
  }

  let decision = { decision: 'allow' };
  // Pin worker subagents to Flash. The app's system prompt tends to pass "Model":"inherit",
  // which overrides the agent file's `model: flash` (antigravity-cli #1195) and would run the
  // workers on the expensive orchestrator model. `overwrite` is shallow-merged into the args.
  const FLASH_AGENTS = /^(worker|checker|explorer)$/;
  let overwrite = null;
  if (tool === 'invoke_subagent') {
    const n = Array.isArray(args.Subagents) ? args.Subagents.length : 1;
    if (st.subagents + n > MAX_SUBAGENTS) {
      decision = { decision: 'deny', reason: `[guard] This chat already launched ${st.subagents} subagents (cap ${MAX_SUBAGENTS} per day). Report what you have to the captain and ask before launching more.` };
    } else if (sharedTask(args)) {
      decision = { decision: 'deny', reason: `[guard] Two or more workers in this call share the task workspace ${sharedTask(args)}. Give each independent part its own task (fm.js start <repo> <task> once per part), then send one worker per task.` };
    } else {
      st.subagents += n;
      if (Array.isArray(args.Subagents)) {
        if (args.Subagents.some((s) => FLASH_AGENTS.test(String(s && s.TypeName)))) {
          overwrite = { Subagents: args.Subagents.map((s) => (s && FLASH_AGENTS.test(String(s.TypeName)) ? { ...s, Model: 'flash' } : s)) };
        }
      } else if (FLASH_AGENTS.test(String(args.TypeName))) {
        overwrite = { Model: 'flash' };
      }
    }
  }

  const target = pick(args, ['Path', 'AbsolutePath', 'TargetFile', 'filePath', 'path', 'DirectoryPath', 'SearchPath']);

  // A crew member started by fm.js crew carries its role in the environment; that wins over any lookup.
  const ENV_ROLE = { reader: 'explorer', judge: 'explorer', builder: 'worker' }[process.env.FM_ROLE] || '';
  const agent = decision.decision === 'allow' ? (ENV_ROLE || agentOf(convoId, st, ev.modelName || p.modelName, ev)) : '';

  // First-mate budget. Its facts, notes, the plugin's playbooks and fm.js are free; every other read
  // and every other command segment counts (so chaining a free command does not hide a read).
  if (agent === 'firstmate' && (READ_TOOLS.has(tool) || tool === 'run_command')) {
    const slash = (x) => String(x).replace(/\\+/g, '/');
    const freePath = (s) => FREE_PATH_RE.test(s) || slash(s).includes(slash(PLUGIN_DIR));
    // One call costs 1, whatever the command looks like; only plugin-script and free-path calls are free.
    const rest = tool === 'run_command' ? cmd.replace(FM_SCRIPT_RE, '').replace(/\bcd\s+\S+/g, '') : '';
    const cost = tool === 'run_command'
      ? (rest.replace(/[&;|\s]+/g, '') && !freePath(rest) ? 1 : 0)
      : (freePath(target || JSON.stringify(args)) ? 0 : 1);
    if (cost > 0 && spendBudget(convoId, cost) > HARD_MAX) {
      decision = { decision: 'deny', reason: `[firstmate budget] ${HARD_MAX} direct reads/commands for one captain message is the hard stop. Send the rest to explorer subagents (one invoke_subagent call, TypeName "explorer", each with one angle), or answer with what you have and list what is not verified.` };
    }
  }

  // MCP tools: reads pass, the rest asks the captain (explorers: denied).
  if (decision.decision === 'allow') {
    const t = mcpTool(tool, args);
    if (t) {
      // record the call shape (tool name and argument keys, no values) so a live run shows the real schema
      try { fs.appendFileSync(path.join(STATE_DIR, 'mcp.log'), `${new Date().toISOString()} ${convo} ${agent || '-'} ${tool} ${t.name || '?'} keys=${Object.keys(args).join(',')}\n`); } catch {}
      // the first mate's MCP reads count toward its budget like any other read
      if (agent === 'firstmate' && mcpKind(t.name) === 'read' && spendBudget(convoId, 1) > HARD_MAX) {
        decision = { decision: 'deny', reason: `[firstmate budget] ${HARD_MAX} direct reads/commands for one captain message is the hard stop. Send MCP reading to explorer subagents too.` };
      }
    }
    const m = decision.decision === 'allow' ? mcpPolicy(tool, args, agent) : null;
    if (m) decision = m;
  }

  // Explorers are read-only: no write tools, and no command that changes files in the captain's checkout.
  if (agent === 'explorer') {
    if (WRITE_TOOLS.has(tool) || (tool === 'run_command' && WRITE_CMD_RE.test(cmd))) {
      decision = { decision: 'deny', reason: '[guard] Explorers are read-only: no file edits, redirects into files, moves, deletes or git changes. Report what you would change under OPEN QUESTIONS instead.' };
    }
  }
  // The crew runs fm.js (save, gate) but never writes the records delivery trusts by hand: gate results
  // and notes, facts.md, and the task refs.
  if (/^(worker|checker|explorer)$/.test(agent) && decision.decision === 'allow') {
    const rest = tool === 'run_command' ? cmd.replace(FM_SCRIPT_RE, '') : '';
    if ((WRITE_TOOLS.has(tool) && RECORD_RE.test(target)) ||
        (tool === 'run_command' && ((RECORD_RE.test(rest) && WRITE_CMD_RE.test(rest)) || /\bupdate-ref\b|refs\/firstmate\//.test(rest)))) {
      decision = { decision: 'deny', reason: '[guard] Gate results, notes, facts, settings and task refs are written only by fm.js. Run fm.js save and fm.js gate; do not edit .firstmate/notes, facts.md, config.json or refs/firstmate by hand.' };
    }
  }
  // Locked acceptance tests: the crew changes the code, never the test that judges it.
  if (/^(worker|checker|builder)$/.test(agent) && decision.decision === 'allow') {
    const lockedHit = lockedTarget(tool, args, target, cmd);
    if (lockedHit) decision = { decision: 'deny', reason: `[guard] ${lockedHit.path} is a locked acceptance test for task ${lockedHit.task}: change the code, not the test.` };
  }
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
  saveState(convoId || 'unknown', st);
  if (overwrite && decision.decision === 'allow') decision.overwrite = overwrite;
  out(decision);
}

try { main(); } catch { allow(); }
