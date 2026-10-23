#!/usr/bin/env node
// flash-ultra guard (PreToolUse). Its jobs:
//  1. Tamper protection: agents may not edit or disable this plugin or the hook config.
//  2. Live-system safety: commands that change clusters, cloud resources, buckets or the git remote are
//     denied (the captain runs them); remote shells and production pod shells need the captain's approval.
//  3. Pin worker/checker subagents to Flash, and cap subagent launches per chat.
//  4. Loop guard: deny the 4th identical read of an unchanged file; nudge after 40 reads in a row.
//  5. First-mate budget: in chats run by the firstmate agent, each read tool call or command counts 1
//     (command text is not parsed). After DIRECT_MAX the injected rules tell it to delegate; HARD_MAX denies.
//  6. Parallel workers each get their own task workspace: one invoke_subagent may not send two workers
//     into the same .firstmate/wt/<task>.
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
// Commands that change files: redirects into a file, in-place edits, moves, deletes, copies and git changes.
const WRITE_CMD_RE = /(^|[^\w>&-])(\d?>>?|&>)\s*(?!\/dev\/null\b|&\d)[^\s|;&]|\b(sed|perl)\s+(-\w*\s+)*-i|\b(rm|mv|cp|tee|truncate|chmod|chown|ln|mkdir|touch|rsync)\s|\bgit\s+(\S+\s+)*?(checkout|reset|commit|add|stash|clean|restore|apply|merge|rebase|push|cherry-pick|rm|mv)\b|\b(npm|yarn|pnpm|pip|pip3)\s+(install|i|add|remove|uninstall)\b/;
// The plugin's workspace script, `node "<plugin>/scripts/fm.js"` (or the old `bash .../fm.sh`), installed or repo copy.
const PLUGIN_RE_SRC = `(?:[^"\\s]*flash-ultra|${PLUGIN_DIR.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})[\\\\/]+scripts[\\\\/]+fm\\.(?:js|sh)`;
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

// ---------- live-system command policy ----------
const WRAPPERS = new Set(['sudo', 'time', 'nohup', 'exec', 'command', 'env', 'xargs', 'watch']);
const SHELLS = new Set(['bash', 'sh', 'zsh']);

function words(seg) {
  let w = seg.trim().split(/\s+/).map((x) => x.replace(/^[('"{]+|[)'"};]+$/g, '')).filter(Boolean);
  while (w.length) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || WRAPPERS.has(w[0])) { w.shift(); continue; }
    if (w[0] === 'timeout') { w.splice(0, 2); continue; }
    break;
  }
  if (w.length) w[0] = w[0].split(/[\\/]/).pop();
  if (SHELLS.has(w[0]) && w[1] === '-c') return words(w.slice(2).join(' '));
  return w;
}

// first non-flag word after the program name, skipping the values of flags that take one
function sub(w, valueFlags) {
  for (let i = 1; i < w.length; i++) {
    const t = w[i];
    if (t.startsWith('-')) { if (!t.includes('=') && valueFlags.has(t)) i++; continue; }
    return { name: t, rest: w.slice(i + 1) };
  }
  return { name: '', rest: [] };
}

const KUBE_FLAGS = new Set(['-n', '--namespace', '--context', '--kubeconfig', '--cluster', '--user', '-s', '--server', '--as', '--token', '--request-timeout']);
// kubectl: agents only read the cluster; every change goes through GitOps. Anything not on this list is denied.
const KUBE_READ = new Set(['get', 'describe', 'logs', 'top', 'events', 'explain', 'api-resources', 'api-versions', 'version', 'cluster-info']);
const KUBE_READ_SUB = { config: ['view', 'get-contexts', 'current-context', 'get-clusters'], auth: ['can-i', 'whoami'], rollout: ['status', 'history'] };
const HELM_DENY = new Set(['install', 'upgrade', 'uninstall', 'delete', 'rollback', 'push']);
const HELMFILE_DENY = new Set(['apply', 'sync', 'destroy', 'delete', 'deps']);
const TF_DENY = new Set(['apply', 'destroy', 'import', 'taint', 'untaint', 'force-unlock']);
const GCLOUD_DENY = new Set(['create', 'delete', 'update', 'deploy', 'resize', 'set-iam-policy', 'add-iam-policy-binding', 'remove-iam-policy-binding',
  'reset', 'stop', 'start', 'suspend', 'resume', 'rollback', 'import', 'patch', 'move', 'rename', 'restore', 'set-machine-type',
  'attach-disk', 'detach-disk', 'add-tags', 'remove-tags', 'add-metadata', 'remove-metadata', 'rm', 'mv', 'rsync']);
const GSUTIL_DENY = new Set(['rm', 'mv', 'setmeta', 'acl', 'iam', 'defacl', 'lifecycle', 'retention']);

// "prod" or "production" as a whole name part (prod-core, gke_prod, -n production), not "products"
const PROD_RE = /(^|[\s/=_.:-])prod(uction)?([\s/=_.:-]|$)/i;
const toBucket = (w) => { const args = w.slice(1).filter((x) => !x.startsWith('-')); return /^gs:\/\//.test(args[args.length - 1] || ''); };

function judge(seg) {
  const w = words(seg);
  const p = w[0];
  if (!p) return null;
  const s = (vf = new Set()) => sub(w, vf);
  const deny = (what) => ({ decision: 'deny', reason: `[guard] "${seg.trim().slice(0, 160)}" ${what}. Agents never run this. Give the captain the exact command to run, and continue from the output they paste.` });
  const ask = (what) => ({ decision: 'force_ask', reason: `[guard] "${seg.trim().slice(0, 160)}" ${what}; the captain must approve it.` });

  if (p === 'git') {
    if (s(new Set(['-C', '-c', '--git-dir', '--work-tree'])).name === 'push') return deny('pushes to the remote');
  } else if (p === 'kubectl' || p === 'oc') {
    const { name, rest } = s(KUBE_FLAGS);
    if (!name || KUBE_READ.has(name)) return null;
    if (KUBE_READ_SUB[name] && KUBE_READ_SUB[name].includes(rest.find((x) => !x.startsWith('-')))) return null;
    return deny(`is not a read (agents may only run kubectl ${[...KUBE_READ].join(', ')}, config view, auth can-i, rollout status; changes, exec and port-forward go through GitOps or the captain)`);
  } else if (p === 'helm') {
    if (HELM_DENY.has(s(new Set(['-n', '--namespace', '--kube-context', '--kubeconfig'])).name)) return deny('changes a Helm release');
  } else if (p === 'helmfile') {
    if (w.some((x) => HELMFILE_DENY.has(x))) return deny('applies Helm releases');
  } else if (p === 'terraform' || p === 'tofu' || p === 'terragrunt') {
    const i = w.indexOf('state');
    if (w.some((x) => TF_DENY.has(x)) || (i > 0 && ['rm', 'mv', 'push', 'replace-provider'].includes(w[i + 1]))) return deny('changes infrastructure or its state');
  } else if (p === 'gcloud') {
    if (w[1] === 'config' || w[1] === 'auth') return null;
    if (w.includes('ssh') || w.includes('scp')) return ask('opens a remote shell');
    if (w.includes('cp') && toBucket(w)) return deny('writes to a bucket');
    if (w.slice(1).some((x) => !x.startsWith('-') && GCLOUD_DENY.has(x))) return deny('changes cloud resources');
  } else if (p === 'gsutil') {
    const { name } = s(new Set(['-o', '-h', '-u']));
    if (GSUTIL_DENY.has(name) || (['cp', 'rsync'].includes(name) && toBucket(w))) return deny('changes a bucket');
  } else if (p === 'ssh' || p === 'scp' || (p === 'rsync' && w.slice(1).some((x) => /^[^-/][^\s]*:/.test(x)))) {
    return ask('runs on a remote host');
  }
  return null;
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

// The task workspace two or more parallel workers in one invoke_subagent call would share, or ''.
function sharedTask(args) {
  if (!Array.isArray(args.Subagents)) return '';
  const seen = new Set();
  for (const s of args.Subagents) {
    if (!s || String(s.TypeName) !== 'worker') continue;
    const m = String(s.Prompt || s.prompt || '').match(/\.firstmate[\\/]+wt[\\/]+([a-z0-9][a-z0-9-]*)/);
    if (!m) continue;
    if (seen.has(m[1])) return m[1];
    seen.add(m[1]);
  }
  return '';
}

function commandPolicy(cmd) {
  for (const seg of cmd.split(/&&|\|\||;|\||\n|`|\$\(/)) {
    const d = judge(seg);
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
    const d = commandPolicy(cmd);
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
      decision = { decision: 'deny', reason: `[guard] Two or more workers in this call share the task workspace .firstmate/wt/${sharedTask(args)}. Give each independent part its own task (fm.js start <repo> <task> once per part), then send one worker per task.` };
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

  const agent = decision.decision === 'allow' ? agentOf(convoId, st, ev.modelName || p.modelName) : '';

  // First-mate budget. Its facts, notes, the plugin's playbooks and fm.js are free; every other read
  // and every other command segment counts (so chaining a free command does not hide a read).
  if (agent === 'firstmate' && (READ_TOOLS.has(tool) || tool === 'run_command')) {
    const freePath = (s) => FREE_PATH_RE.test(s) || s.includes(PLUGIN_DIR);
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
