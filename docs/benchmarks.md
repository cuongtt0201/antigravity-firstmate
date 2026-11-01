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

## Benchmark tasks

See `bench/README.md`. Results go to `bench/results.tsv`.
