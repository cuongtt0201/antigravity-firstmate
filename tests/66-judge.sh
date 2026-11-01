echo "== judge: dossier, verdict, deliver needs approval for medium risk"
export FM_AGY="$ROOT/tests/fixtures/fake-agy.js"
jt() { fm start "$C" "$1" --request "$2" >/dev/null; printf "$4" > "$(fm path "$C" "$1")/$3"; fm save "$C" "$1" x >/dev/null; fm gate "$C" "$1" >/dev/null 2>&1; }
jt j1 "Add a greeting file" hello.md 'hi\n'
DO=$(fm dossier "$C" j1 2>&1)
check "dossier: all sections" 6 "$(grep -cE '^## (REQUEST|DONE WHEN|RISK|LOCKED TESTS|GATE|REVIEW)$' <<< "$DO")"
check "dossier: the request verbatim" 1 "$(grep -cx 'Add a greeting file' <<< "$DO")"
fm start "$C" j2 --request "big" >/dev/null; for i in $(seq 1 5000); do echo "line $i of a long generated file"; done > "$(fm path "$C" j2)/big.txt"; fm save "$C" j2 x >/dev/null
check "dossier: capped at 30 KB" yes "$([ "$(fm dossier "$C" j2 | wc -c | tr -d ' ')" -le 30720 ] && echo yes)"
JO=$(fm judge "$C" j1 2>&1); RC=$?
check "judge: APPROVE exits 0" 0 "$RC"
check "judge: runs on the strong model" 1 "$(grep -c 'MODEL=gemini-4-argon-medium' <<< "$JO")"
check "judge: verdict recorded for the current head" APPROVE "$(head -1 "$C/.firstmate/notes/j1.verdict" 2>/dev/null | cut -d' ' -f2)"
jt j3 "Change it, PLEASE_REVISE" hello.md 'x\n'
check "judge: REVISE exits 1" 1 "$(fm judge "$C" j3 >/dev/null 2>&1; echo $?)"
check "judge: a raised risk sticks" "RISK: high" "$(fm risk "$C" j3 | head -1)"
fm config "$C" merge apply >/dev/null
jt m1 "Edit code" src.js 'module.exports = 1\n'
check "deliver: medium risk without a verdict waits" 3 "$(fm deliver "$C" m1 >/dev/null 2>&1; echo $?)"
fm judge "$C" m1 >/dev/null 2>&1
check "deliver: medium risk with the judge's APPROVE merges" 0 "$(fm deliver "$C" m1 >/dev/null 2>&1; echo $?)"
check "ledger: verdict column" "APPROVE (judge)" "$(tail -1 "$C/.firstmate/notes/ledger.tsv" | cut -f6)"
git -C "$C" checkout -q -- . ; git -C "$C" clean -fdq
jt m2 "Edit code again" src2.js 'module.exports = 2\n'; fm verdict "$C" m2 APPROVE ok >/dev/null
printf 'module.exports = 3\n' > "$(fm path "$C" m2)/src2.js"; fm save "$C" m2 y >/dev/null; fm gate "$C" m2 >/dev/null 2>&1
check "deliver: a verdict on an older head does not count" 3 "$(fm deliver "$C" m2 >/dev/null 2>&1; echo $?)"
check "guard: the crew may not write verdicts" deny "$(FM_ROLE=builder guard plain run_command "$(cmdjson "node \"$FMJS\" verdict /r t APPROVE ok")")"
