// Secrets that must not appear in a command line or be written into a file the agents produce.
const PATTERNS = [
  ['an AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['an AWS secret access key', /aws_secret_access_key\s*[=:]\s*["']?[A-Za-z0-9/+=]{20,}/i],
  ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['a GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36}\b/],
  ['a Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['a Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
];

function findSecret(text) {
  for (const [name, re] of PATTERNS) if (re.test(String(text))) return name;
  return null;
}

module.exports = { findSecret };
