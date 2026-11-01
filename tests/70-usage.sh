echo "== fm.js usage"
U=$(FM_BRAIN_DIR="$ROOT/tests/fixtures/usage/brain" FM_STATE_DIR="$ROOT/tests/fixtures/usage/state" fm usage p1 2>&1)
check "usage: main row" 1 "$(grep -c '^p1 main gemini-4-argon-medium calls=2 new_in=1200 cache=800 out=150$' <<< "$U")"
check "usage: child found from the parent transcript" 1 "$(grep -c '^c1 sub gemini-3.8-flash-tiered calls=2 new_in=800 cache=1700 out=300$' <<< "$U")"
check "usage: strong share" "strong share: new_in 60%, cache 32%, out 33%" "$(tail -1 <<< "$U")"
check "usage: unknown chat is an error" 2 "$(FM_BRAIN_DIR="$T/none" fm usage nope >/dev/null 2>&1; echo $?)"
