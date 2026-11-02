echo "== fm.js run: a task's whole loop in one command (build, gate, fix, judges, deliver)"
export FM_AGY="$ROOT/tests/fixtures/fake-agy.js" FM_QUOTA_TTL_SEC=0 FAKE_AGY_USAGE_FILE="$T/usage-run.json" FAKE_AGY_ARGS="$T/run-args.jsonl"
printf '{}' > "$FAKE_AGY_USAGE_FILE"
RR="$T/run"; mkdir -p "$RR"; (cd "$RR" && git init -q -b main && echo a > a.txt && git add -A && git -c user.name=t -c user.email=t@t commit -qm i && git checkout -qb work)
fm init "$RR" >/dev/null; fm config "$RR" merge commit >/dev/null
committed() { git -C "$RR" log --format=%s | grep -c "^firstmate: $1\$"; }
# the prompts the fake agy got for one task and role, as one text
prompts() { node -e 'const [f,t,role]=process.argv.slice(1);const ls=require("fs").readFileSync(f,"utf8").trim().split("\n").map(JSON.parse);const p=ls.map(a=>a[a.indexOf("-p")+1]).filter(x=>x&&x.includes(`TASK: ${t}`)&&x.includes(`ROLE: ${role}`));console.log(p.length);console.log(p.join("\n=====\n"))' "$FAKE_AGY_ARGS" "$1" "$2"; }

echo "-- the common paths"
RO=$(fm run "$RR" r1 --request "Add release notes" --brief "WRITE_FILE:notes.md" 2>&1); RC=$?
check "run: a low-risk task is built, gated and delivered in one call" "0 1" "$RC $(committed r1)"
check "run: low risk needs no judge" 0 "$(prompts r1 judge | head -1)"
check "run: says what it delivered" 1 "$(grep -c '^\[fm\] run r1: delivered as commit ' <<< "$RO")"
RO=$(fm run "$RR" r2 --request "Add a feature" --brief "WRITE_FILE:feature.js" 2>&1); RC=$?
check "run: a medium-risk task goes through both judges, then is delivered" "0 2 1" "$RC $(prompts r2 judge | head -1) $(committed r2)"
RO=$(fm run "$RR" r3 --request "Add data" --brief "WRITE_FILE:data.json FIXED_IN_ROUND2" 2>&1); RC=$?
check "run: a failing gate goes back to the builder, which fixes it" "0 2 1" "$RC $(prompts r3 builder | head -1) $(committed r3)"
check "run: the fix round carries the failing gate lines" 1 "$(prompts r3 builder | awk '/^=====$/{n++} n==1' | grep -c 'FIX ROUND 2')"
check "run: ...and what failed" 1 "$(prompts r3 builder | awk '/^=====$/{n++} n==1' | grep -cm1 'FAIL ')"

fm start "$RR" r8 --request "Add a parser, tests first" >/dev/null
fm crew "$RR" r8 --role builder --as "tester" --brief "WRITE_FILE:parser.test.js" >/dev/null 2>&1; fm lock "$RR" r8 parser.test.js >/dev/null 2>&1
RO=$(fm run "$RR" r8 --request "Add a parser" --brief "WRITE_FILE:parser.js" 2>&1); RC=$?
check "run: after the tester's round, its own builder still runs before delivery" "0 2 1" "$RC $(prompts r8 builder | head -1) $(committed r8)"

echo "-- where it stops for the first mate or the captain"
RO=$(fm run "$RR" r4 --request "Change it REVISE_IF_MODEL:claude" --brief "WRITE_FILE:feat4.js" 2>&1); RC=$?
check "run: a REVISE sends the judges' fixes to the builder" 1 "$(prompts r4 builder | awk '/^=====$/{n++} n==1' | grep -c 'fix y')"
check "run: judges that keep asking for changes stop it after 3 builder rounds, exit 1" "1 3 0" "$RC $(prompts r4 builder | head -1) $(committed r4)"
check "run: ...and it says what is next" 1 "$(grep -c '^\[fm\] run r4: stopped, NEXT ' <<< "$RO")"
RO=$(fm run "$RR" r5 --request "Containerise" --brief "WRITE_FILE:Dockerfile" 2>&1); RC=$?
check "run: high risk waits for the captain, exit 3" "3 0" "$RC $(committed r5)"
check "run: ...and says so" 1 "$(grep -c '^\[fm\] run r5: waits for the captain' <<< "$RO")"
printf '{"Gemini Models":{"remaining":0,"reset":"2099-01-01T00:00:00Z"}}' > "$FAKE_AGY_USAGE_FILE"
check "run: no quota for the builders, exit 4" 4 "$(fm run "$RR" r6 --request "x" --brief "WRITE_FILE:r6.md" >/dev/null 2>&1; echo $?)"
printf '{}' > "$FAKE_AGY_USAGE_FILE"
check "run: a brief is required" 2 "$(fm run "$RR" r7 --request "x" >/dev/null 2>&1; echo $?)"

echo "-- several tasks at once"
printf '[{"task":"p1","request":"one","brief":"SLEEP:1200 WRITE_FILE:p1.md"},{"task":"p2","request":"two","brief":"SLEEP:1200 WRITE_FILE:p2.md"}]' > "$T/run-batch.json"
BO=$(FAKE_AGY_LOG="$T/run-par.log" fm run "$RR" --batch "$T/run-batch.json" 2>&1); RC=$?
GAP=$(node -e 'const t=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map((l)=>Number(l.split(" ")[0]));console.log(t.length===2?Math.abs(t[0]-t[1]):-1)' "$T/run-par.log")
check "run --batch: the builders run in parallel" yes "$([ "$GAP" -ge 0 ] && [ "$GAP" -lt 700 ] && echo yes || echo "no (finish gap $GAP ms)")"
check "run --batch: every task is delivered, exit 0" "0 1 1" "$RC $(committed p1) $(committed p2)"
check "run --batch: one line per task at the end" 2 "$(grep -cE '^\[fm\] run p[12]: delivered' <<< "$BO")"

echo "-- the first mate uses it"
check "firstmate.md: a change goes through fm.js run" 1 "$(grep -c 'fm.js run <repo> --batch' "$ROOT/plugin/agents/firstmate.md")"
check "guard: the crew may not run tasks" deny "$(FM_ROLE=builder guard plain run_command "$(cmdjson "node \"$FMJS\" run /r --batch x.json")")"
unset FM_QUOTA_TTL_SEC FAKE_AGY_USAGE_FILE FAKE_AGY_ARGS
