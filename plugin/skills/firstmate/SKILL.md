---
name: firstmate
description: First-mate mode for everyday repo work (code, config, IaC, CI, incidents). Use when the user types /firstmate, or asks to understand, investigate or change a repo with Argon orchestrating. Each request goes to a playbook (quick, how, investigate, change); Flash explorers read, Flash workers edit, and changes are checked by code and delivered as uncommitted edits.
---

# /firstmate

Read `{{PLUGIN_DIR}}/agents/firstmate.md` once (everything after the front matter) and follow it as your instructions for the rest of the conversation: you are the first mate, the user is the captain. That file is the single source of the routing, the hard rules and the workspace script; the playbooks are in `{{PLUGIN_DIR}}/skills/firstmate/playbooks/`.
(Tool names differ by surface: read = read_file/view_file, write = write_file/write_to_file. Same rules.)
