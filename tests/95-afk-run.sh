echo "== afk: the first mate plans the batch, the runner runs it (no chat waits on a long command)"
export FM_AGY="$ROOT/tests/fixtures/fake-agy.js" FM_QUOTA_TTL_SEC=0 FAKE_AGY_USAGE_FILE="$T/usage-afkrun.json"
printf '{}' > "$FAKE_AGY_USAGE_FILE"
AR="$T/afkrun"; mkdir -p "$AR"; (cd "$AR" && git init -q -b main && echo a > a.txt && git add -A && git -c user.name=t -c user.email=t@t commit -qm i && git checkout -qb work)
fm init "$AR" >/dev/null; fm config "$AR" merge commit >/dev/null
committed() { git -C "$AR" log --format=%s | grep -c "^firstmate: $1\$"; }

fm queue "$AR" add "Write the notes AFK_WRITE_BATCH:afk-notes:afknotes.md" >/dev/null
AO=$(fm afk "$AR" 2>&1); RC=$?
check "afk: the first mate is told where to write its batch" 1 "$(node -e 'console.log(require(process.argv[1]).matePrompt({id:1,request:"x"},"/r"))' "$ROOT/plugin/scripts/fm-afk.js" | grep -c 'BATCH FILE: /r/.firstmate/briefs/afk-1.json')"
check "afk: the runner runs the batch the first mate wrote, and it is delivered" "0 1" "$RC $(committed afk-notes)"
check "afk: the item's summary carries the run's result" 1 "$(fm queue "$AR" | grep 'Write the notes' | grep -c 'delivered')"
fm queue "$AR" add "Just a question, no batch" >/dev/null
check "afk: an item without a batch is done with the first mate's answer" "0 1" "$(fm afk "$AR" >/dev/null 2>&1; echo $?) $(fm queue "$AR" | grep 'Just a question' | grep -c ' done ')"

echo "-- a batch cut short by quota waits in the queue with its batch, and runs later without a new chat"
export FAKE_AGY_ARGS="$T/afkrun-args.jsonl"; : > "$FAKE_AGY_ARGS"
mates() { grep -c '"--agent","firstmate"' "$FAKE_AGY_ARGS"; }
# the first mate writes its batch and uses up the Gemini group, so the builders find no quota
fm queue "$AR" add "Later AFK_WRITE_BATCH:afk-later:later.md EXHAUST_GEMINI" >/dev/null
fm afk "$AR" >/dev/null 2>&1
check "afk: the item waits again, with its batch, and nothing was delivered" "1 0 1" "$(fm queue "$AR" | grep 'Later' | grep -c ' waiting ') $(committed afk-later) $(mates)"
printf '{}' > "$FAKE_AGY_USAGE_FILE"
check "afk: once the quota is back the batch runs, without a new first-mate chat" "0 1 1" "$(fm afk "$AR" >/dev/null 2>&1; echo $?) $(committed afk-later) $(mates)"
unset FAKE_AGY_ARGS

echo "-- the guard keeps the afk first mate to planning"
check "guard: in afk the first mate may not run the batch itself" deny "$(FM_AFK=1 guard fm run_command "$(cmdjson "node \"$FMJS\" run /r --batch x.json")")"
check "guard: ...nor crew or deliver" "deny deny" "$(FM_AFK=1 guard fm run_command "$(cmdjson "node \"$FMJS\" crew /r --batch x.json")") $(FM_AFK=1 guard fm run_command "$(cmdjson "node \"$FMJS\" deliver /r t")")"
check "guard: ...but may plan with fm.js" allow "$(FM_AFK=1 guard fm run_command "$(cmdjson "node \"$FMJS\" init /r")")"
check "guard: outside afk the first mate runs the batch itself" allow "$(guard fm run_command "$(cmdjson "node \"$FMJS\" run /r --batch x.json")")"
unset FM_QUOTA_TTL_SEC FAKE_AGY_USAGE_FILE
