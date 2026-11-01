#!/usr/bin/env node
// Survey hook for the Antigravity IDE: logs every hook payload it receives, and answers with a few test decisions.
//   node probe.js <event>   payload on stdin; one JSON line appended to $FM_PROBE_LOG (~/.firstmate-probe/log.jsonl)
// Markers in the payload: PROBE_DENY → deny, PROBE_ASK → force_ask; invoke_subagent of probe-sub → overwrite Model
// with $FM_PROBE_MODEL (default flash). Anything else → {} (no opinion).
const fs = require('fs');
const os = require('os');
const path = require('path');

const event = process.argv[2] || 'unknown';
let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch {}
let payload = raw;
try { payload = JSON.parse(raw); } catch {}
const log = process.env.FM_PROBE_LOG || path.join(os.homedir(), '.firstmate-probe', 'log.jsonl');
try {
  fs.mkdirSync(path.dirname(log), { recursive: true });
  fs.appendFileSync(log, `${JSON.stringify({ t: new Date().toISOString(), event, argv: process.argv.slice(3), payload })}\n`);
} catch {}

let answer = {};
if (raw.includes('PROBE_DENY')) answer = { decision: 'deny', reason: 'probe deny' };
else if (raw.includes('PROBE_ASK')) answer = { decision: 'force_ask', reason: 'probe ask' };
else if (raw.includes('invoke_subagent') && raw.includes('probe-sub')) answer = { decision: 'allow', overwrite: { Model: process.env.FM_PROBE_MODEL || 'flash' } };
process.stdout.write(JSON.stringify(answer));
