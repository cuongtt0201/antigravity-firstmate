// firstmate: the crew as headless Antigravity CLI processes (`agy -p`), one per task, run in parallel.
//   fm.js crew <repo> <task> --role builder|reader|judge [--model fast|standard|strong|second|<id>] [--skills a,b]
//              [--brief "<text>" | --brief-file <file>]
//   fm.js crew <repo> --batch <file.json>   [{ "task", "role", "model"?, "skills"?, "brief" | "briefFile" }, ...]
// A builder works in its task workspace; a reader or judge works in the repo, read-only. Each process gets
// FM_ROLE, FM_TASK and FM_REPO in its environment, so the plugin's hooks hold it to its role. Every run's tokens
// go to <notes>/<task>.crew.jsonl and its report to <notes>/<task>.<role>.<n>.md.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { taskDir, notesDir } = require('./fm-paths.js');
const { loadConfig } = require('./fm-config.js');

const ROLES = {
  reader: { models: ['fast', 'standard'], def: 'fast', inTask: false, cap: 'crewPerDay' },
  builder: { models: ['fast', 'standard'], def: 'standard', inTask: true, cap: 'crewPerDay' },
  judge: { models: ['strong', 'second'], def: 'strong', inTask: false, cap: 'judgePerDay' },
};
const PLUGIN_DIR = path.resolve(__dirname, '..');

class CrewError extends Error {}

function agyPath() {
  if (process.env.FM_AGY) return process.env.FM_AGY;
  const local = path.join(os.homedir(), '.gemini', 'bin', process.platform === 'win32' ? 'agy.exe' : 'agy');
  return fs.existsSync(local) ? local : 'agy';
}

// The role's instructions: the body of agents/<role>.md, with the plugin path filled in.
function rolePrompt(role) {
  const text = fs.readFileSync(path.join(PLUGIN_DIR, 'agents', `${role}.md`), 'utf8');
  const body = text.replace(/^---[\s\S]*?\n---\s*\n/, '');
  return body.replaceAll('{{PLUGIN_DIR}}', PLUGIN_DIR.split(path.sep).join('/'));
}

function resolveModel(cfg, role, wanted) {
  const r = ROLES[role];
  const key = wanted || r.def;
  if (cfg.models[key]) {
    if (!r.models.includes(key)) throw new CrewError(`a ${role} may run on ${r.models.join(' or ')}, not ${key}`);
    return { key, id: cfg.models[key] };
  }
  // an explicit model id: the crew stays on Flash-class models, the judge on anything else
  const flash = /flash/i.test(key);
  if (role !== 'judge' && !flash) throw new CrewError(`a ${role} runs on a Flash model; '${key}' is not one`);
  return { key, id: key };
}

const today = () => new Date().toISOString().slice(0, 10);
function usedToday(r, capKey) {
  try {
    return fs.readFileSync(path.join(notesDir(r), 'crew.log'), 'utf8').split('\n')
      .filter((l) => l.startsWith(today()) && ((capKey === 'judgePerDay') === / judge /.test(l))).length;
  } catch { return 0; }
}

// A builder may only touch its workspace, so the repo's facts come inside its prompt, not as a path.
function factsText(r) {
  try {
    const lines = fs.readFileSync(path.join(r, '.firstmate', 'facts.md'), 'utf8').split('\n').filter((l) => l.startsWith('- '));
    return lines.slice(-60).join('\n') || 'none recorded yet';
  } catch { return 'none recorded yet'; }
}

// Checks one member of the crew and fills in everything the run needs; throws CrewError when refused.
function prepare(r, spec, cfg) {
  const { task, role } = spec;
  if (!ROLES[role]) throw new CrewError(`unknown role '${role}' (builder, reader or judge)`);
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(task || '')) throw new CrewError(`task name must be lowercase letters, digits and dashes: '${task || ''}'`);
  const model = resolveModel(cfg, role, spec.model);
  const ws = taskDir(r, task);
  if (ROLES[role].inTask && !fs.existsSync(ws)) throw new CrewError(`task '${task}' has no workspace; run: fm.js start ${r} ${task}`);
  let brief = spec.brief || '';
  if (spec.briefFile) brief = fs.readFileSync(path.resolve(r, spec.briefFile), 'utf8');
  if (!brief.trim()) throw new CrewError(`task '${task}': empty brief`);
  const skills = Array.isArray(spec.skills) ? spec.skills.join(', ') : (spec.skills || 'none');
  const header = [
    `ROLE: ${role}${spec.as ? ` (${spec.as})` : ''}`,
    `TASK: ${task}`,
    `REPO: ${r}`,
    ROLES[role].inTask ? `WORKSPACE: ${ws}` : null,
    `MODEL: ${model.key}`,
    `SKILLS: ${skills}`,
    ROLES[role].inTask ? `FACTS (known about this repo):\n${factsText(r)}` : `FACTS: ${path.join(r, '.firstmate', 'facts.md')}`,
  ].filter(Boolean).join('\n');
  return { ...spec, model, cwd: ROLES[role].inTask ? ws : r, prompt: `${rolePrompt(role)}\n---\n${header}\n\n${brief.trim()}\n` };
}

function runOne(r, m, cfg) {
  const agy = agyPath();
  const timeout = (Number(cfg.crewTimeoutSec) || 1800);
  // Builders may edit files (accept-edits: the CLI approves edits, every shell command still needs its approval);
  // readers and the judge only read (auto). The workspace is added so edits there count as inside the project.
  const mode = m.role === 'builder' ? ['--mode', 'accept-edits', '--add-dir', m.cwd] : ['--mode', 'auto'];
  const args = ['-p', m.prompt, '--model', m.model.id, '--output-format', 'json', ...mode, '--print-timeout', `${timeout}s`];
  const [cmd, argv] = agy.endsWith('.js') ? [process.execPath, [agy, ...args]] : [agy, args];
  const env = { ...process.env, FM_ROLE: m.role, FM_TASK: m.task, FM_REPO: r };
  const t0 = Date.now();
  return new Promise((resolve) => {
    let out = ''; let err = '';
    let child;
    try { child = spawn(cmd, argv, { cwd: m.cwd, env, windowsHide: true }); } catch (e) { resolve({ m, ok: false, error: e.message, ms: 0 }); return; }
    const pidFile = path.join(notesDir(r), `${m.task}.crew.pid`);
    if (m.role === 'builder') { try { fs.writeFileSync(pidFile, String(child.pid)); } catch {} }
    const killer = setTimeout(() => { try { child.kill(); } catch {} }, (timeout + 60) * 1000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { err += e.message; });
    child.on('close', (code) => {
      clearTimeout(killer);
      if (m.role === 'builder') fs.rmSync(pidFile, { force: true });
      let json = null;
      try { json = JSON.parse(out.trim().split('\n').filter(Boolean).pop() || ''); } catch {}
      const ok = code === 0 && json && json.status === 'SUCCESS';
      resolve({ m, ok, json, error: ok ? '' : (json && json.response) || err.trim().split('\n').slice(-5).join(' ') || `exit ${code}`, ms: Date.now() - t0 });
    });
  });
}

function record(r, res) {
  const { m, json } = res;
  fs.mkdirSync(notesDir(r), { recursive: true });
  const u = (json && json.usage) || {};
  const row = { time: new Date().toISOString(), role: m.role, model: m.model.id, status: res.ok ? 'SUCCESS' : 'ERROR', conversation_id: json && json.conversation_id, seconds: Math.round(res.ms / 1000), usage: u };
  fs.appendFileSync(path.join(notesDir(r), `${m.task}.crew.jsonl`), `${JSON.stringify(row)}\n`);
  fs.appendFileSync(path.join(notesDir(r), 'crew.log'), `${row.time} ${m.role} ${m.task} ${m.model.id}\n`);
  let n = 1; while (fs.existsSync(path.join(notesDir(r), `${m.task}.${m.role}.${n}.md`))) n += 1;
  const file = path.join(notesDir(r), `${m.task}.${m.role}.${n}.md`);
  fs.writeFileSync(file, (json && json.response) || res.error || '');
  return { file, usage: u };
}

// Runs the crew; resolves to the list of results. Refusals throw CrewError before anything starts.
async function crew(r, specs) {
  const cfg = loadConfig(r);
  if (specs.length > (Number(cfg.caps.perCall) || 6)) throw new CrewError(`${specs.length} crew members in one call; the cap is ${cfg.caps.perCall}`);
  const builders = specs.filter((s) => s.role === 'builder').map((s) => s.task);
  const dup = builders.find((t, i) => builders.indexOf(t) !== i);
  if (dup) throw new CrewError(`two builders for task '${dup}' in one call: give each part its own task (fm.js start)`);
  for (const s of specs) {
    if (s.role !== 'builder') continue;
    const pid = Number((() => { try { return fs.readFileSync(path.join(notesDir(r), `${s.task}.crew.pid`), 'utf8'); } catch { return 0; } })());
    if (pid) { try { process.kill(pid, 0); throw new CrewError(`a builder is still running in task '${s.task}' (pid ${pid})`); } catch (e) { if (e instanceof CrewError) throw e; } }
  }
  const members = specs.map((s) => prepare(r, s, cfg));
  for (const capKey of ['crewPerDay', 'judgePerDay']) {
    const want = members.filter((m) => ROLES[m.role].cap === capKey).length;
    if (want && usedToday(r, capKey) + want > (Number(cfg.caps[capKey]) || 0)) throw new CrewError(`the daily cap ${capKey}=${cfg.caps[capKey]} would be passed (${usedToday(r, capKey)} used today); ask the captain, or raise it with fm.js config <repo> caps.${capKey} <n>`);
  }
  const results = await Promise.all(members.map((m) => runOne(r, m, cfg)));
  return results.map((res) => ({ ...res, ...record(r, res) }));
}

function format(res) {
  const { m, usage } = res;
  const head = `[fm] crew ${m.task} (${m.role}, ${m.model.id}): ${res.ok ? 'done' : 'FAILED'} in ${Math.round(res.ms / 1000)}s, tokens in ${usage.input_tokens || 0} (cached ${usage.cache_read_tokens || 0}) out ${usage.output_tokens || 0}; report ${res.file}`;
  const said = res.ok ? String(res.json.response || '').trim() : '';
  const body = res.ok ? (said ? said.split('\n').slice(0, 80).join('\n') : '(no report: the agent stopped without a final message; its transcript is conversation ' + (res.json.conversation_id || '?') + ')') : `ERROR: ${res.error}`;
  return `${head}\n${body}`;
}

module.exports = { crew, format, CrewError, ROLES, agyPath, prepare };
