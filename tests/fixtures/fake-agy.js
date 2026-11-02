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
// `agy models`: FAKE_AGY_MODELS (comma-separated) or every model the real CLI listed
if (a[0] === 'models') {
  const ids = (process.env.FAKE_AGY_MODELS || 'gemini-4-argon-medium,gemini-4-argon-high,gemini-4-argon-low,gemini-3.8-flash-high,gemini-3.8-flash-medium,gemini-3.8-flash-low,claude-opus-5-5-low,claude-opus-5-5-medium,claude-opus-5-5-high,claude-sonnet-5-5-low,claude-sonnet-5-5-medium,claude-sonnet-5-5-high,gpt-oss-120b-medium').split(',');
  process.stdout.write(`Fetching available models...\n${ids.map((x) => `${x}\t${x}`).join('\n')}\n`);
  process.exit(0);
}
// `agy -p /usage`: the groups in FAKE_AGY_USAGE_FILE ({"<group>": {"remaining": 0.5, "reset": "<iso>"}}), others full;
// a reset time in the past means the group is full again. "not json" in the file: agy cannot tell.
const usageFile = process.env.FAKE_AGY_USAGE_FILE;
const readUsage = () => { try { return fs.readFileSync(usageFile, 'utf8'); } catch { return '{}'; } };
if (prompt === '/usage') {
  const raw = readUsage();
  if (raw.trim() === 'not json') { process.stdout.write('usage is not available\n'); process.exit(0); }
  const set = JSON.parse(raw || '{}');
  const groups = ['Gemini Models', 'Claude and GPT models', 'Gemini 4 Argon'].map((name) => {
    const s = set[name] || {}; const reset = s.reset || '2099-01-01T00:00:00Z';
    const left = Date.parse(reset) <= Date.now() || s.remaining === undefined ? 1 : s.remaining;
    return { name, buckets: [{ id: name, window: 'weekly', remaining_fraction: left, reset_time: reset }] };
  });
  process.stdout.write(JSON.stringify({ conversation_id: '', status: 'SUCCESS', response: '', command: { name: 'usage', data: { groups } } }));
  process.exit(0);
}
if (process.env.FAKE_AGY_ARGS) fs.appendFileSync(process.env.FAKE_AGY_ARGS, `${JSON.stringify(a)}\n`);
// EXHAUST_GEMINI in a prompt: this run uses up the Gemini group (in FAKE_AGY_USAGE_FILE) until 2099
if (usageFile && prompt.includes('EXHAUST_GEMINI')) fs.writeFileSync(usageFile, JSON.stringify({ ...JSON.parse(readUsage() || '{}'), 'Gemini Models': { remaining: 0, reset: '2099-01-01T00:00:00Z' } }));
// FAIL_IF_MODEL:<s> / REVISE_IF_MODEL:<s>: only a model whose id contains <s> fails, or answers REVISE as a judge
const onlyFor = (k) => { const s = (prompt.match(new RegExp(`${k}:(\\S+)`)) || [])[1]; return !!s && model.includes(s); };
const sleep = Number((prompt.match(/SLEEP:(\d+)/) || [])[1] || 0);
// AFK_WRITE_BATCH:<task>:<file> in an afk first mate's prompt: write an fm.js run batch (one builder that writes <file>)
// to the BATCH FILE the prompt names
const afkBatch = prompt.match(/AFK_WRITE_BATCH:([\w-]+):([\w.-]+)/); const batchFile = (prompt.match(/BATCH FILE: (\S+)/) || [])[1];
if (afkBatch && batchFile) { fs.mkdirSync(require('path').dirname(batchFile), { recursive: true }); fs.writeFileSync(batchFile, JSON.stringify([{ task: afkBatch[1], request: afkBatch[1], brief: `WRITE_FILE:${afkBatch[2]}` }])); }
const finish = () => {
  const m = prompt.match(/WRITE_FILE:([\w.-]+)/);
  // FIXED_IN_ROUND2: the first round writes the file badly (invalid JSON), a fix round writes it right
  if (m) fs.writeFileSync(m[1], prompt.includes('FIXED_IN_ROUND2') && prompt.includes('FIX ROUND') ? '{}\n' : 'written by fake agy\n');
  if (process.env.FAKE_AGY_LOG) fs.appendFileSync(process.env.FAKE_AGY_LOG, `${Date.now()} ${process.env.FM_ROLE || '-'} ${model}\n`);
  const judge = /VERDICT:/.test(prompt) && process.env.FM_ROLE === 'judge';
  if (process.env.FAKE_AGY_ECHO) { process.stdout.write(JSON.stringify({ conversation_id: 'echo', status: 'SUCCESS', response: prompt, usage: {} })); return; }
  const response = [`ROLE=${process.env.FM_ROLE || ''} TASK=${process.env.FM_TASK || ''} MODEL=${model} MODE=${val('--mode') || 'default'} CWD=${process.cwd()}`,
    judge ? (prompt.includes('PLEASE_REVISE') ? 'VERDICT: REVISE\nRISK: high\n- fix x' : onlyFor('REVISE_IF_MODEL') ? 'VERDICT: REVISE\n- fix y' : 'VERDICT: APPROVE\n- fine') : 'STATUS: PASS'].join('\n');
  if (process.env.FAKE_AGY_FAIL || onlyFor('FAIL_IF_MODEL')) { process.stdout.write(JSON.stringify({ status: 'ERROR', response: 'model unavailable' })); process.exit(1); }
  process.stdout.write(JSON.stringify({ conversation_id: `fake-${process.pid}`, status: 'SUCCESS', response, duration_seconds: sleep / 1000, num_turns: 1, usage: { input_tokens: 15000, output_tokens: 20, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 15020 } }));
};
setTimeout(finish, sleep);
