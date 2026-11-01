<p align="center">
  <img src="plugin/assets/logo.svg" width="96" alt="firstmate logo">
</p>

<h1 align="center">firstmate</h1>

<p align="center">
  <b>One cheap brain in the chat. A whole crew in parallel. A strong judge only when it matters.</b><br>
  A plugin for Google Antigravity (IDE, App and CLI): a first mate splits your request into tasks, a Gemini Flash crew works on them in parallel, code gates every change, and what passes is merged with an undo.
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=5EgJ6cQqRFo">
    <img src="https://img.youtube.com/vi/5EgJ6cQqRFo/maxresdefault.jpg" width="720" alt="Watch: from an empty folder to a shipped docs chatbot with firstmate (90 s, v0.12)">
  </a><br>
  <sub>▶ <a href="https://www.youtube.com/watch?v=5EgJ6cQqRFo">The 90-second demo</a> shows v0.12; v1 works the same way with less waiting on you.</sub>
</p>

```bash
npx -y github:cuongtt0201/antigravity-firstmate
```

> **v1.0.0-alpha.1.** This is the first version built for the Antigravity IDE. See [What changed in v1](#what-changed-in-v1).

---

## Why firstmate

**Gemini Argon** reasons well, but a chat that runs on it rereads the whole conversation on every turn and burns through your quota. **Gemini Flash** is cheap and fast, but left alone it guesses, ships half a fix and makes claims it cannot back up.

firstmate puts each model where it pays off:

- **The first mate (System 1) runs in your chat on a cheap model.** It answers what is small and turns real work into tasks.
- **The crew runs in parallel, on Flash.** Each builder works in its own git worktree, outside your repo. Readers answer one question each, with `file:line` evidence. Hard tasks get an *arena*: three builders try three approaches.
- **Code decides what models should not.** It runs the gates (your project's typecheck, lint and test, plus Helm, Terraform, YAML and JSON checks). It classifies the risk of every change, and it decides the next step (`fm.js ladder`).
- **The judge (System 2) is Argon, called only when the risk calls for it.** It reads a 30 KB dossier of the task, never your chat history.
- **You stay in charge of what matters.** Low-risk changes that pass are merged. Medium-risk ones are merged once the judge approves. High-risk ones wait for you. Every merge can be undone with one command.

On one real task (fix a unicode bug against a locked test, with an arena and two judge calls), Argon used **12%** of the tokens. A v0.12 chat measured 44–57%. See [docs/benchmarks.md](docs/benchmarks.md).

## How it works

```mermaid
flowchart TB
  you(["You (captain)"])
  fm["<b>First mate</b> · System 1 · in your chat (Flash by default)<br/>answers, splits work into tasks, follows fm.js ladder"]
  subgraph crew["Crew · headless agy processes, in parallel"]
    direction LR
    b1["builder<br/><i>task A workspace</i>"]
    b2["builder<br/><i>task B workspace</i>"]
    rd["reader<br/><i>read-only, file:line</i>"]
  end
  gate["fm.js gate<br/>project tests, lint, typecheck<br/>locked acceptance tests"]
  risk["fm.js risk<br/>low · medium · high"]
  judge["<b>Judge</b> · System 2 · Argon<br/>reads the task's dossier only"]
  tree[("Your branch<br/>one commit per task, fm.js undo")]

  you <-->|"message / report"| fm
  fm -->|"fm.js crew --batch"| crew
  b1 --> gate
  b2 --> gate
  gate --> risk
  risk -->|"medium"| judge
  judge -->|"APPROVE"| tree
  risk -->|"low"| tree
  risk -->|"high: waits for you"| you
```

A change, as the first mate runs it:

1. **Tasks.** One task per independent part, so they run in parallel and merge cleanly: `fm.js start <repo> <task> --request "<your words>"`.
2. **Acceptance tests first** for medium- or high-risk work. A builder in the tester role writes them, `fm.js lock` freezes them, and the crew can no longer change them (the gate fails and the guard refuses).
3. **Crew.** `fm.js crew <repo> --batch <file>` starts every builder at once as a headless `agy` process in its own workspace. When a builder stops, fm.js records its work and runs the gate.
4. **Ladder.** `fm.js ladder <repo> <task>` reads the task's record and says what comes next: `fix` (send the failing lines back), `arena 3`, `judge`, `deliver`, or `ask captain`.
5. **Judge.** `fm.js judge` runs Argon once on the task's dossier: request, done-when, risk, locked tests, gate lines, the diff with every unchanged caller. It returns APPROVE, REVISE, REJECT or HUMAN.
6. **Deliver.** `fm.js deliver` merges the task the way the repo is set: `propose`, `apply` (uncommitted) or `commit` (one commit per task, trailer `Firstmate-Task:`). High risk stops with exit 3 until you say yes.
7. **Report.** `fm.js report` lists what was merged, what waits for you and why, and the crew's tokens with the strong model's share. `fm.js trust` shows how many merges you kept.

## What you can ask

Talk normally. In the IDE, start a chat with `/firstmate`. In the App or the CLI, pick the `firstmate` agent.

| You say | The first mate |
|---|---|
| "Which port does the API listen on?" | Reads up to three files itself and answers |
| "How does the upload flow work?" | Readers in parallel, one angle each, with `file:line` evidence |
| "The pod keeps restarting on prod" | Hypotheses, one reader each, and the fix as commands for you to run |
| "Add retry with backoff to the API client" | Tasks, builders in parallel, gates, the judge if needed, then a commit per task |
| "Write the case study" | `/best`: three drafts race and the winner is rewritten from scratch |

## Safe by default

The guard hook runs on every tool call of the first mate and the crew, in the IDE, the App and the CLI:

- **Core pack** (always on):
  - no `git push`;
  - no publishing (`npm publish`, `twine upload`, `docker push`…);
  - nothing that destroys your uncommitted work (`reset --hard`, `clean -f`, `checkout -- .`, `branch -D` in your checkout);
  - no secrets in a command line or written into a file (AWS keys, private keys, GitHub/Slack/Google tokens);
  - production database clients ask you first;
  - no package installs over the `node_modules` a workspace borrows from your checkout.
- **DevOps pack** (on by default, off with `fm.js config <repo> packs '["core"]'`): reads only for `kubectl`, `helm`, `terraform`, `gcloud`, `gsutil`; `ssh` asks.
- **Roles hold.** Readers and the judge cannot write. Builders cannot touch locked tests, gate results, notes, facts, settings or verdicts. Only the first mate decides, merges and starts more crew.
- **Crew permissions stay narrow.** Builders run in the CLI's `accept-edits` mode: file edits inside their workspace are approved, and shell commands are not. Readers and the judge run in `auto` mode.

The guard reads command text, so it is a safety net, not a sandbox.

## Requirements

- Google Antigravity: the IDE, the App, or the CLI.
- **The Antigravity CLI (`agy`)** for the crew: it runs headless crew processes. `node install.js --check` tells you if it is there.
- macOS, Linux or Windows, `git`, and **Node.js 22.13 or newer**.
- Optional, used when present: `helm`, `terraform` / `terragrunt`, `hadolint`, `python3`.

## Install

```bash
npx -y github:cuongtt0201/antigravity-firstmate
```

To check what your machine has without installing anything, add `--check`. Then:

1. **Restart Antigravity.** **Firstmate Crew** appears under Customizations → Plugins.
2. **IDE:** type `/firstmate` at the start of a chat. **App:** pick the **firstmate** agent; after every update re-select it (pick another agent, then firstmate), because the App keeps a snapshot of the selected agent.
3. **Once per repo**, the first mate runs `fm.js init` and `fm.js detect --write`, so your tests and linters become part of every gate. Choose how merges land with `fm.js config <repo> merge commit` (or `apply` / `propose`).

To remove it:

```bash
npx -y github:cuongtt0201/antigravity-firstmate --uninstall
```

## What changed in v1

| v0.12 | v1 |
|---|---|
| Argon was the main agent and reread the whole chat on every turn | The first mate runs on Flash; Argon is the judge, called with a dossier |
| Fixed playbooks (quick, how, investigate, change) and checklists on every reply | The first mate decides; code decides the gates, the risk and the next step (`fm.js ladder`) |
| In-chat subagents only (App) | The crew runs as headless `agy` processes, so it works in the IDE, the App and the CLI |
| Explorer, worker, checker | Reader, builder, judge, each with the role the first mate writes in the brief |
| Every change waited for "go" and landed uncommitted | Merged by risk: low passes, medium needs APPROVE, high waits; one commit per task; `fm.js undo` |
| Workspaces in `<repo>/.firstmate/wt` | Workspaces in `~/.firstmate/wt/<repo>-<hash>/`, each with its own port slot (`FIRSTMATE_SLOT`, `PORT`) |
| Syntax checks | Your project's typecheck, lint and test in every gate, plus locked acceptance tests |
| One worker reused across tasks | A fresh builder for every task; the arena for hard ones |

Tasks started under v0.12 inside the repo still work. `fm.js clean <repo> --legacy` lists worker branches that old versions left behind, and removes them with `--yes`.

## Known limitations

- **Alpha.** The full flow ran end to end on a real task (see benchmarks). Larger runs are still to come.
- In the IDE, the plugin's `SessionStart` and `PreInvocation` hooks are not confirmed yet. The guard runs. `tools/probe/` and [docs/ide-capabilities.md](docs/ide-capabilities.md) describe how to check the rest.
- Headless crew runs end when the CLI refuses a command, so builders edit with file tools only and fm.js runs the checks after them.
- The judge and the crew are all Gemini unless you set `models.second` (a model of another family) and call `fm.js judge --model second`.
- `fm.js review` finds uses of changed names with `git grep`; calls through variables or reflection are not listed.
- Prompt rules guide the models; only the hooks and scripts enforce.

## Contributing

Edit files under `plugin/`. Run `npm test` (git, node and bash are required; on Windows, Git Bash works). Reinstall with `node install.js`, then try the change. The v1 design and plan are in `docs/superpowers/`. Issues and PRs are welcome.

## License

MIT
