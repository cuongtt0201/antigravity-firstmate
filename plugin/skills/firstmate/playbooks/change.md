# Playbook: change

For editing config, IaC, CI or code.

Copy these steps as your checklist. Mark each done, or `skip: <reason>`.

1. **Goal and facts.** `fm.js init <repo>`, read facts.md. If you do not yet know how the code works, run the how playbook first. A clear edit in one or two files you can read within your budget needs no explorer: read them yourself.
2. **Plan** in at most 8 lines: the smallest change that reaches the goal, files, the check, risk (what restarts or gets replaced, data, compatibility). Stop and wait for the captain's go.
3. **Implement.** `fm.js start` one task per independent part (no two tasks touch the same file), and one worker per task: the guard refuses two workers in one task workspace. Dispatch `worker` subagents in ONE invoke_subagent call (`Workspace: "inherit"`). Brief: the captain's words, files owned, the task workspace path (write only there), the facts path, the check, `skills:` (0 to 3 that fit), and "report in the WORKER REPORT format; do not run git commit or push".
4. **Gate.** `fm.js save`, then `fm.js gate` (pass the test command for code with tests). FAIL: send_message to the same worker with exactly the failures (it keeps its context), then save and gate again; at most 2 rounds.
5. **Verify** changes to several files, or anything that restarts or replaces resources, with a `checker`: the captain's original request, the workspace path and the base ref `refs/firstmate/<task>/base`. ISSUES: send the issues to the same worker, then verify again; BLOCKED: report.
6. **Deliver** with `fm.js deliver`. Report: what changed (diff stat), the gate output, the checker verdict and any unfixed issue, and the commands the captain runs next.
7. **Remember** durable facts with one `fm.js fact` call (several facts at once), in the same batch as `fm.js deliver`.
