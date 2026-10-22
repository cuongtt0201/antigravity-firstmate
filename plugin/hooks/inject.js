#!/usr/bin/env node
// flash-ultra context hook.
//   inject.js session  (SessionStart)   injects the repo's .firstmate/facts.md, or says there is none
//   inject.js invoke   (PreInvocation)  injects the role's short rules before every model turn, and
//                                       starts a new direct-read budget for the first mate on each captain message
// Fails open: any error → no injection.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PLUGIN_DIR, DIRECT_MAX, unwrap, loadState, saveState, agentOf, lastUserStep, resetBudget, budgetUsed } = require('./lib');

const MAX_FACTS = 60;

const ROLE_RULES = {
  firstmate: (left) => [
    '[firstmate rules]',
    '1. First line of your reply: the playbook (→ quick / → how / → investigate / → change, or → best for a written deliverable that is not code). Open ' + path.join(PLUGIN_DIR, 'skills/firstmate/playbooks') + '/<name>.md, copy its steps as a checklist, mark each done or skip: <reason>.',
    `2. You have ${left} of ${DIRECT_MAX} direct reads/commands left for this captain message. Small questions: read yourself, including the catch blocks and auth of what you read. Larger ones: explorer subagents (one invoke_subagent call, TypeName "explorer"), always with an error-paths-and-security angle when the goal is a change or migration.`,
    '3. Label claims measured / inferred / guess; a number is measured only when a command or script you show produced it. Never invent endpoints, hosts, versions or names. Reject subagent reports without evidence; a gap is not a result. List files before reporting what exists on disk.',
    '4. Smallest change first. End recommendations with Gotchas the captain did not ask about. Record durable facts with fm.sh fact.',
    '5. Skills: in every brief write skills: with 0 to 3 skills from your <skills> list that fit the subagent\'s task, or skills: none. Never pass best, how, investigate, change or firstmate (your own playbooks). Name the skills used in your answer. Subagents run in the background: keep working while they run, never poll, and for a fix round message the same (idle) subagent instead of starting a new one.',
  ].join('\n'),
  explorer: () => '[explorer rules] Read only. Every finding cites path:line or the exact command and output, labelled measured / inferred / guess (numbers only from a command). Read error paths too. Use the skills in your brief, or one from <skills> that fits. Finish with the EXPLORER REPORT format, including SKILLS USED.',
  worker: () => '[worker rules] Write only inside the task workspace named in your brief (for /best: inside best/, scratch in best/tmp/, deleted before you report). No git commit or push, nothing that changes live systems. With a word limit: write one section at a time with the file tools, run the shape command after each, shorten only the sections that are over, at most 2 passes, then report ISSUES with the shape line; never build prose from a script. Use the skills in your brief, or one from <skills> that fits. Finish with the WORKER REPORT format, including CHECK, EVIDENCE and SKILLS USED.',
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
    if (!dir) continue;
    const repo = mainCheckout(dir);
    if (!repo) { parts.push(`No firstmate facts for ${dir}: it is not a git repo, so there is no .firstmate/facts.md to read.`); continue; }
    let lines = [];
    try { lines = fs.readFileSync(path.join(repo, '.firstmate', 'facts.md'), 'utf8').split('\n').filter((l) => l.startsWith('- ')); } catch {}
    if (lines.length) parts.push(`Known facts about ${repo} (from .firstmate/facts.md, newest last):\n${lines.slice(-MAX_FACTS).join('\n')}`);
    else parts.push(`No facts recorded yet for ${repo} (.firstmate/facts.md is missing or empty).`);
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
    const agent = agentOf(id, st, ev.modelName);
    if (agent === 'firstmate') {
      // The budget is per captain message: reset when the transcript shows a new USER_INPUT step.
      // Without a readable transcript, fall back to a new execution (invocationNum back to 0; a missing
      // value is protojson's omitted zero). initialNumSteps changes on every call and marks nothing.
      const u = lastUserStep(id, ev);
      if (u !== undefined) {
        if (st.lastUserStep !== u) resetBudget(id, `captain-message step=${u}`);
        st.lastUserStep = u;
      } else {
        const n = ev.invocationNum === undefined ? 0 : Number(ev.invocationNum);
        if (n === 0 || (st.lastInvocation !== undefined && n < st.lastInvocation)) resetBudget(id, `new-execution invocationNum=${n}`);
        st.lastInvocation = n;
      }
    }
    if (ROLE_RULES[agent]) steps.push({ ephemeralMessage: ROLE_RULES[agent](Math.max(0, DIRECT_MAX - budgetUsed(id))) });
    if (id) saveState(id, st);
  }
  process.stdout.write(JSON.stringify(steps.length ? { injectSteps: steps } : {}));
}

try { main(); } catch { process.stdout.write('{}'); }
