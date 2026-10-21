# antigravity-firstmate

A plugin for the **Google Antigravity App** that lets **Gemini Argon** run a crew of **Gemini Flash** subagents for everyday repo work: reading code, chasing incidents, and changing config, IaC, CI and code.

Argon is strong but uses up its quota quickly. Flash is cheap, but left alone it guesses at project context, ships small fixes, and makes confident claims it can't back up. The plugin puts each model where it is good, and puts code where neither should be trusted:

- **First mate (Argon)** routes your message to a playbook, briefs the crew and judges their evidence. It answers small questions from its own reads, within a budget of 6 per message; bulk reading goes to the crew. It never edits your checkout.
- **Flash crew, one role each, each with its own rules and report format:** explorers read code, config and command output and cite `file:line`; workers make a change in the model's own task workspace; a checker verifies it against your original request.
- **Code checks the change** (`helm template`, lint, `terraform fmt`, your tests) before anything reaches you.
- **Claims are labelled** measured, inferred or guess, nothing is invented, and every recommendation ends with the gotchas you did not ask about.
- **You stay in charge of git and the live systems.** Changes arrive in your working tree as uncommitted edits; you commit, push and apply. A guard hook blocks agents from applying, deleting, scaling or pushing.

## How it works

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

Every message goes to a playbook. The first mate names it on the first line of its reply and copies its steps as a checklist; `/how`, `/investigate` and `/change` force one.

| Playbook | For | What you get |
|---|---|---|
| **quick** | "dig domain này", "lệnh nào để…" | A short answer with the why, no subagents |
| **how** | "source này upload lên bucket ở đâu", "đổi sang provider khác thì sửa gì" | 1 to 4 explorers read in parallel; overview, `file:line`, smallest change, gotchas, unknowns |
| **investigate** | a pod restarting, an alert, a pipeline that won't trigger, a failing API call | Cause and confidence, the evidence lines, and the fix as commands for you to run |
| **change** | Helm values, alert rules, `.gitlab-ci.yml`, Terraform, scripts, code | A plan, then (after your go) a checked change in your working tree, uncommitted |

The sequence of a change, the workspace model and the full guard table are in [docs/architecture.md](docs/architecture.md).

## Install

Requires the Antigravity **App** (the IDE has no subagents), Node.js 18+, `git` and `bash`. `helm`, `terraform`/`terragrunt` and `ruby` (for YAML and helmfile checks) are used when present.

```bash
npx -y github:cuongtt0201/antigravity-firstmate
```

Restart the Antigravity App. **Firstmate Crew** should appear under Customizations → Plugins. To update, run the same command again (the previous copy is backed up to your temp folder). To remove it:

```bash
npx -y github:cuongtt0201/antigravity-firstmate --uninstall
```

The installer copies `plugin/` to `~/.gemini/config/plugins/flash-ultra/`, fills in the absolute paths for your machine, enables the plugin in `~/.gemini/config/config.json` (after backing it up) and makes the installed copy read-only, so agents cannot edit their own guardrails.

## Setup

1. **Turn off Terminal Sandbox** in Settings. With it on, workers cannot run `git`, `helm` or package installs inside task workspaces.
2. Open a chat in **Local** mode, pick the **firstmate** agent with **Gemini 4 Argon**, and talk normally. Quick one-off questions are cheaper in a plain Flash chat.
3. **After every update, re-select the agent** in the agent picker (pick another agent, then firstmate). The App stores a snapshot of the selected agent's prompt and tools (`new-convo-selected-agent` in `app_storage.json`) and keeps using it for new chats; restarting the App does not refresh it.

## Your branches stay yours

The model works in its own space inside your repo and never touches your branches:

- Task workspaces are detached worktrees under `.firstmate/wt/`, tracked by `refs/firstmate/*`. They never show up in `git branch` and are never pushed.
- `.firstmate/` is hidden through `.git/info/exclude`, which exists only on your machine. The shared `.gitignore` is not changed, and nothing is committed for you.
- A finished change is applied to your working tree, uncommitted. If you have unsaved edits in the same files, delivery stops and tells you; if it cannot apply cleanly, the task is kept.
- Git-ignored `node_modules`, `.venv` and `.env` are linked into task workspaces from your checkout so tests run there; they are never saved into a task.
- `.firstmate/facts.md` keeps what the first mate learned about the repo (which services are Node, what has tracing, environments). When you correct it, it writes the fact down so the next chat does not repeat the mistake.

## Safety

The first mate's own budget: at most 6 direct file reads or command segments per message of yours (its facts, notes, the playbooks and the workspace script are free). After that it must send explorers. Explorers are read-only by rule and by the guard: no file edits, redirects into files, moves, deletes, git changes or package installs. Budget resets are logged to `$TMPDIR/flash-ultra-loop-guard/budget.log`.


The guard hook runs on every tool call while the plugin is enabled:

- **Allowed:** reading (`kubectl get/describe/logs/top`, `git log/diff`, `helm template`, `terraform plan`, `gcloud … list`), downloads from buckets.
- **Denied, you run it:** `kubectl apply/delete/patch/scale/rollout restart/drain…`, `helm install/upgrade/uninstall`, `helmfile apply/sync`, `terraform/terragrunt apply/destroy/import/state rm`, `gcloud … create/delete/update`, writes to `gs://`, `git push`.
- **Asks you first:** `kubectl exec` into prod pods, `kubectl cp/debug/run`, `ssh`, `scp`.
- Also: worker and checker are pinned to Flash, at most 12 subagents per chat per day, repeated reads of the same file are stopped, and agents cannot edit the plugin.

It reads command text, so it is a safety net, not a sandbox.

## What's inside

| Path | Purpose |
|---|---|
| `agents/firstmate.md` | Main agent (Argon): routing, hard rules, workspace script |
| `agents/explorer.md` | Flash explorer, read-only; EXPLORER REPORT with `file:line` evidence and measured/inferred/guess labels |
| `agents/worker.md` | Flash worker; WORKER REPORT with the check it ran and evidence |
| `agents/checker.md` | Flash checker, read-only; VERDICT PASS / ISSUES / BLOCKED; code mode and config mode |
| `skills/firstmate/playbooks/` | quick, how, investigate, change: the steps the first mate copies as its checklist |
| `skills/firstmate`, `skills/how`, `skills/investigate`, `skills/change` | `/firstmate`, and the commands that force a playbook |
| `skills/best` | `/best`: three independent drafts, scored, rewritten from the winner |
| `rules/AGENTS.md` | Always on: calm tone, no invented facts, never change live systems |
| `hooks/guard.js` | The guard described above, including the first mate's read budget |
| `hooks/inject.js` | Injects `.firstmate/facts.md` when a chat starts, and each role's short rules before every model turn |
| `scripts/fm.sh` | The model's workspace: `init`, `fact`, `start`, `save`, `gate`, `deliver`, `status`, `clean` |
| `scripts/fm-checks.sh`, `scripts/fm-helmfile.rb` | Automatic checks picked from the changed files, including `helm template` for helmfile releases with local charts |

## Early results

From the author's machine on Antigravity App 2.24, over a handful of runs with the earlier merge-based flow. Read them as indications, not benchmarks.

- **Small coding task** (`slugify` plus tests): about 12 minutes; the checker passed it with 18/18 adversarial inputs; Argon used about 20–24% of the tokens ([breakdown](docs/architecture.md#where-the-tokens-go)).
- **Parallel workers in worktrees** (`slugify_unique`, `slugify_many`): each worker built and committed in its own worktree, 31/31 tests passing.
- **`/best` on a coding task**: the final version passed 20/20 hidden tests.
- **ML competition planning** (analysis only): rubric score rose from 20.5/25 to 22/25 once workers could search the web; Argon used about 13–16% of the tokens.

## Known limitations

- macOS and Linux only for now; Windows needs path fixes in the installer and the guard.
- The gate checks syntax and rendering, not behaviour. Review the diff as you would any PR.
- Charts vendored as git submodules render only if they are checked out in your own clone; otherwise the gate reports SKIP.

## Contributing

Edit files under `plugin/`, run `bash tests/run.sh` (guard policy, the first mate's budget, context hooks and the fm.sh workspace; needs git, node and ruby), reinstall with `node install.js`, and try the change in the App. Issues and PRs are welcome.

## License

MIT
