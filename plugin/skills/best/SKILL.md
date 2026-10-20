---
name: best
description: Best-of-N with a strong orchestrator and fast workers. Use when the user types /best or wants a high-quality deliverable (report, analysis, slide content, design, non-trivial code). Flash workers write independent full versions, Flash checkers produce short scorecards, you (the orchestrator) judge from the scorecards, then a Flash worker rewrites from scratch.
---

# /best — you decide, Flash does the work

You are the ORCHESTRATOR (meant to run on the strongest model). Your tokens are the expensive ones: spend them on judgment, not on bulk reading or writing.
- Do NOT write drafts, renderings or code yourself. Do NOT read full drafts — read scorecards, and at most skim the winner's headings.
- Delegate all drafting, checking, rewriting and rendering to subagents (`worker`, `checker`, both Flash).

## 1. Brief (you)
- Read the user's source once. Write `best/brief.md` (short): goal; numbered requirements from the source; the facts/numbers that ARE in the source (copy, add nothing); constraints; output format; length limit; the angles (step 2).
- This brief is the most important thing you write. Never put invented facts in it.
- If the task has a check command (tests, build), make sure it can actually run BEFORE dispatching workers: run it once (or `--version`). If a tool is missing, set up a local `.venv` in the working folder via a worker/checker task — never install globally, never borrow another project's environment. Put the exact working check command in the brief.
- Code tasks: judge mainly by the checkers' TESTS and ADVERSARIAL results, not by length or style. A graft must not reintroduce a failure seen in another draft's ADVERSARIAL results.

## 2. Drafts (parallel, Flash workers)
- Invoke 3 `worker` subagents in parallel (5 if the user asks for thorough work). Each gets: source path, brief path, output path `best/draft_<k>.md`, and a DIFFERENT angle chosen for this task, e.g.:
  - strategy/analysis: risk-first · user-value-first · stakeholder-relationship-first · minimal-and-realistic
  - code: simplest-correct · most-robust · follow-existing-patterns
- PDF/slides/code: draft the CONTENT as markdown; render only the final version.

## 3. Check (parallel, Flash)
- As each draft arrives, invoke a `checker` on it (source path + draft path + length limit). Run checkers in parallel.

## 4. Judge (you)
- From the scorecards (and a skim of the top draft's headings if needed), decide: WINNER, GRAFT (specific ideas/sections from other drafts, by path + section), MUST-FIX (all unsourced/unrealistic/contradiction/tone items of the winner). Write it to `best/decision.md`.
- Prefer the draft with full requirement coverage and zero unsourced facts over the "most impressive" one.

## 5. Rewrite (Flash, from scratch)
- Invoke one `worker`: source, brief, winner path, `best/decision.md`; output `best/final.md`. Tell it to write the final version from scratch (not patch), applying GRAFT and MUST-FIX.
- If a PDF/slides/code deliverable is needed, the same or a second `worker` produces it from `best/final.md`.

## 6. Verify (Flash check, you decide)
- Invoke `checker` on the final. If it shows any missing requirement, unlabeled unsourced fact, contradiction or tone flag: one more `worker` rewrite with exactly those fixes, then check again. Max 2 rounds.
- Report to the user: winning angle and why, what was grafted, final scorecard numbers, anything not verified. Never claim zero issues unless the final scorecard shows zero.
