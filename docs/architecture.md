# Architecture

How the Firstmate Crew plugin is put together, and what happens when you ask it something.

## Components

```mermaid
flowchart TB
  you(["You (captain)"])

  subgraph app["Antigravity App"]
    direction TB
    fm["<b>First mate</b> · Gemini Argon<br/>picks the playbook, briefs, judges<br/><i>never edits your checkout</i>"]
    subgraph crew["Crew · Gemini Flash"]
      direction LR
      inv["Explorers<br/><i>read-only, file:line evidence</i>"]
      wk["Workers<br/><i>edit one task workspace</i>"]
      ck["Checker<br/><i>read-only</i>"]
    end
    guard{{"guard.js hook: blocks live changes and pushes,<br/>asks before prod shells and ssh, pins crew to Flash"}}
  end

  subgraph repo["Your repo"]
    direction LR
    wt["Task workspaces<br/>.firstmate/wt/TASK<br/>refs/firstmate/TASK"]
    gate["fm.sh gate<br/>helm template, lint,<br/>terraform fmt, tests"]
    tree[("Your working tree<br/>on your branch")]
  end

  live[("Cluster, cloud, logs")]
  remote[("Git remote · GitOps")]

  you <-->|"message / report"| fm
  fm -->|"how / investigate brief"| inv
  fm -->|"change brief"| wk
  fm -->|"check task"| ck
  inv -.->|"get, describe, logs, top"| live
  wk -->|"edit"| wt
  wt --> gate
  gate ==>|"PASS: deliver, uncommitted"| tree
  tree -->|"you commit and push"| remote
  guard -.- crew
```

| Part | Model | Writes | Job |
|---|---|---|---|
| First mate (`agents/firstmate.md`) | Gemini Argon | `.firstmate/facts.md`, notes | Pick the playbook, brief explorers and workers, judge their evidence, deliver |
| Explorer (`agents/explorer.md`) | Gemini Flash | Nothing | Read code, config and command output for one angle; report findings with `file:line` evidence and measured/inferred/guess labels |
| Worker (`agents/worker.md`) | Gemini Flash | Only its task workspace | Make one change; report the check it ran and the evidence |
| Checker (`agents/checker.md`) | Gemini Flash | Nothing | Compare a change with the original request; for code, run tests and adversarial inputs; for config, list impact and unknown keys |
| `scripts/fm.sh` | n/a | Task worktrees and `refs/firstmate/*` | The model's own workspace: init, start, save, gate, deliver, status, clean |
| `hooks/guard.js` | n/a | n/a | PreToolUse hook on every tool call (see Safety), including the first mate's direct-read budget |
| `hooks/inject.js` | n/a | n/a | SessionStart: injects `.firstmate/facts.md`. PreInvocation: injects each role's short rules before every model turn |

## Playbooks

The first mate routes each message to a playbook (in `skills/firstmate/playbooks/`), names it on the first line, and copies its steps as a checklist, marking each done or `skip: <reason>`. `/how`, `/investigate` and `/change` force one. This follows the router-and-playbook pattern of Lauren Tan's pstack.

| Playbook | Typical request | What happens |
|---|---|---|
| **quick** | "dig crm-beta.globalcare.vn", "lệnh nào để kéo file từ bucket" | One command or up to three small reads by the first mate; a short answer with the why. |
| **how** | "source này upload lên bucket ở đâu", "chuyển sang provider khác cần sửa gì" | Goal in one line → facts → small scope: the first mate reads it itself, including catch blocks and auth; large scope: 2 to 4 explorers in parallel, always with an error-paths-and-security angle for changes and migrations → overview, how it works with `file:line`, smallest change, gotchas, unknowns. |
| **investigate** | "pod prod-core-insurance bị gì", "sao pipeline không trigger" | Symptom → hypotheses → one explorer per hypothesis (CONFIRMED / KILLED / OPEN) → cause, evidence, fix commands for you. Remote hosts and prod shells: you run the commands and paste the output. |
| **change** | "tăng retention tempo", "thêm alert rule", "sửa .gitlab-ci.yml" | Plan (smallest change, risk) → your go → worker edits a task workspace → `fm.sh gate` → checker → delivered to your working tree, uncommitted. |

Each role answers in a fixed format (EXPLORER REPORT, WORKER REPORT, checker VERDICT). The first mate rejects a report that lacks the evidence its format asks for, respawns once, and then lists the gap; a gap is never presented as a result.

Gemini follows written rules more loosely than the models pstack was built on, so two hooks back the playbooks with code: `inject.js` repeats each role's rules before every model turn, and `guard.js` gives the first mate 6 direct reads or commands per captain message. The budget resets on each new captain message (a new `USER_INPUT` step in the chat transcript; subagent reports and background-task completions do not count), with a fallback to a new execution or 5 idle minutes; resets are logged to `budget.log`. A chat the App has not indexed yet (its first model call) is treated as a first mate when it runs on Argon. The App keeps a snapshot of the selected agent's prompt and tools until the agent is re-selected in the picker, so after an update the old prompt can still be in use; the hooks always run the installed code.

```mermaid
sequenceDiagram
  actor C as You
  participant F as First mate (Argon)
  participant W as Worker (Flash)
  participant S as fm.sh
  C->>F: "thêm alert khi pod restart > 3"
  F->>S: init (facts, branch, uncommitted files)
  F-->>C: → change. Plan: files, check, risk. Go?
  C->>F: làm
  F->>S: start alert-restarts
  F->>W: brief: intent, workspace path, facts, check
  W-->>F: files changed
  F->>S: save, then gate
  S-->>F: PASS (yaml, helm template)
  F->>S: deliver
  S-->>C: uncommitted changes on your branch
  F-->>C: report: diff stat, gate output, next commands
```

## Workspace model: the model's branches stay out of yours

```mermaid
gitGraph
  commit id: "your commit"
  branch ft/your-feature
  commit id: "your work"
  commit id: "+ delivered change (you commit it)"
```

- A task is a **detached worktree** in `<repo>/.firstmate/wt/<task>`. Its commits are kept in `refs/firstmate/<task>/{base,head}`, not in `refs/heads`, so `git branch` never shows them and `git push` never sends them.
- `.firstmate/` is hidden through `.git/info/exclude`, which exists only on your machine. The shared `.gitignore` is never touched, and `fm.sh` never commits in an existing repo.
- `deliver` applies the task's diff to your working tree as **uncommitted** changes. It refuses if you have uncommitted edits in the same files, and uses a 3-way apply if your branch moved since the task started. You review `git diff`, then commit, push and open the MR as usual. Your history contains only your commits.
- Git-ignored `node_modules`, `.venv`, `vendor` and `.env` files are linked into each task workspace from your checkout, so builds and tests run; the links are excluded by exact path and never saved. Files a check leaves behind are removed after the gate.
- If your branch moved and the 3-way apply conflicts, the files are left with conflict markers and the task is kept; if the diff cannot be applied at all, nothing is changed and the task is kept.
- Charts vendored as git submodules are not checked out in task workspaces; the gate renders them from your checkout when they are there, and reports SKIP when they are not.

## Safety: what the guard does on every tool call

| Command | Decision |
|---|---|
| `kubectl get/describe/logs/top/events`, `git log/diff/show/status`, `helm template/lint/get`, `helmfile diff`, `terraform/terragrunt plan`, `gcloud … list/describe`, downloads from buckets | allowed |
| `kubectl apply/create/delete/edit/patch/replace/scale/set/label/annotate/drain/cordon/taint`, `kubectl rollout` (except status/history) | denied: you run it |
| `helm install/upgrade/uninstall/rollback`, `helmfile apply/sync/destroy` | denied |
| `terraform/terragrunt/tofu apply/destroy/import/taint/force-unlock`, `state rm/mv/push` | denied |
| `gcloud … create/delete/update/deploy/resize/…iam…`, `gsutil rm/mv`, uploads and syncs to `gs://` | denied |
| `git push` | denied |
| MCP tools whose name is a read (get, list, read, search, describe, … or `*_readonly`) | allowed |
| any other MCP tool (delete, create, update, execute_sql, send, push, merge, download, …, or an unknown verb such as query) | asks you every time; denied for explorers. Unknown verbs ask on purpose: safe by default |
| `kubectl exec` into anything named prod, `kubectl cp/debug/run/attach`, `ssh`, `scp`, remote `rsync`, `gcloud compute ssh` | asks you every time |
| Edits to the plugin or the hook config | denied |
| More than 12 subagents in one chat per day | denied until you say so |

The guard reads command text, so it is a safety net and not a sandbox: an obfuscated command can get past it. It applies to every chat while the plugin is enabled.

## Where the tokens go

Measured on a single small run (`slugify` plus tests, with the earlier merge-based flow) on the author's machine. Treat it as an illustration, not a benchmark. Argon tokens cost more and count against a separate quota, so the share that matters is Argon's: about 24% of new input and 20% of output.

```mermaid
%%{init: {"themeVariables": {"xyChart": {"plotColorPalette": "#1a73e8"}}}}%%
xychart-beta
  title "Tokens by role, one /firstmate run (thousands)"
  x-axis ["Argon: new input", "Flash: new input", "Argon: output", "Flash: output"]
  y-axis "Tokens (k)" 0 --> 70
  bar [19.9, 63.4, 6.3, 24.6]
```
