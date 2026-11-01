echo "== fm.js crew: headless agy processes per task"
export FM_AGY="$ROOT/tests/fixtures/fake-agy.js"
C="$T/crew"; mkdir -p "$C"; (cd "$C" && git init -q -b main && echo a > a.txt && git add -A && git -c user.name=t -c user.email=t@t commit -qm i)
fm init "$C" >/dev/null; fm start "$C" b1 >/dev/null; fm start "$C" b2 >/dev/null
CO=$(fm crew "$C" b1 --role builder --brief "WRITE_FILE:hello.txt say hi" 2>&1)
check "crew: builder runs in the task workspace" 1 "$(grep -cE 'CWD=.*[/\\]b1$' <<< "$CO")"
check "crew: the role and task reach the agent's hooks" 1 "$(grep -c 'ROLE=builder TASK=b1' <<< "$CO")"
check "crew: builder uses the standard model" 1 "$(grep -c 'MODEL=gemini-3.8-flash-medium' <<< "$CO")"
check "crew: the builder's file is in its workspace" yes "$([ -f "$(fm path "$C" b1)/hello.txt" ] && echo yes)"
check "crew: fm.js saves and gates the builder's work itself" "1 1" "$(grep -c '^\[fm\] gate b1: PASS' <<< "$CO") $(fm status "$C" | grep 'b1 |' | grep -c 'gate: PASS')"
check "crew: a builder's failing gate fails the crew call" 1 "$(fm crew "$C" b2 --role builder --brief "WRITE_FILE:bad.json" >/dev/null 2>&1; echo $?)"
check "crew: tokens are logged per task" 1 "$(grep -c '"role":"builder"' "$C/.firstmate/notes/b1.crew.jsonl" 2>/dev/null)"
check "crew: a builder may not run on the strong model" 2 "$(fm crew "$C" b1 --role builder --model strong --brief x >/dev/null 2>&1; echo $?)"
check "crew: unknown role is refused" 2 "$(fm crew "$C" b1 --role pirate --brief x >/dev/null 2>&1; echo $?)"
check "crew: a builder needs a started task" 2 "$(fm crew "$C" nope --role builder --brief x >/dev/null 2>&1; echo $?)"
check "crew: a reader runs in the repo on the fast model" 1 "$(fm crew "$C" look --role reader --brief x 2>&1 | grep -c 'MODEL=gemini-3.8-flash-low')"
printf '[{"task":"b1","role":"builder","brief":"SLEEP:1200 one"},{"task":"b2","role":"builder","brief":"SLEEP:1200 two"}]' > "$T/batch.json"
S0=$(node -e 'console.log(Date.now())'); BO=$(fm crew "$C" --batch "$T/batch.json" 2>&1); S1=$(node -e 'console.log(Date.now())')
check "crew --batch runs the crew in parallel" yes "$([ $((S1 - S0)) -lt 2300 ] && echo yes || echo "no ($((S1 - S0)) ms)")"
check "crew --batch reports every member" 2 "$(grep -c 'ROLE=builder' <<< "$BO")"
printf '[{"task":"b1","role":"builder","brief":"x"},{"task":"b1","role":"builder","brief":"y"}]' > "$T/batch2.json"
check "crew --batch refuses two builders in one task" 2 "$(fm crew "$C" --batch "$T/batch2.json" >/dev/null 2>&1; echo $?)"
check "crew: a failed agent run exits 1" 1 "$(FAKE_AGY_FAIL=1 fm crew "$C" b2 --role builder --brief x >/dev/null 2>&1; echo $?)"
fm config "$C" caps.crewPerDay 1 >/dev/null
check "crew: the daily cap stops more runs" 2 "$(fm crew "$C" b2 --role builder --brief x >/dev/null 2>&1; echo $?)"
fm config "$C" caps.crewPerDay 40 >/dev/null
echo "== guard: roles from the crew's environment"
check "FM_ROLE=reader cannot write" deny "$(FM_ROLE=reader guard plain write_to_file '{"TargetFile":"/r/src/a.js"}')"
check "FM_ROLE=judge cannot write" deny "$(FM_ROLE=judge guard plain write_to_file '{"TargetFile":"/r/src/a.js"}')"
check "FM_ROLE=builder cannot forge a gate result" deny "$(FM_ROLE=builder guard plain write_to_file '{"TargetFile":"/r/.firstmate/notes/t.gate"}')"
check "FM_ROLE=builder may write its workspace" allow "$(FM_ROLE=builder guard plain write_to_file '{"TargetFile":"/r/src/a.js"}')"
