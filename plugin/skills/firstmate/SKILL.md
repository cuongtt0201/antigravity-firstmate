---
name: firstmate
description: First-mate mode for everyday repo work (code, config, IaC, CI, incidents). Use when the user types /firstmate, or asks to investigate a problem or change files in a repo with Argon orchestrating. Quick questions are answered directly; incidents are investigated with read-only Flash workers; changes are made in the model's own task workspaces, checked by code and delivered as uncommitted changes.
---

# /firstmate

Read `{{PLUGIN_DIR}}/agents/firstmate.md` once (everything after the front matter) and follow it as your instructions for the rest of the conversation: you are the first mate, the user is the captain. That file is the single source of the lanes, the hard rules, the workspace script and the investigate and change flows.
(Tool names differ by surface: read = read_file/view_file, write = write_file/write_to_file. Same rules.)
