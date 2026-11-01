# Benchmark

A small fixture repo (`fixture/`) and tasks whose acceptance tests are hidden from the agents (`hidden/<task>/`).
`selftest.sh` proves every hidden test fails on the untouched fixture and passes with the reference solution
(`solutions/<task>.patch`), so a pass means the task was really done.

| Task | Prompt given to the agent (verbatim) | Hidden test |
|---|---|---|
| B1 | "slugify must turn Vietnamese text into ASCII slugs: 'Xin chào Việt Nam' → 'xin-chao-viet-nam', 'Đường phố Hà Nội' → 'duong-pho-ha-noi'; existing behaviour stays." | `hidden/B1` |
| B2 | "Add a --json flag to cli.js that prints a JSON array of { title, slug }; without the flag nothing changes." | `hidden/B2` |
| B6 | "How does cli.js turn titles into slugs?" (a question: no change expected) | none; count the strong-model calls (target 0) |

## Running one configuration

1. Copy `fixture/` to a temp folder, `git init`, commit, and create a branch.
2. Give the prompt to the configuration under test: the IDE's default agent on Flash, on Argon, or firstmate.
3. Copy `hidden/<task>/hidden.test.js` into `<copy>/.hidden/` and run `node .hidden/hidden.test.js`.
4. Measure tokens with `node plugin/scripts/fm.js usage <conversation-id>` (the chat) and `fm.js report` (the crew).
5. Add a row to `results.tsv`.

`bash bench/selftest.sh` runs in CI.
