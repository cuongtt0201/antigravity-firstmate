# Benchmarks

Token numbers come from `node plugin/scripts/fm.js usage <conversation-id>`, which reads the chat transcripts.
"Strong share" is the part used by models that are not Flash (the first mate's model when the log has no model).

## Baseline v0.12 (a real chat, App)

"DevOps Handoff Documentation Review" (2026-10-27, 09:57 → 16:17), measured on 2026-11-01:

| Chat | Role | Calls | New input | Cached input | Output |
|---|---|---|---|---|---|
| fb1da927 | first mate (Argon) | 324 | 2,526,144 | 40,901,891 | 287,803 |
| c425235d | worker (Flash) | 105 | 427,414 | 6,787,236 | 49,362 |
| f94d9537 | worker (Flash) | 189 | 2,084,181 | 24,346,333 | 112,153 |
| de479836 | checker (Flash) | 103 | 683,937 | 6,952,882 | 54,709 |

Strong share: new input 44%, cached input 51%, output 57%.

## v1.0.0-alpha.1: one real task, end to end (2026-11-01)

A small JS repo with a failing acceptance test: `slugify('Xin chào Việt Nam')` must give `xin-chao-viet-nam`, and
`'Đường phố Hà Nội'` must give `duong-pho-ha-noi`. The test was locked (`fm.js lock`). The commands were driven by hand
in the order the first mate follows. Every model call was real (`agy` 1.4.12).

| Step | What ran | Result |
|---|---|---|
| builder (Flash medium) × 3 | first prompt version | gate FAIL ×3: a refused shell command or file read ends a headless run before the edit (prompts fixed since) |
| `fm.js ladder` | — | `NEXT: arena 3` |
| arena: 3 builders in parallel (Flash medium) | simplest · most robust · existing style | all 3 gate PASS, 64 s wall |
| judge × 2 in parallel (Argon medium) | dossier only, no chat history | APPROVE, APPROVE; 19.1k input (14.8k cached) and 0.6–1.0k output per call |
| `arena-pick b`, `fm.js ladder` | — | `NEXT: deliver` (gate PASS, medium risk, APPROVE) |
| `fm.js deliver` (merge mode `commit`) | — | commit on the captain's branch; `npm test` ok |

`fm.js report`: crew tokens 534,730, of which the strong model used 69,497 (**12%**). The three wasted builder runs are
included. The v0.12 chat measured above had a strong-model share of 44–57%. The target for v1 is 20% or less.

## v1.0.0-alpha.1: the first mate itself, driven through the CLI (2026-11-01)

The installed plugin, run as `agy -p "<task prompt>" --agent firstmate --model gemini-3.8-flash-medium`, on fresh
copies of `bench/fixture`. Nobody touched the run; the hidden tests were run afterwards.

| Task | Result |
|---|---|
| B6 (a question) | Right answer with `file:line`, 26 s, 0 strong-model calls |
| B2 (`--json` flag) | 4 min 35 s: start → builder → gate PASS → judge APPROVE → deliver (uncommitted); **hidden test B2 passes** |

B2 crew: builder 66k tokens (97k more cached), judge 19.5k (14.5k cached); `fm.js report` gives the strong model
**17%** of the crew's tokens, cached input included. The first mate on Flash used 184k tokens and read 1.3M from the
cache, most of it on a detour that the run exposed. That run, and three that stopped earlier, found five problems,
fixed in alpha.2:

1. `fm.js crew` takes minutes, so the CLI moved it to the background and its log was empty. The first mate took that
   for a missing `agy`, cancelled the run and started a builder with the brief "test" to try the command. The crew now
   prints `crew started … via <agy>; do not cancel it` before it starts, and the prompt says to wait.
2. It then fell back to an in-chat `builder` subagent, which read the files and reported PASS without editing. The
   guard now sends an in-chat builder briefed on a task workspace to `fm.js crew` (in-chat builders stay for /best).
3. The budget's hard stop at 15 still sent the first mate to v0.12 "explorer" subagents. It now points to readers in
   one `fm.js crew --batch` call.
4. With no grants, the headless CLI refuses every `fm.js` command, the brief file and reads of `~/.firstmate/wt`; the
   IDE and the App ask each time. `install.js --grant` adds the two global grants (fm.js, task workspaces).
5. `--mode auto` is not available on every account ("continuing in the default mode"). Readers and the judge now run
   in the default mode without the flag.

**alpha.2, same B2 run (2026-11-02)**, with only three session grants (fm.js, the brief folder, `~/.firstmate/wt`):
start → crew (waited, no cancel, no probe builder, no in-chat builder) → `fm.js review` → judge APPROVE → deliver, in
3 min 13 s; **hidden test B2 passes**. The first mate used 97.5k tokens (378k cached), about half of alpha.1. The run
ended right after delivery on a refused `npm test` on the captain's tree, which was not granted. Crew: builder 47k
(67k cached), judge 19.1k (14.5k cached); `fm.js report` gives the strong model 22% of the crew's tokens. On a task this
small the judge's fixed ~19k is most of it; over the whole run (first mate and crew, new tokens) Argon used 12%.

## v1.0.0-alpha.3: /afk on a queue of B1 and B2, two judge families (2026-11-02)

A fresh copy of `bench/fixture` on branch `work`, merge mode `commit`. The B1 and B2 prompts were queued verbatim
(`fm.js queue add`) and `fm.js afk` ran them with nobody watching: one new first-mate chat per item (Flash medium),
the judges Argon and Claude Sonnet in parallel.

| Item | Wall | Result |
|---|---|---|
| #1 B1 (Vietnamese slugs) | 198 s | builder PASS on the first try, Argon APPROVE, Claude APPROVE, commit `vietnamese-slugify`; **hidden test B1 passes** |
| #2 B2 (`--json` flag) | 158 s | builder PASS on the first try, Argon APPROVE, Claude APPROVE, commit `cli-json`; **hidden test B2 passes** |

The whole queue took 5 min 57 s and left two commits on `work`, a clean tree and `npm test` ok. Both chats ran with 0
errors and 0 refused tools, made one crew call each and never looked up fm.js usage.

| Tokens (new, not cached) | |
|---|---|
| first mate, 2 chats | 173k (648k more read from the cache) |
| builders | 143k |
| judges: Argon 34k, Claude 46k | 80k |
| strong models over the whole run | **20%** (Argon alone 9%) |

`fm.js report` gives the same 20% for the crew with cached input included. A second family costs about as much as
Argon on these small tasks; it buys a vote that does not share Gemini's blind spots.

## alpha.6 to alpha.8: fewer first-mate calls (2026-11-02)

The same queue (B1, B2, verbatim) through `fm.js afk` on fresh copies of the fixture. Argon had no quota all day,
so Claude Sonnet judged alone (the verdicts say so).

| First mate, per item | alpha.3 | alpha.6: `fm.js run` | alpha.7: plans only, the runner runs the batch |
|---|---|---|---|
| model calls | 18 | 13 / 15 | **5 / 11** |
| new tokens | 87k / 86k | 91k / 85k | **30k / 49k** |
| read from the cache | 336k / 312k | 200k / 270k | **66k / 186k** |
| wall time | 198 s / 158 s | 238 s / 185 s | **138 s / 144 s** |

- alpha.6 put the deterministic loop (builder, gate, fix rounds, judges, deliver) into one command. Calls fell, but
  new tokens did not: `fm.js run` takes minutes, the CLI moved it to the background, and the first mate woke with its
  prompt cache expired and reread 24–27k tokens, then re-read files to check.
- alpha.7: in afk the first mate only writes the batch and ends; the runner runs it. In B1 the judge asked for changes
  and `fm.js run` sent its fixes back to the builder by itself (alpha.6); both hidden tests pass in every run.
- Found on the way (alpha.8): the Claude judge, alone, tried to run `tail` and `node` to check the change; a headless
  run ends on a command it may not run, so B2 came back HUMAN. judge.md now says judges cannot run commands, and a
  judge that ends without a verdict runs once more with a reminder. Re-judged on alpha.8: APPROVE in 15 s, delivered,
  hidden test B2 passes.

## Benchmark tasks

See `bench/README.md`. Results go to `bench/results.tsv`.
