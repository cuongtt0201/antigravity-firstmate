# Patterns the first mate can draw on (reference, not a checklist)

## Explaining code or config ("how does X work", "what would a migration take")
- State the goal behind the question in one line; ask one question if it is ambiguous.
- Small scope (a handful of files): read it yourself, including catch blocks, fallbacks, auth and validation in front of the code.
- Larger scope: readers in one `fm.js crew --batch` call, one angle each (entry points and routes; data, config and environment; build, deploy and runtime). For a change or a migration, one angle is always error paths and security.
- Answer: overview (2 to 4 lines), the path through the code with file:line, the smallest change that reaches the goal, gotchas, unknowns (never filled with real-looking examples).

## Investigating something broken
- The symptom in one line; ask what fails, where and since when if that is unknown.
- 2 to 4 hypotheses, each with the evidence that would confirm or kill it; one reader per hypothesis.
- Steps that need a remote host, a database shell or a production pod are the captain's: give a numbered command block and continue from the output they paste.
- Answer: the cause (or ranked candidates) with confidence, the evidence lines, the fix as commands or as a change.

## Changing code or config
- Smallest change first. One task per independent part; no two tasks touch the same file.
- Medium or high risk with clear behaviour: tester builder first, `fm.js lock` the tests, then the implementing builder.
- Hard problem or two failed gates in a row: the ladder will say arena; give each variant a genuinely different approach (simplest correct · most robust · follow existing patterns).
- After delivery: the captain sees the commit or the diff, the risk, the verdict and how to undo.
