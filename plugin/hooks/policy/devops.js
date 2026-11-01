// The devops pack: agents read clusters, cloud and buckets; every change goes through GitOps or the captain.
const { PROD_RE, words, sub } = require('./shell');

const KUBE_FLAGS = new Set(['-n', '--namespace', '--context', '--kubeconfig', '--cluster', '--user', '-s', '--server', '--as', '--token', '--request-timeout']);
const KUBE_READ = new Set(['get', 'describe', 'logs', 'top', 'events', 'explain', 'api-resources', 'api-versions', 'version', 'cluster-info']);
const KUBE_READ_SUB = { config: ['view', 'get-contexts', 'current-context', 'get-clusters'], auth: ['can-i', 'whoami'], rollout: ['status', 'history'] };
const HELM_DENY = new Set(['install', 'upgrade', 'uninstall', 'delete', 'rollback', 'push']);
const HELMFILE_DENY = new Set(['apply', 'sync', 'destroy', 'delete', 'deps']);
const TF_DENY = new Set(['apply', 'destroy', 'import', 'taint', 'untaint', 'force-unlock']);
const GCLOUD_DENY = new Set(['create', 'delete', 'update', 'deploy', 'resize', 'set-iam-policy', 'add-iam-policy-binding', 'remove-iam-policy-binding',
  'reset', 'stop', 'start', 'suspend', 'resume', 'rollback', 'import', 'patch', 'move', 'rename', 'restore', 'set-machine-type',
  'attach-disk', 'detach-disk', 'add-tags', 'remove-tags', 'add-metadata', 'remove-metadata', 'rm', 'mv', 'rsync']);
const GSUTIL_DENY = new Set(['rm', 'mv', 'setmeta', 'acl', 'iam', 'defacl', 'lifecycle', 'retention']);
const toBucket = (w) => { const args = w.slice(1).filter((x) => !x.startsWith('-')); return /^gs:\/\//.test(args[args.length - 1] || ''); };

function judge(seg, { deny, ask }) {
  const w = words(seg);
  const p = w[0];
  if (!p) return null;
  const s = (vf) => sub(w, vf);
  if (p === 'kubectl' || p === 'oc') {
    const { name, rest } = s(KUBE_FLAGS);
    if (!name || KUBE_READ.has(name)) return null;
    if (KUBE_READ_SUB[name] && KUBE_READ_SUB[name].includes(rest.find((x) => !x.startsWith('-')))) return null;
    return deny(`is not a read (agents may only run kubectl ${[...KUBE_READ].join(', ')}, config view, auth can-i, rollout status; changes, exec and port-forward go through GitOps or the captain)`);
  }
  if (p === 'helm') return HELM_DENY.has(s(new Set(['-n', '--namespace', '--kube-context', '--kubeconfig'])).name) ? deny('changes a Helm release') : null;
  if (p === 'helmfile') return w.some((x) => HELMFILE_DENY.has(x)) ? deny('applies Helm releases') : null;
  if (p === 'terraform' || p === 'tofu' || p === 'terragrunt') {
    const i = w.indexOf('state');
    return w.some((x) => TF_DENY.has(x)) || (i > 0 && ['rm', 'mv', 'push', 'replace-provider'].includes(w[i + 1])) ? deny('changes infrastructure or its state') : null;
  }
  if (p === 'gcloud') {
    if (w[1] === 'config' || w[1] === 'auth') return null;
    if (w.includes('ssh') || w.includes('scp')) return ask('opens a remote shell');
    if (w.includes('cp') && toBucket(w)) return deny('writes to a bucket');
    return w.slice(1).some((x) => !x.startsWith('-') && GCLOUD_DENY.has(x)) ? deny('changes cloud resources') : null;
  }
  if (p === 'gsutil') {
    const { name } = s(new Set(['-o', '-h', '-u']));
    return GSUTIL_DENY.has(name) || (['cp', 'rsync'].includes(name) && toBucket(w)) ? deny('changes a bucket') : null;
  }
  if (p === 'ssh' || p === 'scp' || (p === 'rsync' && w.slice(1).some((x) => /^[^-/][^\s]*:/.test(x)))) return ask('runs on a remote host');
  return null;
}

module.exports = { judge, PROD_RE };
