// Reading command text: split a command line into segments, and a segment into its program and arguments.
// The guard reads text only, so it is a safety net and can be fooled by obfuscation.

const WRAPPERS = new Set(['sudo', 'time', 'nohup', 'exec', 'command', 'env', 'xargs', 'watch']);
const SHELLS = new Set(['bash', 'sh', 'zsh']);

// "prod" or "production" as a whole name part (prod-core, gke_prod, -n production, db-prod.internal), not "products"
const PROD_RE = /(^|[\s/=_.:@-])prod(uction)?([\s/=_.:-]|$)/i;

function segments(cmd) { return String(cmd).split(/&&|\|\||;|\||\n|`|\$\(/); }

function words(seg) {
  let w = seg.trim().split(/\s+/).map((x) => x.replace(/^[('"{]+|[)'"};]+$/g, '')).filter(Boolean);
  while (w.length) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || WRAPPERS.has(w[0])) { w.shift(); continue; }
    if (w[0] === 'timeout') { w.splice(0, 2); continue; }
    if (w[0].toLowerCase() === 'set' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[1] || '')) { w.splice(0, 2); continue; } // cmd.exe: set X=1&& ...
    break;
  }
  if (w.length) w[0] = w[0].split(/[\\/]/).pop();
  if (SHELLS.has(w[0]) && w[1] === '-c') return words(w.slice(2).join(' '));
  return w;
}

// first non-flag word after the program name, skipping the values of flags that take one
function sub(w, valueFlags = new Set()) {
  for (let i = 1; i < w.length; i++) {
    const t = w[i];
    if (t.startsWith('-')) { if (!t.includes('=') && valueFlags.has(t)) i++; continue; }
    return { name: t, rest: w.slice(i + 1) };
  }
  return { name: '', rest: [] };
}

module.exports = { PROD_RE, segments, words, sub };
