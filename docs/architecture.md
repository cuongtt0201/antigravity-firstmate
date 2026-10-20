# Architecture

How the Firstmate Crew plugin is put together and what happens during a `/firstmate` run.

## Components

```mermaid
flowchart TB
  you(["You (captain)"])

  subgraph app["Antigravity App"]
    direction TB
    fm["<b>First mate</b> · Gemini Argon<br/>plans, briefs, judges, merges<br/><i>never edits project files</i>"]
    subgraph crew["Crew · Gemini Flash"]
      direction LR
      w1["Worker 1"]
      w2["Worker 2"]
      ck["Checker<br/><i>read-only</i>"]
    end
    caps[("Inherited skills,<br/>MCP, web search")]
    guard{{"guard.js hook: pins crew to Flash,<br/>stops read loops, protects the plugin"}}
  end

  subgraph repo["Your project · git"]
    direction LR
    wt1["worktree + branch 1"]
    wt2["worktree + branch 2"]
    main[("main")]
  end

  you <-->|"request / report"| fm
  fm -->|"check each branch"| ck
  ck -->|"PASS / FAIL"| fm
  fm -->|brief| w2
  fm -->|brief| w1
  caps -.-> crew
  guard -.- crew
  ck -.->|"tests + adversarial inputs"| wt2
  ck -.-> wt1
  w2 -->|commit| wt2
  w1 -->|commit| wt1
  wt1 ==>|"fm-merge.sh · PASS only"| main
  wt2 ==> main
```

| Part | Model | Can edit the project? | Job |
|---|---|---|---|
| First mate (`agents/firstmate.md`) | Gemini Argon | No, only notes under `.firstmate/` | Turn the request into tasks, brief workers, judge checker scorecards, merge |
| Worker (`agents/worker.md`) | Gemini Flash | Yes, inside its own worktree only | Do one task, commit on its branch, report |
| Checker (`agents/checker.md`) | Gemini Flash | No | Compare a branch with the *original* request; run tests and adversarial inputs |
| `hooks/guard.js` | n/a | n/a | PreToolUse hook: forces `Model: "flash"` for worker/checker, denies repeated identical reads, denies edits to the plugin |
| `scripts/fm-*.sh` | n/a | n/a | Deterministic git steps, so Argon spends no tokens reasoning about them |

## One `/firstmate` run

```mermaid
sequenceDiagram
  actor C as You
  participant F as First mate (Argon)
  participant W as Workers (Flash)
  participant K as Checker (Flash)
  participant G as Git

  C->>F: /firstmate <task>
  F->>F: Intake: goal + acceptance criteria
  F->>G: fm-init.sh (repo + base commit)
  opt Unknowns (rules, data, prior art)
    F->>W: Scout, read-only
    W-->>F: Summaries of 500 words or less
  end
  F->>F: plan.md: tasks, owned files, check commands
  par One worktree per task
    F->>W: Brief
    W->>G: Commit on own branch
    W-->>F: Branch + last commit
  end
  loop Each branch, max 2 fix rounds
    F->>K: Original request + check command
    K-->>F: Scorecard: tests, adversarial, verdict
    alt PASS
      F->>G: fm-merge.sh into main
    else FAIL
      F->>W: Fix exactly the listed issues
    end
  end
  F-->>C: Report: shipped, evidence, open issues
```

Argon only reads short artifacts: worker summaries, checker scorecards, `git log`. Long reports stay in files under `.firstmate/`, which keeps the expensive model's input small.

## Git model

Every task gets its own worktree and branch, created by the App (`Workspace: "branch"`). Nothing reaches `main` without a passing checker scorecard.

```mermaid
gitGraph
  commit id: "base snapshot"
  branch worker-a
  commit id: "feat: task A"
  checkout main
  branch worker-b
  commit id: "feat: task B"
  checkout main
  merge worker-a id: "merge A (checker PASS)"
  merge worker-b id: "merge B (checker PASS)"
```

- `fm-init.sh` creates the repo and the base commit. It also git-ignores data, virtual environments and `.firstmate/`.
- `fm-merge.sh` merges with `--no-ff`. On a conflict it aborts, leaves `main` unchanged and lists the conflicting files, and the first mate sends a worker to resolve them.
- The scripts always act on the main checkout, even if they are handed a worktree path.

## Where the tokens go

Measured on a single small run (`slugify` plus tests) on the author's machine. Treat it as an illustration, not a benchmark. Argon tokens cost more and count against a separate quota, so the share that matters is Argon's: about 24% of new input and 20% of output.

```mermaid
%%{init: {"themeVariables": {"xyChart": {"plotColorPalette": "#1a73e8"}}}}%%
xychart-beta
  title "Tokens by role, one /firstmate run (thousands)"
  x-axis ["Argon: new input", "Flash: new input", "Argon: output", "Flash: output"]
  y-axis "Tokens (k)" 0 --> 70
  bar [19.9, 63.4, 6.3, 24.6]
```
