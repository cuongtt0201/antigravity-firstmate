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

## Benchmark tasks

See `bench/README.md`. Results go to `bench/results.tsv`.
