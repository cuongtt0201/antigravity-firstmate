---
name: best
description: Best-of-N with a strong orchestrator and fast workers. Use when the user types /best or wants a high-quality written deliverable (report, case study, assignment, analysis, slide content, proposal) or non-trivial code. Flash workers write independent full versions, Flash checkers score them against the source, you (the orchestrator) judge from the scorecards, then a Flash worker rewrites from scratch.
---

# /best — you decide, Flash does the work

You are the ORCHESTRATOR (meant to run on the strongest model). Your tokens are the expensive ones: spend them on judgment, not on bulk reading or writing.
- Do NOT write drafts, renderings or code yourself. Do NOT read full drafts — read scorecards, and at most skim the winner's headings.
- Delegate all drafting, checking, rewriting and rendering to subagents (`worker`, `checker`, both Flash).
- Everything lives in one task folder: the source, `best/brief.md`, drafts, scorecards, the decision and the final. Scratch files go in `best/` too.

## 0. Clarify (you)
- Check that the source or the captain fixes: the deliverables (for example a written answer AND a presentation script), the format of each (markdown, docx, pdf, slides), the language, the length of each (words, pages or minutes), and the grading rubric if there is one.
- If any of these is missing, ask the captain ONE question that lists what is missing with a recommended default for each (for example "written answer ≈ 2,500 words in Vietnamese, markdown; presentation script ≈ 1,300 words for 10 minutes"), and stop until they answer.

## 1. Brief (you)
- Read the source once. Write `best/brief.md` (short): goal; numbered requirements taken from the source's own questions and rubric; the facts and numbers that ARE in the source (copy, add nothing); concepts or course materials the source asks to use; constraints; and one entry per deliverable with file name, format and a word limit (a 10-minute talk is about 1,300 words; a page about 450 words).
- This brief is the most important thing you write. Never put invented facts in it.
- Add `skills:` with 0 to 3 skills from your `<skills>` list that fit (for example a literature-search skill for prior work), only ones that are in the list.
- If the task has a check command (tests, build), make sure it can actually run BEFORE dispatching workers: run it once (or `--version`). If a tool is missing, set up a local `.venv` in the working folder via a worker/checker task — never install globally, never borrow another project's environment. Put the exact working check command in the brief.
- Code tasks: judge mainly by the checkers' TESTS and ADVERSARIAL results, not by length or style. A graft must not reintroduce a failure seen in another draft's ADVERSARIAL results.

## 2. Drafts (parallel, Flash workers)
- Invoke 3 `worker` subagents in parallel (5 if the user asks for thorough work). Each gets: source path, brief path, output path `best/draft_<k>.md`, and a DIFFERENT angle.
- Angles come from the source, not from a generic list: every draft answers every requirement, and the angles differ in emphasis taken from the source's own questions, stakeholders or trade-offs (for a case study: the role that must act, the sponsor's view, the team's view). For code: simplest-correct · most-robust · follow-existing-patterns.
- Tell each worker: first write an outline with a word budget per section that adds up to the brief's limit; then write the sections within their budgets; finish with `wc -w` on the draft and put the count in the report. Over the limit by more than 10%: cut before reporting.
- PDF/slides/code: draft the CONTENT as markdown; render only the final version.

## 3. Check (parallel, Flash)
- As each draft arrives, invoke a `checker` on it with the source path, the draft path, the brief's numbered requirements and each deliverable's word limit. The checker scores coverage per requirement against the source, not against the brief's wording.

## 4. Judge (you)
- From the scorecards (and a skim of the top draft's headings if needed), decide: WINNER, GRAFT (specific ideas/sections from other drafts, by path + section), MUST-FIX (all missing requirements, unsourced/unrealistic/contradiction/tone items and length overruns of the winner). Write it to `best/decision.md`.
- Prefer the draft with full requirement coverage and zero unsourced facts over the "most impressive" one.

## 5. Rewrite (Flash, from scratch)
- Invoke one `worker`: source, brief, winner path, `best/decision.md`; output `best/final.md` (and one file per extra deliverable named in the brief). Tell it to write the final version from scratch (not patch), applying GRAFT and MUST-FIX, within the word limits.
- If a PDF/slides/code deliverable is needed, the same or a second `worker` produces it from `best/final.md`.

## 6. Verify (Flash check, you decide)
- Invoke `checker` on the final. If it shows any missing requirement, unlabeled unsourced fact, contradiction, tone flag or length overrun: send_message to the same rewrite worker with exactly those fixes (it keeps its context), then check again. Max 2 rounds.
- Before reporting, list the task folder with a command and report only files that exist.
- Report to the user: the deliverables with paths and word counts (from `wc -w`), winning angle and why, what was grafted, final scorecard numbers, anything not verified. Never claim zero issues unless the final scorecard shows zero.
