# Antigravity IDE: what firstmate can rely on

Survey for v1.0 (plan Task 0.2), done offline on 2026-11-01 from the files the IDE and the CLI keep on this machine,
plus one headless `agy` run. Items marked **open** need the probe plugin run inside the IDE (`tools/probe/`, steps in
the plan) before they are relied on.

| # | Question | Answer | Evidence |
|---|---|---|---|
| Q1 | Where does the IDE load plugins from? | The shared `~/.gemini/config/plugins/` (the same folder the App and the CLI use): the guard of `flash-ultra` ran in IDE chats. `~/.gemini/antigravity-ide/plugins/` holds a different kind of extension (`Google.securecoder.securecoder`). | `[guard]` / `[loop-guard]` messages in IDE transcripts `bf5c19ff` (2026-10-23), `ebc0e6ed`, `3de8201e` (2026-10-26), `eb4e2620` (2026-10-20); `agy plugin list` shows `flash-ultra (enabled, 0.12.0)` |
| Q2 | Hooks | `PreToolUse` runs and its `deny` is honoured (measured). `SessionStart` / `PreInvocation`: **open**. No IDE transcript carries the first mate's rules or a facts message from this plugin. | grep of 453 IDE transcripts: `[guard]` 3, `firstmate rules` 0 |
| Q3 | Subagents in IDE chats | **Not available** in a normal IDE chat: the model reported "Tool 'invoke_subagent' is not declared in the tool schema for this session". The IDE's own `browser_subagent` exists. | transcript `7d5512e2`; tool counts over 453 transcripts: no `invoke_subagent` |
| Q4 | Model ids | `gemini-4-argon-{low,medium,high}`, `gemini-3.8-flash-{low,medium,high}`, `claude-opus-5-5-{low,medium,high}`, `claude-sonnet-5-5-{low,medium,high}`, `gpt-oss-120b-medium`. No Flash-Lite. | `agy models` (2026-11-01) |
| Q5 | Worktree per subagent in the IDE | Not applicable without subagents (Q3). | — |
| Q6 | Agent identity / transcripts | IDE: `~/.gemini/antigravity-ide/brain/<id>/.system_generated/logs/transcript.jsonl` (same JSONL as the App, plus typed steps such as `RUN_COMMAND`, `VIEW_FILE`); `conversations/<id>.db` holds protobuf blobs (tables `steps`, `trajectory_meta`, `parent_references`, …), no readable agent name and no shared `conversation_summaries.db`. | sqlite schema of `conversations/d3aeea0d….db`; 387 databases scanned |
| Q7 | `modelName` in hook payloads | **open** (needs the probe). Model display names in IDE data: "Gemini 3.8 Flash (High)", "Gemini 3.5 Flash (High)"… | strings in `gen_metadata` |
| Q8 | Sandbox and writes outside the workspace | **open** for IDE chats. A headless `agy -p` run in a scratch folder worked without a sandbox flag (`--sandbox` is opt-in). | `agy --help`; test run below |
| Q9 | Tool names | IDE: `run_command`, `view_file`, `grep_search`, `list_dir`, `replace_file_content`, `write_to_file`, `multi_replace_file_content`, `manage_task`, `search_web`, `read_url_content`, `ask_question`, `browser_subagent`, `schedule`, `generate_image`, `list_permissions`, `ask_permission`. Plugin skills are visible to IDE chats (skill text of the Data Agent Kit plugin appears in IDE transcripts). | tool-call counts over 453 IDE transcripts |

## Antigravity CLI (`agy`)

- Installed at `~/.gemini/bin/agy`, version 1.4.12.
- Headless mode: `agy -p "<prompt>" --model <id> --output-format json [--mode auto] [--add-dir <dir>] [--print-timeout 600s]`. `auto` is not available on every account (the CLI warns and continues in the default mode), so the crew passes no mode for readers and the judge.
  It returns `{"conversation_id","status","response","duration_seconds","num_turns","usage":{input_tokens,output_tokens,thinking_tokens,cache_read_tokens,total_tokens}}`.
- One run (`gemini-3.8-flash-low`, "Reply with the single word OK") took 5.1 s and 15,264 input tokens. That is the fixed cost of one crew call (system prompt, plugins, skills), measured.
- `agy agents` lists the main agents of installed plugins (`firstmate`). `agy plugin list` reads `~/.gemini/config/plugins`.

## Consequence for v1.0

See [v1-decisions.md](v1-decisions.md): Plan B. The first mate runs wherever the captain chats (IDE, App or CLI).
The crew runs as headless `agy` processes, one per task workspace, started in parallel by `fm.js crew`.
