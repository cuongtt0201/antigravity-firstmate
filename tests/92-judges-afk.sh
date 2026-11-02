echo "== a judge panel of two model families, and the afk queue"
export FM_AGY="$ROOT/tests/fixtures/fake-agy.js"
J="$T/judges"; mkdir -p "$J"; (cd "$J" && git init -q -b main && echo a > a.txt && git add -A && git -c user.name=t -c user.email=t@t commit -qm i)
fm init "$J" >/dev/null
jd() { fm start "$J" "$1" --request "$2" >/dev/null; printf 'module.exports = 1\n' > "$(fm path "$J" "$1")/$1.js"; fm save "$J" "$1" x >/dev/null; fm gate "$J" "$1" >/dev/null 2>&1; }
models() { printf '%s %s' "$(grep -c 'MODEL=gemini-4-argon-medium' <<< "$1")" "$(grep -c 'MODEL=claude-sonnet-5-5-medium' <<< "$1")"; }
vd() { head -1 "$J/.firstmate/notes/$1.verdict" 2>/dev/null | cut -d' ' -f2; }

echo "-- the judge panel"
jd p1 "Edit code"
PO=$(fm judge "$J" p1 2>&1); RC=$?
check "judges: Argon and Claude both judge by default" "1 1" "$(models "$PO")"
check "judges: both APPROVE → APPROVE from the judge, exit 0" "0 APPROVE judge" "$RC $(head -1 "$J/.firstmate/notes/p1.verdict" | cut -d' ' -f2-3)"
check "judges: the verdict names every judge's vote" 2 "$(sed -n 2p "$J/.firstmate/notes/p1.verdict" | grep -o ' APPROVE ' | wc -l | tr -d ' ')"
jd p2 "Edit code REVISE_IF_MODEL:claude"
PO2=$(fm judge "$J" p2 2>&1); RC2=$?
check "judges: one REVISE beats one APPROVE (the most cautious counts), exit 1" "1 REVISE" "$RC2 $(vd p2)"
check "judges: a disagreement is said" 1 "$(grep -c 'judges disagree' <<< "$PO2")"
check "ladder: the REVISE goes back to the builder" "NEXT: fix" "$(fm ladder "$J" p2 | head -1)"
jd p3 "Edit code FAIL_IF_MODEL:claude"
check "judges: a judge that fails leaves HUMAN, exit 1" "1 HUMAN" "$(fm judge "$J" p3 >/dev/null 2>&1; echo $?) $(vd p3)"
check "ladder: a failed judge goes to the captain" "NEXT: ask captain" "$(fm ladder "$J" p3 | head -1)"
jd p4 "Edit code"; fm config "$J" judges '["strong"]' >/dev/null
check "judges: the captain can make it one judge" "1 0" "$(models "$(fm judge "$J" p4 2>&1)")"
fm config "$J" judges '["strong","second"]' >/dev/null
jd p5 "Edit code"
check "judges: --model picks one judge" "0 1" "$(models "$(fm judge "$J" p5 --model second 2>&1)")"
check "judges: a rescue asks the other family" "0 1" "$(models "$(fm judge "$J" p5 --rescue 2>&1)")"
check "judges: each judge gets its own prompt file when the prompt is long" 2 "$(FM_ARGV_LIMIT=500 fm judge "$J" p1 >/dev/null 2>&1; ls "$J/.firstmate/notes/" | grep -c '^p1\.judge\..*prompt\.md$')"

echo "-- the queue and the afk runner"
A="$T/afk"; mkdir -p "$A"; (cd "$A" && git init -q -b main && echo a > a.txt && git add -A && git -c user.name=t -c user.email=t@t commit -qm i && git checkout -qb work)
AP=$(cd "$A" && pwd -P); [ -n "$WIN" ] && AP=$(cygpath -m "$AP")
fm init "$A" >/dev/null
check "afk: nothing queued is not an error" 0 "$(fm afk "$A" >/dev/null 2>&1; echo $?)"
fm queue "$A" add "Add a --json flag" "Fix the unicode slug" >/dev/null
check "queue: add takes several requests in one call" 2 "$(fm queue "$A" | grep -c ' waiting ')"
check "afk: refuses unless the merge mode is commit" 2 "$(fm afk "$A" >/dev/null 2>&1; echo $?)"
check "afk: says how the captain sets it" 1 "$(fm afk "$A" 2>&1 | grep -c 'fm.js config .* merge commit')"
fm config "$A" merge commit >/dev/null
git -C "$A" checkout -q main
check "afk: refuses on a protected branch" 2 "$(fm afk "$A" >/dev/null 2>&1; echo $?)"
git -C "$A" checkout -q work; echo dirty > "$A/a.txt"
check "afk: refuses on a dirty working tree" 2 "$(fm afk "$A" >/dev/null 2>&1; echo $?)"
git -C "$A" checkout -q -- a.txt
export FAKE_AGY_ARGS="$T/afk-args.jsonl"
AO=$(fm afk "$A" 2>&1); ARC=$?
check "afk: runs every waiting item and exits 0" "0 2" "$ARC $(fm queue "$A" | grep -c ' done ')"
arg() { node -e 'const ls=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n").map(JSON.parse).filter(a=>a.includes("--agent"));const a=ls[Number(process.argv[2])];const v=(k)=>a[a.indexOf(k)+1];console.log(eval(process.argv[3]))' "$FAKE_AGY_ARGS" "$1" "$2"; }
check "afk: one first-mate chat per item" 2 "$(grep -c '"--agent","firstmate"' "$FAKE_AGY_ARGS")"
check "afk: items run in queue order" "true true" "$(arg 0 'v("-p").includes("--json flag")') $(arg 1 'v("-p").includes("unicode slug")')"
check "afk: each chat is told it runs unattended" "true true" "$(arg 0 'v("-p").includes("unattended")') $(arg 1 'v("-p").includes("unattended")')"
check "afk: the first mate runs on Flash" 1 "$(arg 0 'v("--model").includes("flash")' | grep -c true)"
check "afk: session grants for fm.js, the brief folder and the task workspaces" "true true true" "$(arg 0 'const s=JSON.parse(v("--settings")).permissions.allow;[s.some(x=>/^command\(node .*\/fm\.js\)$/.test(x)),s.includes("write_file('"$AP"'/.firstmate/briefs)"),s.includes("read_file('"$FM_WT_ROOT"')")].join(" ")')"
fm queue "$A" add "break FAIL_IF_MODEL:flash" "after the failure" >/dev/null
check "afk: a failed item exits 1 and the next item still runs" "1 1 3" "$(fm afk "$A" >/dev/null 2>&1; echo $?) $(fm queue "$A" | grep -c ' failed ') $(fm queue "$A" | grep -c ' done ')"
fm queue "$A" add "leave a mess WRITE_FILE:mess.txt" "after the mess" >/dev/null
check "afk: stops when an item leaves uncommitted changes" "1 1" "$(fm afk "$A" >/dev/null 2>&1; echo $?) $(fm queue "$A" | grep 'after the mess' | grep -c ' waiting ')"
rm -f "$A/mess.txt"; fm queue "$A" drop "$(fm queue "$A" | grep 'after the mess' | sed -E 's/^ *#([0-9]+).*/\1/')" >/dev/null
check "queue: drop removes a waiting item" 0 "$(fm queue "$A" | grep -c 'after the mess')"
fm queue "$A" add "slow SLEEP:1500" "next after slow" >/dev/null
( fm afk "$A" >/dev/null 2>&1 & ); sleep 0.5
check "afk: refuses while another runner runs" 2 "$(fm afk "$A" >/dev/null 2>&1; echo $?)"
fm afk "$A" --stop >/dev/null
for i in $(seq 1 40); do [ -f "$A/.firstmate/notes/afk.pid" ] || break; sleep 0.2; done
check "afk: --stop stops after the current item" "1 1" "$(fm queue "$A" | grep 'slow' | grep -c ' done ') $(fm queue "$A" | grep 'next after slow' | grep -c ' waiting ')"
check "afk: --stop with no runner says so" 1 "$(fm afk "$A" --stop 2>&1 | grep -c 'no afk runner')"
S0=$(node -e 'console.log(Date.now())'); fm afk "$A" --detach >/dev/null 2>&1; S1=$(node -e 'console.log(Date.now())')
check "afk: --detach returns at once" yes "$([ $((S1 - S0)) -lt 3000 ] && echo yes || echo "no ($((S1 - S0)) ms)")"
for i in $(seq 1 50); do fm queue "$A" | grep 'next after slow' | grep -q ' done ' && break; sleep 0.2; done
check "afk: the detached runner works the queue" 1 "$(fm queue "$A" | grep 'next after slow' | grep -c ' done ')"
check "report: counts the first mate's afk tokens" 1 "$(fm report "$A" | grep -c '^first mate (afk) tokens: ')"
check "guard: the crew may not start afk" deny "$(FM_ROLE=builder guard plain run_command "$(cmdjson "node \"$FMJS\" afk /r --detach")")"
check "guard: the crew may not queue work" deny "$(FM_ROLE=builder guard plain run_command "$(cmdjson "node \"$FMJS\" queue /r add x")")"
unset FAKE_AGY_ARGS
