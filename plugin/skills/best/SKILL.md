---
name: best
description: Best-of-N with a strong orchestrator and fast workers. Use when the user types /best or wants a high-quality written deliverable (report, case study, assignment, analysis, slide content, proposal) or non-trivial code. Flash workers write independent full versions, Flash checkers score them against the source, you (the orchestrator) judge from the scorecards, then a Flash worker rewrites from scratch.
---

# /best — you decide, Flash does the work

You are the ORCHESTRATOR (meant to run on the strongest model). Your tokens are the expensive ones: spend them on judgment, not on bulk reading or writing.
- Do NOT write drafts, renderings or code yourself. Do NOT read full drafts — read scorecards, and at most skim the winner's headings.
- Delegate all drafting, checking, rewriting and rendering to subagents (`worker`, `checker`, both Flash).
- Everything lives in one task folder: the source, `best/brief.md`, drafts, scorecards, the decision and the final. Workers keep scratch files in `best/tmp/` and delete them before reporting.
- Lengths are measured with `bash {{PLUGIN_DIR}}/scripts/fm.sh shape <task>/best/brief.md` (free): space-separated words, markdown symbols not counted. For Vietnamese this counts syllables, like Word does.

## 0. Clarify (you)
- Check that the source or the captain fixes: the deliverables (for example a written answer AND a presentation script), the format of each (markdown, docx, pdf, slides), the language, the length of each in words or pages, and the grading rubric if there is one.
- Never turn minutes of speaking into words with an English speaking rate. If the source gives a talk only in minutes, ask how many words.
- If any of these is missing, ask the captain ONE question that lists what is missing with a recommended default for each (for example "written answer ≈ 2,500 words in Vietnamese, markdown"), and stop until they answer.
- Ask only about the shape of the deliverables. Choices the source asks the students to make (which option, which role) belong to the drafts, unless the captain fixes them.

## 1. Brief (you)
- Read the source once. Write `best/brief.md` (short): goal; numbered requirements R1, R2, … taken from the source's own questions and rubric; the facts and numbers that ARE in the source (copy, add nothing); concepts or course materials the source asks to use; constraints.
- This brief is the most important thing you write. Never put invented facts in it.
- For written deliverables, end the brief with one line per deliverable, exactly in this form (paths relative to `best/`, no spaces in file names); the first line is the main deliverable, and its drafts get its limit:
  ```
  deliverable: final.md words=2500 covers=R1-R10 drafts=draft_*.md
  deliverable: talk.md words=1300 covers=R11
  ```
- Add `skills:` with 0 to 3 skills from your `<skills>` list that help the writing (for example a literature-search skill for prior work), or `skills: none`.
- Code tasks have no `deliverable:` lines; skip the shape steps for them.
- Before dispatching, check the brief: every requirement is in exactly one `covers=`, every deliverable has `words=` (for a page limit, write the words per page you assumed next to it), and `fm.sh shape` reads every line (files not written yet show `-`).
- If the task has a check command (tests, build), make sure it can actually run BEFORE dispatching workers: run it once (or `--version`). If a tool is missing, set up a local `.venv` in the working folder via a worker/checker task — never install globally, never borrow another project's environment. Put the exact working check command in the brief.
- Code tasks: judge mainly by the checkers' TESTS and ADVERSARIAL results, not by length or style. A graft must not reintroduce a failure seen in another draft's ADVERSARIAL results.

## 2. Drafts (parallel, Flash workers)
- Invoke 3 `worker` subagents in ONE invoke_subagent call (5 if the user asks for thorough work). Each gets: source path, brief path, output path `best/draft_<k>.md`, a DIFFERENT angle, the main deliverable's limit and the shape command. Point to the brief for the requirements; do not restate them in the message.
- Drafts cover the MAIN deliverable only. The other deliverables are written from the final in step 5.
- Angles come from the source, not from a generic list: every draft answers every requirement of the main deliverable, and the angles differ in emphasis taken from the source's own questions, stakeholders or trade-offs (for a case study: the role that must act, the sponsor's view, the team's view). For code: simplest-correct · most-robust · follow-existing-patterns.
- Workers follow their "Writing to a word limit" rules: one section at a time, the shape command after each, at most 2 shortening passes.
- PDF/slides/code: draft the CONTENT as markdown; render only the final version.

## 3. Shape, then check
- When the drafts are in, run `fm.sh shape` once. An OVER draft gets ONE send_message to the same worker with its shape line: shorten to the limit. Still OVER: it cannot win, and it may only give grafts.
- Invoke a `checker` on each draft that is not OVER, with the source path, the draft path, the brief path and the brief's numbered requirements. The checker scores coverage per requirement against the source, not against the brief's wording.

## 4. Judge (you)
- Decide in this order and stop at the first difference that matters: shape (OVER is out) → unlabeled unsourced facts and contradictions → requirement coverage → tone → strengths.
- Write `best/decision.md`: a `WINNER: draft_<k>` line, then one line per decision in the form `kept | revised | dropped -> <section or idea, with its draft path> -> <evidence: the scorecard or shape line>`. Grafts from other drafts are `kept` lines. Every defect on the winner's scorecard (missing requirement, unsourced fact, contradiction, tone flag, length) is a `revised` line.
- Prefer the draft with full requirement coverage and zero unsourced facts over the "most impressive" one.

## 5. Rewrite (Flash, from scratch)
- Invoke one `worker`: source, brief, winner path, `best/decision.md`; output `best/final.md`. Tell it to write the final version from scratch (not patch), applying the decision lines, within the limit.
- When `fm.sh shape` shows the final OK, send_message to the same worker to write each other deliverable from the final, within its own limit.
- If a PDF/slides/code deliverable is needed, the same or a second `worker` produces it from the markdown.

## 6. Verify (Flash check, you decide)
- Run `fm.sh shape`: every deliverable must be OK or SHORT. Invoke `checker` on each deliverable. If shape or a scorecard shows OVER, a missing requirement, an unlabeled unsourced fact, a contradiction or a tone flag: send_message to the same rewrite worker with exactly those fixes, then shape and check again. Max 2 rounds.
- Before reporting, list the task folder with a command and report only files that exist; `best/tmp/` should be gone.
- Report to the user: the deliverables with paths and word counts (from `fm.sh shape`), winning angle and why, what was grafted, final scorecard numbers, anything not verified. Never claim zero issues unless the final scorecard shows zero.
