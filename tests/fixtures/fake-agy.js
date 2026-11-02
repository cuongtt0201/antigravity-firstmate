#!/usr/bin/env node
// A stand-in for `agy -p ... --output-format json` in tests: no model, no tokens.
// Markers in the prompt: WRITE_FILE:<name> writes that file in the working folder; SLEEP:<ms> waits first.
// The response reports the role (FM_ROLE), model and folder it saw, and a verdict when the prompt is a judge's.
const fs = require('fs');
const a = process.argv.slice(2);
const val = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : ''; };
let prompt = val('-p') || val('--print');
const pf = (prompt.match(/(\S+\.prompt\.md)/) || [])[1];
if (pf && fs.existsSync(pf)) prompt = fs.readFileSync(pf, 'utf8');
const model = val('--model');
if (process.env.FAKE_AGY_ARGS) fs.appendFileSync(process.env.FAKE_AGY_ARGS, `${JSON.stringify(a)}\n`);
// FAIL_IF_MODEL:<s> / REVISE_IF_MODEL:<s>: only a model whose id contains <s> fails, or answers REVISE as a judge
const onlyFor = (k) => { const s = (prompt.match(new RegExp(`${k}:(\\S+)`)) || [])[1]; return !!s && model.includes(s); };
const sleep = Number((prompt.match(/SLEEP:(\d+)/) || [])[1] || 0);
const finish = () => {
  const m = prompt.match(/WRITE_FILE:([\w.-]+)/);
  if (m) fs.writeFileSync(m[1], 'written by fake agy\n');
  if (process.env.FAKE_AGY_LOG) fs.appendFileSync(process.env.FAKE_AGY_LOG, `${Date.now()} ${process.env.FM_ROLE || '-'} ${model}\n`);
  const judge = /VERDICT:/.test(prompt) && process.env.FM_ROLE === 'judge';
  if (process.env.FAKE_AGY_ECHO) { process.stdout.write(JSON.stringify({ conversation_id: 'echo', status: 'SUCCESS', response: prompt, usage: {} })); return; }
  const response = [`ROLE=${process.env.FM_ROLE || ''} TASK=${process.env.FM_TASK || ''} MODEL=${model} MODE=${val('--mode') || 'default'} CWD=${process.cwd()}`,
    judge ? (prompt.includes('PLEASE_REVISE') ? 'VERDICT: REVISE\nRISK: high\n- fix x' : onlyFor('REVISE_IF_MODEL') ? 'VERDICT: REVISE\n- fix y' : 'VERDICT: APPROVE\n- fine') : 'STATUS: PASS'].join('\n');
  if (process.env.FAKE_AGY_FAIL || onlyFor('FAIL_IF_MODEL')) { process.stdout.write(JSON.stringify({ status: 'ERROR', response: 'model unavailable' })); process.exit(1); }
  process.stdout.write(JSON.stringify({ conversation_id: `fake-${process.pid}`, status: 'SUCCESS', response, duration_seconds: sleep / 1000, num_turns: 1, usage: { input_tokens: 15000, output_tokens: 20, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 15020 } }));
};
setTimeout(finish, sleep);
