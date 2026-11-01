// firstmate: how risky a task's change is, from its file list and size alone, so the decision does not depend
// on a model's mood. high waits for the captain; medium needs the judge's approval; low merges once the gate
// passes. A judge may raise the level, never lower it.

const HIGH = [
  ['auth or security code', /(^|\/)(auth|authn|authz|security|crypto|permissions?|acl|iam|oauth|session)s?(\/|\.|_|-)/i],
  ['database migration', /(^|\/)(migrations?|migrate|alembic|flyway|liquibase)\//i],
  ['SQL file', /\.sql$/i],
  ['CI pipeline', /(^|\/)(\.github\/workflows\/|\.gitlab-ci\.ya?ml$|Jenkinsfile$|azure-pipelines|\.circleci\/)/],
  ['infrastructure', /\.(tf|tfvars|hcl)$|(^|\/)Chart\.yaml$|(^|\/)values[^/]*\.ya?ml$|(^|\/)(k8s|kubernetes|helm|deploy|manifests)\/|(^|\/)Dockerfile[^/]*$|(^|\/)docker-compose[^/]*\.ya?ml$/i],
  ['dependencies', /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|Pipfile\.lock|go\.mod|go\.sum|Cargo\.lock|Gemfile\.lock|composer\.lock)$|(^|\/)requirements[^/]*\.txt$/],
  ['secrets or environment', /(^|\/)\.env(\.|$)|secret|credential|password|\.(pem|key|p12|pfx)$/i],
];
const LOW = [
  /\.(md|mdx|txt|rst|adoc)$/i,
  /(^|\/)(doc|docs|documentation)\//i,
  /(^|\/)(test|tests|__tests__|spec)\//i,
  /\.(test|spec)\.[^/]+$/i,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.(go|py)$/,
];
const BIG = 400;
const MEDIUM_LINES = 150;
const MEDIUM_FILES = 5;
const ORDER = ['low', 'medium', 'high'];

function classify({ files = [], changedLines = 0 } = {}) {
  const high = []; const medium = [];
  for (const f of files) {
    const p = String(f.path || '').replace(/\\/g, '/');
    if (f.status === 'D') high.push(`deletes ${p}`);
    for (const [why, re] of HIGH) if (re.test(p)) high.push(`${why}: ${p}`);
    if (!LOW.some((re) => re.test(p))) medium.push(`code or config: ${p}`);
  }
  if (changedLines > BIG) high.push(`${changedLines} changed lines (over ${BIG})`);
  if (changedLines > MEDIUM_LINES) medium.push(`${changedLines} changed lines (over ${MEDIUM_LINES})`);
  if (files.length > MEDIUM_FILES) medium.push(`${files.length} files (over ${MEDIUM_FILES})`);
  if (high.length) return { level: 'high', reasons: [...new Set(high)] };
  if (medium.length) return { level: 'medium', reasons: [...new Set(medium)] };
  return { level: 'low', reasons: ['docs and tests only, small'] };
}

const maxRisk = (a, b) => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);

module.exports = { classify, maxRisk, ORDER };
