# Playbook: investigate

For something broken or behaving oddly: a pod, an alert, a pipeline, a network path, a failing call. No file changes.

Copy these steps as your checklist. Mark each done, or `skip: <reason>`.

1. **Symptom.** Write the symptom in one line. If you do not know what is failing (error, where, since when), ask ONE question and stop.
2. **Facts.** Read `<repo>/.firstmate/facts.md` when a repo is involved.
3. **Hypotheses.** Write 2 to 4, each with the evidence that would confirm or kill it.
4. **Explore.** One explorer per hypothesis, all in ONE invoke_subagent call (`TypeName: "explorer"`, `Workspace: "inherit"`). Brief: the hypothesis, cluster context and namespace, time window, allowed read-only commands, `skills:` (0 to 3 that fit), and "report in the EXPLORER REPORT format; the verdict is CONFIRMED, KILLED or OPEN".
   Steps that need a remote host, a database shell or a production pod shell go to the captain as a numbered command block; wait for the pasted output.
5. **Check the reports** as in the how playbook (evidence required, one respawn, gaps are not answers). At most 3 rounds.
6. **Answer:**
   - Cause: the confirmed hypothesis, or the ranked candidates, with confidence.
   - Evidence: the exact command and output lines.
   - Why: 1 to 3 lines.
   - Fix: commands for the captain to run, or a proposed change (that needs a go and the change playbook).
   - Gotchas and unknowns.
7. **Remember** durable facts with one `fm.js fact` call (several facts at once), batched with another command.
