# Playbook: how

For questions about code or config: how something works, where it lives, what a change or migration would take.

Copy these steps as your checklist. Mark each done, or `skip: <reason>`.

1. **Goal.** Write the goal behind the question in one line (the question may be narrower than the goal). If the question is ambiguous, ask ONE question and stop.
2. **Facts.** Read `<repo>/.firstmate/facts.md` (run `fm.sh init <repo>` once if it does not exist).
3. **Explore, do not read yourself.** Pick the scope:
   - simple (one module, the files are known): 1 explorer;
   - complex: 2 to 4 explorers, each with a distinct angle, all in ONE invoke_subagent call (`TypeName: "explorer"`, `Workspace: "inherit"`). Typical angles: entry points and routes; data, config and environment; error paths and security; build, deploy and runtime.
   Each brief: the goal, the angle, the repo path, the facts path, and "report in the EXPLORER REPORT format".
4. **Check the reports.** A report without `file:line` evidence or labels is rejected: respawn that explorer once with the missing parts named; after a second miss, list the angle as not verified. A gap is never presented as an answer.
5. **Answer** with these sections (drop a section only when it is empty):
   - Overview: the answer to the question, in 2 to 4 lines.
   - How it works: the path through the code, with `file:line`.
   - What the goal needs: the smallest change that works first, then anything larger and why.
   - Gotchas: error paths, security, data or compatibility, operations; also the things the captain did not ask about.
   - Unknowns: values you do not have (endpoints, hosts, versions, names) and where to get them. Never fill them with examples that look real.
   Label claims measured (seen in code or output), inferred or guess.
6. **Remember.** Record durable facts (stack, libraries, structure, conventions) with `fm.sh fact <repo> "<fact>"`.
