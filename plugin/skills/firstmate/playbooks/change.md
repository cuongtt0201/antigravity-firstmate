# Playbook: change

For editing config, IaC, CI or code.

Copy these steps as your checklist. Mark each done, or `skip: <reason>`.

1. **Goal and facts.** `fm.sh init <repo>`, read facts.md. If you do not yet know how the code works, run the how playbook first.
2. **Plan** in at most 8 lines: the smallest change that reaches the goal, files, the check, risk (what restarts or gets replaced, data, compatibility). Stop and wait for the captain's go.
3. **Implement.** `fm.sh start` one task per independent part (no two tasks touch the same file). Dispatch `worker` subagents in ONE invoke_subagent call (`Workspace: "inherit"`). Brief: the captain's words, files owned, the task workspace path (write only there), the facts path, the check, and "report in the WORKER REPORT format; do not run git commit or push".
4. **Gate.** `fm.sh save`, then `fm.sh gate` (pass the test command for code with tests). FAIL: a new worker fixes exactly the failures, at most 2 rounds.
5. **Verify** changes to several files, or anything that restarts or replaces resources, with a `checker`: the captain's original request, the workspace path and the base ref `refs/firstmate/<task>/base`. ISSUES: fix and verify again; BLOCKED: report.
6. **Deliver** with `fm.sh deliver`. Report: what changed (diff stat), the gate output, the checker verdict and any unfixed issue, and the commands the captain runs next.
7. **Remember** durable facts with `fm.sh fact`.
