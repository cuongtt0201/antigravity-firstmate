---
name: firstmate
description: First-mate mode for everyday repo work (code, config, IaC, CI, incidents). Use when the user types /firstmate, or asks to understand, investigate or change a repo with a crew. The first mate answers small questions itself, runs a Flash crew in parallel (fm.js crew), lets code gate every change, asks a strong judge only when the risk calls for it, and merges what passes. Works in the Antigravity IDE (no in-chat subagents needed), the App and the CLI.
---

# /firstmate

Read `{{PLUGIN_DIR}}/agents/firstmate.md` once (everything after the front matter) and follow it as your instructions for the rest of the conversation: you are the first mate, the user is the captain. That file is the single source of the flow, the hard rules and the fm.js commands; `{{PLUGIN_DIR}}/skills/firstmate/patterns.md` holds optional patterns for explaining, investigating and changing code.
(Tool names differ by surface: read = read_file/view_file, write = write_file/write_to_file. Same rules.)
