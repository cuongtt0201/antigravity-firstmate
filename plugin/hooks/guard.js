#!/usr/bin/env node
// flash-ultra guard (PreToolUse). Its jobs:
//  1. Tamper protection: agents may not edit or disable this plugin or the hook config.
//  2. Live-system safety: commands that change clusters, cloud resources, buckets or the git remote are
//     denied (the captain runs them); remote shells and production pod shells need the captain's approval.
//  3. Pin worker/checker subagents to Flash, and cap subagent launches per chat.
//  4. Loop guard: deny the 4th identical read of an unchanged file; nudge after 40 reads in a row.
// It is a safety net, not a sandbox: it reads the command text and can be fooled by obfuscation.
// Fails open: any error → allow.

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_SAME_READ = 3;
const MAX_READ_STREAK = 40;
const MAX_SUBAGENTS = 12; // per chat per day
const STATE_DIR = path.join(os.tmpdir(), 'flash-ultra-loop-guard');
const STATE_TTL_MS = 24 * 60 * 60 * 1000;

const READ_TOOLS = new Set(['read_file', 'view_file', 'view_file_outline', 'view_code_item', 'grep_search', 'find_by_name', 'list_dir', 'codebase_search']);
const WRITE_TOOLS = new Set(['write_file', 'edit_file', 'write_to_file', 'replace_file_content', 'multi_replace_file_content', 'create_file']);
const PROTECTED_RE = /\.gemini[\\/]+config[\\/]+(plugins[\\/]+flash-ultra|hooks\.json|config\.json)|flash-ultra[\\/]+(hooks|agents|plugin\.json)|guard\.js/;
const FM_CALL_RE = /\bbash\s+\S*flash-ultra[\\/]scripts[\\/]fm\.sh\b/g;

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
const KUBE_DENY = new Set(['apply', 'create', 'delete', 'edit', 'patch', 'replace', 'scale', 'autoscale', 'set', 'label', 'annotate', 'drain', 'cordon', 'uncordon', 'taint', 'expose', 'certificate']);
const KUBE_ASK = new Set(['cp', 'debug', 'run', 'attach']);
const HELM_DENY = new Set(['install', 'upgrade', 'uninstall', 'delete', 'rollback', 'push']);
const HELMFILE_DENY = new Set(['apply', 'sync', 'destroy', 'delete', 'deps']);
const TF_DENY = new Set(['apply', 'destroy', 'import', 'taint', 'untaint', 'force-unlock']);
const GCLOUD_DENY = new Set(['create', 'delete', 'update', 'deploy', 'resize', 'set-iam-policy', 'add-iam-policy-binding', 'remove-iam-policy-binding',
  'reset', 'stop', 'start', 'suspend', 'resume', 'rollback', 'import', 'patch', 'move', 'rename', 'restore', 'set-machine-type',
  'attach-disk', 'detach-disk', 'add-tags', 'remove-tags', 'add-metadata', 'remove-metadata', 'rm', 'mv', 'rsync']);
const GSUTIL_DENY = new Set(['rm', 'mv', 'setmeta', 'acl', 'iam', 'defacl', 'lifecycle', 'retention']);

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
    if (name === 'rollout') return ['status', 'history'].includes(rest.find((x) => !x.startsWith('-'))) ? null : deny('changes a rollout');
    if (KUBE_DENY.has(name)) return deny('changes the cluster');
    if (KUBE_ASK.has(name)) return ask('creates or writes to a pod');
    if (name === 'exec' && /prod/i.test(seg)) return ask('opens a shell or runs a command inside a production pod');
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
  const ev = p.preToolHookArgs || p.toolHookArgs || p;
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

  const convo = String(ev.conversationId || p.conversationId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const file = path.join(STATE_DIR, `${convo}.json`);
  let st = { reads: {}, streak: 0, subagents: 0 };
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - (s.t || 0) < STATE_TTL_MS) st = { reads: s.reads || {}, streak: s.streak || 0, subagents: s.subagents || 0, model: s.model };
  } catch {}

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
  const FLASH_AGENTS = /^(worker|checker)$/;
  let overwrite = null;
  if (tool === 'invoke_subagent') {
    const n = Array.isArray(args.Subagents) ? args.Subagents.length : 1;
    if (st.subagents + n > MAX_SUBAGENTS) {
      decision = { decision: 'deny', reason: `[guard] This chat already launched ${st.subagents} subagents (cap ${MAX_SUBAGENTS} per day). Report what you have to the captain and ask before launching more.` };
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
