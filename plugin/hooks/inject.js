#!/usr/bin/env node
// flash-ultra context hook.
//   inject.js session  (SessionStart)   injects the repo's .firstmate/facts.md, or says there is none
//   inject.js invoke   (PreInvocation)  injects the role's short rules before every model turn, and
//                                       starts a new direct-read budget for a first mate on a strong model
// Crew processes started by fm.js crew (FM_ROLE set) get nothing: their prompt carries role and facts path.
// Fails open: any error → no injection.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { PLUGIN_DIR, DIRECT_MAX, HARD_MAX, unwrap, loadState, saveState, agentOf, lastUserStep, resetBudget, budgetUsed } = require('./lib');

const MAX_FACTS = 60;

const ROLE_RULES = {
  firstmate: (left) => [
    '[firstmate rules]',
    '1. Questions: answer; small ones from up to 3 reads yourself, larger ones through reader crew (one fm.js crew --batch call). Instructions: act now, no go needed; ask ONE question only when two readings lead to different changes.',
    `2. Changes go through tasks: fm.js start --request, builders in one fm.js crew --batch call, then fm.js ladder per task and do what NEXT says (fix, arena, judge, deliver, ask captain). High risk waits for the captain.${left === null ? '' : left > 0 ? ` You have ${left} of ${DIRECT_MAX} direct reads/commands left for this captain message.` : ` You used your ${DIRECT_MAX} direct reads/commands for this captain message: send further reading to readers (a hard stop comes at ${HARD_MAX}).`}`,
    '3. Label claims measured / inferred / guess; numbers only from a command. Never invent hosts, versions or names. Record durable facts with one fm.js fact call, batched with another command.',
    '4. Briefs: the captain\'s words, OWNS, DONE WHEN, error paths and security, skills: 0 to 3 from your <skills> list or skills: none. Never pass best or firstmate as a skill.',
  ].join('\n'),
  reader: () => '[reader rules] Read only. Every finding cites path:line or the exact command and output, labelled measured / inferred / guess. Read error paths too. Finish with your report format.',
  builder: () => '[builder rules] Edit only inside your task workspace and only the files you own; never a locked test. fm.js saves and gates your work when you stop. Nothing that changes live systems, no git commit or push. Finish with your report format.',
  judge: () => '[judge rules] Judge the dossier against the request, not the builder\'s words. First line VERDICT: APPROVE | REVISE | REJECT | HUMAN, with evidence for each reason.',
};
ROLE_RULES.explorer = ROLE_RULES.reader;
ROLE_RULES.worker = ROLE_RULES.builder;
ROLE_RULES.checker = ROLE_RULES.judge;

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
    if (/^\/[A-Za-z]:[\\/]/.test(dir)) dir = dir.slice(1); // file:///C:/x on Windows
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

  // A crew process from fm.js crew already carries its role and the facts path in its prompt.
  if (process.env.FM_ROLE) { process.stdout.write('{}'); return; }
  if (mode === 'session') {
    const msg = factsMessage(Array.isArray(ev.workspacePaths) ? ev.workspacePaths : []);
    if (msg) steps.push({ systemMessage: { systemMessage: msg } });
  } else if (mode === 'invoke') {
    const st = loadState(id);
    const agent = agentOf(id, st, ev.modelName, ev);
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
    // The read budget protects an expensive main model; a first mate on Flash is the cheap one already.
    const strongMain = !!ev.modelName && !/flash/i.test(String(ev.modelName));
    if (ROLE_RULES[agent]) steps.push({ ephemeralMessage: ROLE_RULES[agent](agent === 'firstmate' && !strongMain ? null : Math.max(0, DIRECT_MAX - budgetUsed(id))) });
    if (id) saveState(id, st);
  }
  process.stdout.write(JSON.stringify(steps.length ? { injectSteps: steps } : {}));
}

try { main(); } catch { process.stdout.write('{}'); }
