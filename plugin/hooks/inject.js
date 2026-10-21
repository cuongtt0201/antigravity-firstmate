#!/usr/bin/env node
// flash-ultra context hook.
//   inject.js session  (SessionStart)   injects the repo's .firstmate/facts.md, when there is one
//   inject.js invoke   (PreInvocation)  injects the role's short rules before every model turn, and
//                                       starts a new direct-read budget for the first mate on each captain message
// Fails open: any error → no injection.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PLUGIN_DIR, DIRECT_MAX, unwrap, loadState, saveState, agentOf, resetBudget, budgetUsed } = require('./lib');

const MAX_FACTS = 60;

const ROLE_RULES = {
  firstmate: (left) => [
    '[firstmate rules]',
    '1. First line of your reply: the playbook (→ quick / → how / → investigate / → change). Open ' + path.join(PLUGIN_DIR, 'skills/firstmate/playbooks') + '/<name>.md, copy its steps as a checklist, mark each done or skip: <reason>.',
    `2. You have ${left} of ${DIRECT_MAX} direct reads/commands left for this captain message. Bulk reading goes to explorer subagents (one invoke_subagent call, TypeName "explorer"); read their reports, not the files.`,
    '3. Label claims measured / inferred / guess. Never invent endpoints, hosts, versions or names. Reject subagent reports without evidence; a gap is not a result.',
    '4. Smallest change first. End recommendations with Gotchas the captain did not ask about. Record durable facts with fm.sh fact.',
  ].join('\n'),
  explorer: () => '[explorer rules] Read only. Every finding cites path:line or the exact command and output, labelled measured / inferred / guess. Read error paths too. Finish with the EXPLORER REPORT format.',
  worker: () => '[worker rules] Write only inside the task workspace named in your brief. No git commit or push, nothing that changes live systems. Finish with the WORKER REPORT format, including CHECK and EVIDENCE.',
  checker: () => '[checker rules] Compare against the original request, not the plan. First line VERDICT: PASS, ISSUES (every provable defect, with evidence) or BLOCKED. Never PASS what you could not check.',
};

function mainCheckout(dir) {
  try {
    const out = execFileSync('git', ['-C', dir, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/^worktree (.+)$/m);
    return m ? m[1] : null;
  } catch { return null; }
}

function factsMessage(workspaces) {
  const parts = [];
  for (const ws of workspaces) {
    let dir = String(ws).replace(/^file:\/\//, '');
    try { dir = decodeURIComponent(dir); } catch {}
    const repo = mainCheckout(dir);
    if (!repo) continue;
    let lines = [];
    try { lines = fs.readFileSync(path.join(repo, '.firstmate', 'facts.md'), 'utf8').split('\n').filter((l) => l.startsWith('- ')); } catch {}
    if (lines.length) parts.push(`Known facts about ${repo} (from .firstmate/facts.md, newest last):\n${lines.slice(-MAX_FACTS).join('\n')}`);
  }
  return parts.join('\n\n');
}

function main() {
  const mode = process.argv[2];
  const raw = fs.readFileSync(0, 'utf8');
  const ev = unwrap(raw.trim() ? JSON.parse(raw) : {});
  const id = ev.conversationId;
  let steps = [];

  if (mode === 'session') {
    const msg = factsMessage(Array.isArray(ev.workspacePaths) ? ev.workspacePaths : []);
    if (msg) steps.push({ systemMessage: { systemMessage: msg } });
  } else if (mode === 'invoke') {
    const st = loadState(id);
    const agent = agentOf(id, st);
    if (agent === 'firstmate' && ev.initialNumSteps !== undefined && st.turnSteps !== ev.initialNumSteps) {
      st.turnSteps = ev.initialNumSteps; // a new captain message starts a new execution
      resetBudget(id, `new-message initialNumSteps=${ev.initialNumSteps} invocationNum=${ev.invocationNum}`);
    }
    if (ROLE_RULES[agent]) steps.push({ ephemeralMessage: ROLE_RULES[agent](Math.max(0, DIRECT_MAX - budgetUsed(id))) });
    if (id) saveState(id, st);
  }
  process.stdout.write(JSON.stringify(steps.length ? { injectSteps: steps } : {}));
}

try { main(); } catch { process.stdout.write('{}'); }
