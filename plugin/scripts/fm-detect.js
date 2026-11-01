// firstmate: the project's own checks (typecheck, lint, test), found from its manifests, for the gate.
//   fm.js detect <repo> [--write]   print them, or also store them as `checks` in the repo's config

const fs = require('fs');
const path = require('path');

const NPM_DEFAULT_TEST = /no test specified/;
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
const has = (dir, f) => fs.existsSync(path.join(dir, f));

function detectChecks(repo) {
  const checks = {};
  const pkg = readJson(path.join(repo, 'package.json'));
  if (pkg) {
    const pm = has(repo, 'pnpm-lock.yaml') ? 'pnpm' : has(repo, 'yarn.lock') ? 'yarn' : 'npm';
    const scripts = pkg.scripts || {};
    if (scripts.typecheck) checks.typecheck = `${pm} run typecheck --silent`;
    else if (has(repo, 'tsconfig.json') && ({ ...pkg.dependencies, ...pkg.devDependencies }).typescript) checks.typecheck = 'npx --no-install tsc --noEmit';
    if (scripts.lint) checks.lint = `${pm} run lint --silent`;
    if (scripts.test && !NPM_DEFAULT_TEST.test(scripts.test)) checks.test = `${pm} test --silent`;
  }
  if (has(repo, 'go.mod')) { checks.lint = checks.lint || 'go vet ./...'; checks.test = checks.test || 'go test ./...'; }
  if (has(repo, 'Cargo.toml')) checks.test = checks.test || 'cargo test --quiet';
  const pyproject = readText(path.join(repo, 'pyproject.toml'));
  const py = process.platform === 'win32' ? 'python' : 'python3';
  if (has(repo, 'pytest.ini') || /\[tool\.pytest/.test(pyproject)) checks.test = checks.test || `${py} -m pytest -q`;
  if (/\[tool\.ruff/.test(pyproject)) checks.lint = checks.lint || 'ruff check .';
  if (!checks.test && /^test:/m.test(readText(path.join(repo, 'Makefile')))) checks.test = 'make test';
  return checks;
}

module.exports = { detectChecks };
