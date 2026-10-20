# antigravity-firstmate

A plugin for the **Google Antigravity App** that lets **Gemini Argon** run a crew of **Gemini Flash** subagents.

Argon is strong but uses up its quota quickly. Flash is cheap, but left alone it tends to ship small, incremental fixes and confident-sounding claims it can't back up. This plugin puts each model where it is good:

- **First mate (Argon)** restates the goal, splits it into tasks, briefs the crew, judges the results and merges. It never edits project files itself.
- **Workers (Flash)** do the actual work, each in its own git worktree, so parallel tasks don't overwrite each other.
- **Checker (Flash)** verifies each branch against the *original* request, not against the plan. For code it runs the tests and at least 12 adversarial inputs of its own.
- Only branches that pass the check get merged.

The idea comes from the "captain → first mate → crew" pattern: you talk only to the first mate, and the first mate reports outcomes with evidence.

## Install

Requires the Antigravity **App** (the IDE has no subagents) and Node.js 18+.

```bash
npx -y github:cuongtt0201/antigravity-firstmate
```

Then restart the Antigravity App. **Firstmate Crew** should appear under Customizations → Plugins.

To update, run the same command again; the previous copy is backed up to your temp folder. To remove it:

```bash
npx -y github:cuongtt0201/antigravity-firstmate --uninstall
```

The installer copies `plugin/` to `~/.gemini/config/plugins/flash-ultra/` and fills in absolute paths for your machine. It also enables the plugin in `~/.gemini/config/config.json` (after backing up that file) and makes the installed copy read-only, so agents cannot edit their own guardrails.

## Setup that matters

1. **Turn off Terminal Sandbox** (Settings). With the sandbox on, a worker inside its worktree cannot run `git` (the repository's `.git` lives outside the sandbox), `pip` or `uv` (no network).
2. **Make the project a git repo *before* adding it to Projects.** The App decides whether worktrees are available when the folder is added. If it was added too early, the App says "Worktrees are not available for this project"; remove the project and add it again.
3. **Open the main chat in Local mode**, not New Worktree, so merges land on `main`.
4. Pick the **firstmate** agent with **Gemini 4 Argon**, then type `/firstmate <what you want>`.

Optional: `brew install uv` lets workers use the official Science plugin's skills (arXiv, OpenAlex, UniProt…).

## Usage

```text
/firstmate Read TASK.md and complete it, with tests
/firstmate Add slugify_unique(titles) to slugify.py with tests. Merge into main.
/best Write a one-page project proposal from notes.md
```

Behind `/firstmate`, the first mate runs these steps:

1. **Intake**: restates the goal and acceptance criteria. If something is unclear, it asks you one question.
2. **Init**: makes the project a git repo with a base commit.
3. **Scout** (when there are unknowns): read-only workers look into the rules, the data and prior art, including a web search.
4. **Plan**: `.firstmate/plan.md`, with the files each task owns and the check command for each task.
5. **Build**: workers run in parallel, each in its own worktree, and commit on their own branch.
6. **Check**: a checker verifies each branch.
7. **Merge or fix**: up to 2 fix rounds per branch.
8. **Report**: what shipped, the evidence, and any open issues.

`/best` is for one-off deliverables such as reports, analyses or non-trivial code. Three workers write independent full versions from different angles, checkers score each one, Argon picks the winner and lists the fixes, and a worker rewrites the final version from scratch.

## What's inside

| Path | Purpose |
|---|---|
| `agents/firstmate.md` | Main agent (Argon). Plans, delegates, judges, merges; never edits project files |
| `agents/worker.md` | Flash worker. Inherits installed skills, plugins and MCP servers; has web search |
| `agents/checker.md` | Flash checker, read-only. Traces every claim to the source; runs tests plus adversarial inputs on code |
| `skills/firstmate` | The `/firstmate` workflow |
| `skills/best` | The `/best` best-of-N workflow |
| `rules/AGENTS.md` | Always on: calm tone, no invented facts, get it right in the first full version |
| `hooks/guard.js` | Pins worker and checker to Flash (the App otherwise passes `Model: "inherit"`), stops read loops, blocks edits to the plugin |
| `scripts/fm-*.sh` | `fm-init` (repo plus base commit), `fm-status` (branches and worktrees), `fm-merge` (safe merge that aborts on conflict) |

## Early results

These come from the author's machine on Antigravity App 2.24, over a handful of runs. Read them as indications, not benchmarks.

- **Small coding task** (`slugify` plus tests) via `/firstmate`: done in about 12 minutes. The checker passed it with 18/18 adversarial inputs, and Argon accounted for about 20–24% of the tokens.
- **Same project with worktrees** (`slugify_unique`, `slugify_many`): each worker built and committed in its own worktree and the result was merged into `main`, with 31/31 tests passing.
- **`/best` on a coding task**: the final version passed 20/20 hidden tests.
- **ML competition planning** (analysis only, no training): Argon orchestrated Flash scouts. Rubric score went from 20.5/25 to 22/25 once workers could search the web, and Argon used about 13–16% of the new input and output tokens.

## Known limitations

- Worktrees depend on the App's `Workspace: "branch"` mode, which needs the two setup steps above.
- Git-ignored data is not copied into worktrees. The first mate passes workers the absolute data path in the main project folder.
- The checker is good but not exhaustive; it has missed an edge case or two. Review merges as you would any PR.

## Contributing

Edit files under `plugin/`, reinstall with `node install.js`, and try the change in the App. Issues and PRs are welcome.

## License

MIT
