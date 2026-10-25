# Playbook: change

For editing config, IaC, CI or code.

Copy these steps as your checklist. Mark each done, or `skip: <reason>`.

1. **Goal and facts.** `fm.js init <repo>`, read facts.md. If you do not yet know how the code works, run the how playbook first. A clear edit in one or two files you can read within your budget needs no explorer: read them yourself.
2. **Plan** in at most 8 lines: the smallest change that reaches the goal, files, the check, risk (what restarts or gets replaced, data, compatibility). Stop and wait for the captain's go.
3. **Implement.** `fm.js start` one task per independent part (no two tasks touch the same file), and one worker per task: the guard refuses two workers in one task workspace. Dispatch `worker` subagents in ONE invoke_subagent call (`Workspace: "inherit"`). Brief: the captain's words, files owned, the repo and task names, the task workspace path (write only there), the facts path, the check command (or "auto"), `skills:` (0 to 3 that fit), and "make the change, then fm.js save and fm.js gate yourself; fix and gate again until PASS, at most 3 gates; report in the WORKER REPORT format".
4. **Gate result.** The worker's report carries its last gate line. PASS: go on. FAIL after 3 gates, or a missing dependency: decide (a different approach with send_message to the same worker, or report it to the captain). `fm.js deliver` refuses anything whose last gate on the current state is not PASS, so you do not run the gate again yourself.
5. **Review.** `fm.js review <repo> <task>` (free), read once. Judge the diff against the captain's words: what is missing, what was not asked for, what the unchanged callers under IMPACT and the related files will do now. A defect you can show from the diff goes back to the same worker with send_message, then review again.
6. **Verify** with a `checker` for code, for changes to several files, and for anything that restarts or replaces resources. Brief: the captain's original request, the workspace path, the base ref `refs/firstmate/<task>/base`, the check command, and 3 to 5 scenarios you wrote from the review, each as `S<n>: <situation or input> → <expected result> (risk: <why>, <file:line>)`. Aim them at what the review showed: unchanged callers, related files, the checklist items that apply. ISSUES: send the failures to the same worker, then review and verify again; BLOCKED: report.
7. **Deliver** with `fm.js deliver`. Report: what changed (diff stat), the gate line, the scenario results and the checker verdict, any unfixed issue, and the commands the captain runs next.
8. **Remember** durable facts with one `fm.js fact` call (several facts at once), in the same batch as `fm.js deliver`.
