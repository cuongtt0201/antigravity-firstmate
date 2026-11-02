echo "== quota: the models this account offers and the quota groups decide who may run"
export FM_AGY="$ROOT/tests/fixtures/fake-agy.js" FM_QUOTA_TTL_SEC=0 FAKE_AGY_USAGE_FILE="$T/usage.json"
FUTURE=2099-01-01T00:00:00Z
usage() { printf '%s' "$1" > "$FAKE_AGY_USAGE_FILE"; }
Q="$T/quota"; mkdir -p "$Q"; (cd "$Q" && git init -q -b main && echo a > a.txt && git add -A && git -c user.name=t -c user.email=t@t commit -qm i)
fm init "$Q" >/dev/null
qd() { fm start "$Q" "$1" --request "$2" >/dev/null; printf 'module.exports = 1\n' > "$(fm path "$Q" "$1")/$1.js"; fm save "$Q" "$1" x >/dev/null; fm gate "$Q" "$1" >/dev/null 2>&1; }
models() { printf '%s %s' "$(grep -c 'MODEL=gemini-4-argon-medium' <<< "$1")" "$(grep -c 'MODEL=claude-sonnet-5-5-medium' <<< "$1")"; }
ARGON0='{"Gemini 4 Argon":{"remaining":0,"reset":"'$FUTURE'"}}'

echo "-- fm.js quota"
usage "$ARGON0"
QO=$(fm quota "$Q" 2>&1)
check "quota: lists every group" 3 "$(grep -cE '^  (Gemini Models|Claude and GPT models|Gemini 4 Argon) ' <<< "$QO")"
check "quota: an empty group shows when it comes back" 1 "$(grep -c "Gemini 4 Argon .*EMPTY until $FUTURE" <<< "$QO")"
check "quota: says which roles a group serves" 1 "$(grep -c 'Gemini 4 Argon .*used for: strong' <<< "$QO")"
check "quota: works without a repo" 3 "$(fm quota 2>&1 | grep -cE '^  (Gemini|Claude)')"

echo "-- the judges skip a model that cannot answer"
qd q1 "Edit code"
JO=$(fm judge "$Q" q1 2>&1); RC=$?
check "judges: Argon without quota is skipped, Claude judges alone" "0 0 1" "$RC $(models "$JO")"
check "judges: the skip is said with its reset time" 1 "$(grep -c "skipped gemini-4-argon-medium: Gemini 4 Argon quota at 0% until $FUTURE" <<< "$JO")"
check "judges: the verdict records the skip" 1 "$(sed -n 2p "$Q/.firstmate/notes/q1.verdict" | grep -c 'skipped gemini-4-argon-medium')"
usage '{}'
qd q2 "Edit code"
check "judges: a model the account does not offer is skipped" "0 1 0" "$(J2=$(FAKE_AGY_MODELS=gemini-4-argon-medium,gemini-3.8-flash-medium,gemini-3.8-flash-low fm judge "$Q" q2 2>&1); echo "$? $(models "$J2")")"
usage '{"Gemini 4 Argon":{"remaining":0,"reset":"'$FUTURE'"},"Claude and GPT models":{"remaining":0.01,"reset":"'$FUTURE'"}}'
qd q3 "Edit code"
J3=$(fm judge "$Q" q3 2>&1); RC3=$?
check "judges: with no judge left nothing runs, exit 4 (a group under the 2% reserve counts as empty)" "4 0" "$RC3 $(grep -c 'MODEL=' <<< "$J3")"
check "ladder: the task waits for quota" "NEXT: wait for quota" "$(fm ladder "$Q" q3 | head -1)"
check "report: the task waits for judge quota" 1 "$(fm report "$Q" | grep 'q3 |' | grep -c 'judge quota')"
usage '{"Claude and GPT models":{"remaining":0,"reset":"'$FUTURE'"}}'
check "judges: a rescue falls back to a judge with quota" "1 0" "$(models "$(fm judge "$Q" q3 --rescue 2>&1)")"
check "ladder: a judge that ran clears the wait" 0 "$(fm ladder "$Q" q3 | grep -c 'wait for quota')"

echo "-- the crew does not start without quota"
fm start "$Q" q4 >/dev/null
usage '{"Gemini Models":{"remaining":0,"reset":"'$FUTURE'"}}'
check "crew: a builder without Gemini quota is refused before it starts, exit 4" 4 "$(fm crew "$Q" q4 --role builder --brief "WRITE_FILE:x.txt" >/dev/null 2>&1; echo $?)"
check "crew: ...and nothing ran" no "$([ -f "$(fm path "$Q" q4)/x.txt" ] && echo yes || echo no)"
usage 'not json'
check "quota: when agy cannot tell, every model may run" 0 "$(fm crew "$Q" q4 --role builder --brief "WRITE_FILE:x.txt" >/dev/null 2>&1; echo $?)"

echo "-- afk waits for the first mate's quota"
A2="$T/afk-quota"; mkdir -p "$A2"; (cd "$A2" && git init -q -b main && echo a > a.txt && git add -A && git -c user.name=t -c user.email=t@t commit -qm i && git checkout -qb work)
fm init "$A2" >/dev/null; fm config "$A2" merge commit >/dev/null
fm queue "$A2" add "one" >/dev/null
SOON=$(node -e 'console.log(new Date(Date.now() + 1500).toISOString())')
usage '{"Gemini Models":{"remaining":0,"reset":"'$SOON'"}}'
AO=$(FM_AFK_POLL_MS=200 FM_AFK_PAD_MS=0 fm afk "$A2" 2>&1); RC=$?
check "afk: waits for the Gemini quota to come back, then runs" "0 1 1" "$RC $(grep -c 'waiting for quota' <<< "$AO") $(fm queue "$A2" | grep -c ' done ')"
fm queue "$A2" add "two" >/dev/null
usage '{"Gemini Models":{"remaining":0,"reset":"'$FUTURE'"}}'
AO2=$(fm afk "$A2" 2>&1); RC2=$?
check "afk: stops when the quota comes back after afkMaxWaitHours" "1 1 1" "$RC2 $(grep -c 'afkMaxWaitHours' <<< "$AO2") $(fm queue "$A2" | grep ' two' | grep -c ' waiting ')"
fm queue "$A2" drop "$(fm queue "$A2" | grep ' two' | sed -E 's/^ *#([0-9]+).*/\1/')" >/dev/null
usage '{}'
fm queue "$A2" add "use it up EXHAUST_GEMINI FAIL_IF_MODEL:flash" >/dev/null
AO3=$(fm afk "$A2" 2>&1); RC3=$?
check "afk: an item cut short by quota, with nothing delivered, goes back to the queue" "1 1" "$RC3 $(fm queue "$A2" | grep 'use it up' | grep -c ' waiting ')"
unset FM_QUOTA_TTL_SEC FAKE_AGY_USAGE_FILE
