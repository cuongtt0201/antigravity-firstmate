// firstmate: automatic checks for the files a task changed. Used by `fm.js gate`.
//   node fm-checks.js <workspace> <base-ref> [<captain checkout>]
// One line per check (PASS / FAIL / SKIP); fails if any check failed.
// SKIP means the tool is missing or the check does not apply; it never fails the gate.
// YAML and helmfiles are read with the bundled js-yaml, so no ruby is needed.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('./vendor/js-yaml.js');

const WIN = process.platform === 'win32';
const cache = {};
function has(cmd) {
  if (!(cmd in cache)) cache[cmd] = spawnSync(WIN ? 'where' : 'which', [cmd], { stdio: 'ignore' }).status === 0;
  return cache[cmd];
}

function runChecks(w, base, main) {
  const out = [];
  let fails = 0; let ran = 0;
  const pass = (label) => { out.push(`PASS  ${label}`); ran += 1; };
  const fail = (label, text) => {
    out.push(`FAIL  ${label}`);
    out.push(...String(text).trim().split('\n').slice(-25).map((l) => `      ${l}`));
    fails += 1; ran += 1;
  };
  const skip = (label) => out.push(`SKIP  ${label}`);
  const exec = (cmd, args, cwd = w) => {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return { ok: r.status === 0, text: `${r.stdout || ''}${r.stderr || ''}${r.error ? r.error.message : ''}` };
  };
  const run = (label, cmd, args) => { const r = exec(cmd, args); if (r.ok) pass(label); else fail(label, r.text); };
  const check = (label, fn) => { try { fn(); pass(label); } catch (e) { fail(label, e.message); } };
  const read = (f) => fs.readFileSync(path.join(w, f), 'utf8');

  const diff = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMR', base, 'HEAD'], { cwd: w, encoding: 'utf8' });
  const changed = (diff.stdout || '').split('\n').filter(Boolean);
  if (!changed.length) return { pass: true, log: 'no changed files' };
  out.push('changed files:', ...changed.map((f) => `  ${f}`));

  const charts = []; const helmfiles = [];
  for (const f of changed) {
    const b = path.posix.basename(f);
    if (/\.ya?ml$/.test(f)) {
      if (/(^|\/)templates\//.test(f) || read(f).includes('{{')) skip(`yaml ${f} (go template; checked by helm)`);
      else check(`yaml ${f}`, () => yaml.loadAll(read(f)));
    } else if (f.endsWith('.json')) {
      check(`json ${f}`, () => JSON.parse(read(f)));
    } else if (f.endsWith('.sh')) {
      if (!WIN && has('bash')) run(`bash -n ${f}`, 'bash', ['-n', f]);
      else skip(`bash -n ${f} (no bash on this system)`);
    } else if (f.endsWith('.py')) {
      const py = has('python3') ? 'python3' : (has('python') ? 'python' : '');
      if (py) run(`python syntax ${f}`, py, ['-c', 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1])', f]);
      else skip(`python syntax ${f} (python not found)`);
    } else if (f.endsWith('.tf')) {
      if (has('terraform')) run(`terraform fmt ${f}`, 'terraform', ['fmt', '-check', '-diff', f]);
      else skip(`terraform fmt ${f} (terraform not found)`);
    } else if (f.endsWith('.hcl')) {
      if (!has('terragrunt')) skip(`hcl fmt ${f} (terragrunt not found)`);
      else if (exec('terragrunt', ['hcl', 'fmt', '--help']).ok) run(`terragrunt hcl fmt ${f}`, 'terragrunt', ['hcl', 'fmt', '--check', '--file', f]);
      else run(`terragrunt hclfmt ${f}`, 'terragrunt', ['hclfmt', '--terragrunt-check', '--terragrunt-hclfmt-file', f]);
    }
    if (b === 'Dockerfile' || b.endsWith('.Dockerfile')) {
      if (has('hadolint')) run(`hadolint ${f}`, 'hadolint', [f]); else skip(`hadolint ${f} (not installed)`);
    }
    // nearest Chart.yaml / helmfile.yaml above the changed file
    let d = path.posix.dirname(f);
    for (;;) {
      if (fs.existsSync(path.join(w, d, 'Chart.yaml'))) { if (!charts.includes(d)) charts.push(d); break; }
      if (fs.existsSync(path.join(w, d, 'helmfile.yaml'))) { if (!helmfiles.includes(d)) helmfiles.push(d); break; }
      if (d === '.') break;
      d = path.posix.dirname(d);
    }
  }

  for (const c of charts) {
    if (has('helm')) run(`helm lint ${c}`, 'helm', ['lint', c]); else skip(`helm lint ${c} (helm not found)`);
  }

  for (const h of helmfiles) {
    if (!has('helm')) { skip(`helm template ${h}/helmfile.yaml (helm not found)`); continue; }
    let plan;
    try { plan = helmfileReleases(path.join(w, h, 'helmfile.yaml')); } catch (e) { fail(`read ${h}/helmfile.yaml`, e.message); continue; }
    for (const p of plan) {
      if (p.skip) { skip(`helm template ${h}: ${p.skip}`); continue; }
      let cdir = path.isAbsolute(p.chart) ? p.chart : path.join(w, h, p.chart);
      // charts vendored as git submodules are not checked out in task workspaces: use the captain's copy
      const rel = path.relative(w, cdir);
      if (!fs.existsSync(path.join(cdir, 'Chart.yaml')) && main && fs.existsSync(path.join(main, rel, 'Chart.yaml'))) cdir = path.join(main, rel);
      if (!fs.existsSync(path.join(cdir, 'Chart.yaml'))) { skip(`helm template ${h}: ${p.name} (chart ${p.chart} not available locally; submodule not checked out?)`); continue; }
      const args = ['template', p.name, cdir];
      if (p.namespace) args.push('-n', p.namespace);
      for (const v of p.values) args.push('-f', path.join(w, h, v));
      const r = exec('helm', args);
      if (r.ok) pass(`helm template ${h}: ${p.name}`);
      else if (/missing in charts\/ directory|update the dependencies|dependencies.*(missing|not found)/i.test(r.text)) skip(`helm template ${h}: ${p.name} (chart dependencies not built locally; run helm dependency build to check)`);
      else fail(`helm template ${h}: ${p.name}`, r.text);
    }
  }

  if (!ran) out.push('no automatic check applies to these files; review the diff');
  out.push(`checks run: ${ran}, failed: ${fails}`);
  return { pass: fails === 0, log: out.join('\n') };
}

// The releases of a helmfile.yaml that can be rendered locally with `helm template`.
// Only local charts (paths starting with . or /) and plain values files are rendered; go-templated
// helmfiles, remote charts and inline values maps are reported as skips.
function helmfileReleases(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes('{{')) return [{ skip: `${path.basename(file)} uses go templates; render it in CI with helmfile` }];
  const releases = yaml.loadAll(text).flatMap((d) => (d && typeof d === 'object' && Array.isArray(d.releases) ? d.releases : []));
  if (!releases.length) return [{ skip: 'no releases found' }];
  const plan = [];
  for (const r of releases) {
    const name = String(r.name || ''); const chart = String(r.chart || '');
    if (!chart.startsWith('.') && !chart.startsWith('/')) { plan.push({ skip: `${name}: chart '${chart}' is not a local path` }); continue; }
    const all = Array.isArray(r.values) ? r.values : [];
    const values = all.filter((v) => typeof v === 'string');
    if (all.length > values.length) plan.push({ skip: `${name}: ${all.length - values.length} inline values block(s) not included` });
    plan.push({ name, namespace: String(r.namespace || ''), chart, values });
  }
  return plan;
}

module.exports = { runChecks, helmfileReleases };

if (require.main === module) {
  const [w, base, main] = process.argv.slice(2);
  const { pass, log } = runChecks(w, base, main);
  process.stdout.write(`${log}\n`);
  process.exitCode = pass ? 0 : 1;
}
