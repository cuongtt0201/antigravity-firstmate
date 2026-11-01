echo "== trust and report"
TR="$T/trust"; mkdir -p "$TR"; (cd "$TR" && git init -q -b main && echo a > a.md && git add -A && git -c user.name=t -c user.email=t@t commit -qm i && git checkout -q -b feat && git config user.name t && git config user.email t@t)
fm init "$TR" >/dev/null; fm config "$TR" merge commit >/dev/null
for t in t1 t2 t3; do fm start "$TR" $t >/dev/null; echo "$t" > "$(fm path "$TR" $t)/$t.md"; fm save "$TR" $t x >/dev/null; fm gate "$TR" $t >/dev/null 2>&1; fm deliver "$TR" $t >/dev/null 2>&1; done
fm undo "$TR" t1 >/dev/null 2>&1
git -C "$TR" revert --no-edit "$(git -C "$TR" log --format=%H --grep '^Firstmate-Task: t2$' -1)" >/dev/null 2>&1
TO=$(fm trust "$TR")
check "trust: merged, undone, reverted by the captain" "merged 3 | undone 1 | reverted by the captain 1 | kept 1 (33%)" "$(grep -o 'merged.*' <<< "$TO" | head -1)"
fm start "$TR" w1 >/dev/null; rm "$(fm path "$TR" w1)/a.md"; fm save "$TR" w1 x >/dev/null; fm gate "$TR" w1 >/dev/null 2>&1; fm deliver "$TR" w1 >/dev/null 2>&1
printf '{"time":"2026-11-01T00:00:00Z","role":"builder","model":"gemini-3.8-flash-medium","status":"SUCCESS","usage":{"input_tokens":1000,"output_tokens":100,"cache_read_tokens":0}}\n{"time":"2026-11-01T00:00:01Z","role":"judge","model":"gemini-4-argon-medium","status":"SUCCESS","usage":{"input_tokens":500,"output_tokens":50,"cache_read_tokens":0}}\n' > "$TR/.firstmate/notes/t3.crew.jsonl"
RO=$(fm report "$TR")
check "report: merged tasks listed" 3 "$(grep -cE '^  (t1|t2|t3) ' <<< "$RO")"
check "report: tasks waiting for the captain" 1 "$(grep -cE '^  w1 .*waiting' <<< "$RO")"
check "report: crew tokens and the strong share" "crew tokens: 1650 (strong model 550, 33%)" "$(grep -o 'crew tokens:.*' <<< "$RO")"
