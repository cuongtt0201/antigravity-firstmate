# firstmate v1.0 decisions

Taken on 2026-11-01 while the captain was away ("tự quyết định"), from the design's recommendations and the IDE survey
([ide-capabilities.md](ide-capabilities.md)). Each can be changed in config or reverted.

## Platform: Plan B

IDE chats load the plugin's guard and skills but have no `invoke_subagent` (survey Q3). So:

- **System 1 (first mate)** runs in the captain's chat: in the IDE through the `/firstmate` skill (the default agent
  reads `agents/firstmate.md`), in the App or the CLI as the `firstmate` agent. Any model; Flash is the default to keep
  the chat cheap.
- **The crew and System 2 (judge)** run as headless `agy -p` processes started by `fm.js crew`. There is one process
  per task workspace, they run in parallel, and each has its own model. The result is the same on every host and
  does not depend on in-chat subagents. Each call's token use is written to the task's notes.
- In-chat subagents (App) stay usable. They are no longer required.

## D1–D7

| # | Decision | Where it lives |
|---|---|---|
| D1 | S1 is the first mate on Flash; Argon is called only as the judge, with a dossier, never with the chat history | `agents/firstmate.md`; `fm.js crew --role judge` |
| D2 | Merge mode default stays `apply` until the judge flow is used, then `commit` (one commit per task, `fm.js undo`) | `fm.js config <repo> merge commit` |
| D3 | No "go": instructions are acted on; high risk waits for the captain (`deliver` exit 3, `--approve`) | `agents/firstmate.md`, `fm.js deliver` |
| D4 | App support is kept (nothing in v1 needs App-only features); the IDE is the main target | README |
| D5 | Guard packs `core` + `devops` on by default | `packs` in config |
| D6 | Queue / away mode → v1.1 | — |
| D7 | Plugin id stays `flash-ultra` in this MVP: renaming moves the install folder for every existing user, so it waits for the release step | install.js |

## Models (config `models`)

| Key | Model | Used for |
|---|---|---|
| `fast` | `gemini-3.8-flash-low` | readers, quick lookups |
| `standard` | `gemini-3.8-flash-medium` | builders, testers |
| `strong` | `gemini-4-argon-medium` | judge (System 2) |
| `second` | `claude-sonnet-5-5-medium` | optional second reviewer from another model family |
