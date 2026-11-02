---
name: afk
description: The captain is going away (/afk, "I'm leaving, keep working"). Queue the work they leave and start the unattended runner, which works through the queue one fresh first-mate chat per request, merges by risk as one commit per task, and leaves high risk for the captain.
---

# /afk — work through a queue while the captain is away

1. **Queue the work.** One item per independent request, in the captain's words, all in one call:
   `node "{{PLUGIN_DIR}}/scripts/fm.js" queue <repo> add "<request>" ["<request>" …]`.
   Each item runs later in its own chat that knows nothing of this one, so every item must stand alone: name the
   files, the behaviour and the done-when the captain gave.
2. **Check the merge mode:** `fm.js config <repo> merge`. The runner delivers task after task, each as its own commit,
   so it needs `commit`. If it is not, give the captain the exact command to run themselves,
   `fm.js config <repo> merge commit`, and stop here. Settings are the captain's.
3. **Start the runner:** `fm.js afk <repo> --detach`. It refuses on a protected branch (main, master, release/*) or a
   dirty working tree; tell the captain what it said and the command that fixes it (`git switch -c <branch>`, commit or
   stash).
4. **Tell the captain**, short:
   - what is queued (the item numbers);
   - each item is delivered as one commit per task; `fm.js undo <repo> <task>` takes one back;
   - medium risk merges only when both judges approve; high risk waits for them;
   - when they are back: `fm.js queue <repo>` and `fm.js report <repo>`;
   - to stop early: `fm.js afk <repo> --stop` (the runner finishes the current item first).

When the captain comes back and asks what happened, start from `fm.js queue <repo>` and `fm.js report <repo>`, then
list per item: delivered (commit), waiting for them (and why), failed (and the first line of why).
