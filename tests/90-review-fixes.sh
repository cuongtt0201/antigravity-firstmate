echo "== review fixes"
export FM_AGY="$ROOT/tests/fixtures/fake-agy.js"
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec(\"insert into conversation_summaries values('fm2','firstmate',50),('bd','builder',50),('rd','reader',50),('jd','judge',50)\")" "$FM_CONVO_DB" 2>/dev/null
cwdjson() { node -e 'console.log(JSON.stringify({CommandLine:process.argv[1],Cwd:process.argv[2]}))' "$1" "$2"; }

echo "-- C2: settings are the captain's"
check "C2: the first mate may not set config through fm.js" deny "$(guard fm2 run_command "$(cmdjson "node \"$FMJS\" config /r packs '[\"core\"]'")")"
check "C2: the first mate may read config" allow "$(guard fm2 run_command "$(cmdjson "node \"$FMJS\" config /r merge")")"
check "C2: the first mate may not write the repo config file" deny "$(guard fm2 write_to_file '{"TargetFile":"/r/.firstmate/config.json"}')"
check "C2: no agent may write the global config file" deny "$(guard plain write_to_file "{\"TargetFile\":\"$FM_HOME/config.json\"}")"
fm config "$C" caps.crewPerDay 0 >/dev/null
check "C2: the daily cap sends the agent to the captain" 1 "$(fm crew "$C" b2 --role builder --brief x 2>&1 | grep -c 'ask the captain')"
fm config "$C" caps.crewPerDay 40 >/dev/null

echo "-- C1: the arena keeps locks and the task's record"
A="$T/arena"; mkdir -p "$A/tests"; (cd "$A" && git init -q -b main && printf 'process.exit(require("fs").existsSync(require("path").join(__dirname,"..","ok.txt"))?0:1)\n' > tests/a.test.js && echo x > readme.md && git add -A && git -c user.name=t -c user.email=t@t commit -qm i && git checkout -q -b feat && git config user.name t && git config user.email t@t)
fm init "$A" >/dev/null; fm config "$A" checks.test "node tests/a.test.js" >/dev/null; fm config "$A" merge commit >/dev/null
fm start "$A" s1 --request "make the test pass" >/dev/null; fm lock "$A" s1 tests/a.test.js >/dev/null
for i in 1 2 3; do fm gate "$A" s1 >/dev/null 2>&1; done
check "C1: the ladder says arena" "NEXT: arena 3" "$(fm ladder "$A" s1 | head -1)"
fm arena "$A" s1 --n 2 >/dev/null
check "C1: variants carry the parent's lock" yes "$([ -s "$A/.firstmate/notes/s1--a.locked" ] && echo yes)"
check "C1: the guard protects the locked test inside a variant" deny "$(guard wk write_to_file "{\"TargetFile\":\"$(fm path "$A" s1--a)/tests/a.test.js\"}")"
echo 'process.exit(0)' > "$(fm path "$A" s1--a)/tests/a.test.js"; fm save "$A" s1--a x >/dev/null
check "C1: a variant that weakens the test fails its gate" 1 "$(fm gate "$A" s1--a 2>&1 | grep -c 'locked tests/a.test.js changed')"
echo ok > "$(fm path "$A" s1--b)/ok.txt"; fm save "$A" s1--b x >/dev/null; fm gate "$A" s1--b >/dev/null 2>&1
fm arena-pick "$A" s1 b >/dev/null
check "C1: arena-pick keeps the parent's request and lock" "make the test pass yes" "$(cat "$A/.firstmate/notes/s1.request" 2>/dev/null) $([ -s "$A/.firstmate/notes/s1.locked" ] && echo yes)"
rm "$(fm path "$A" s1)/ok.txt"; fm save "$A" s1 y >/dev/null; for i in 1 2 3; do fm gate "$A" s1 >/dev/null 2>&1; done
check "C1: after an arena, more failures go to the judge, not to another arena" "NEXT: judge rescue" "$(fm ladder "$A" s1 | head -1)"

echo "-- I1: builders stay in their workspace"
W3=$(fm path "$R" t3)
check "I1: a builder may write in its own workspace" allow "$(FM_ROLE=builder FM_REPO="$R" FM_TASK=t3 guard plain write_to_file "{\"TargetFile\":\"$W3/src/new.js\"}")"
check "I1: a builder may not write outside its workspace" deny "$(FM_ROLE=builder FM_REPO="$R" FM_TASK=t3 guard plain write_to_file "{\"TargetFile\":\"$R/src/a.js\"}")"
check "I1: a builder may not write a .git path" deny "$(FM_ROLE=builder FM_REPO="$R" FM_TASK=t3 guard plain write_to_file "{\"TargetFile\":\"$W3/.git\"}")"
check "I1: an in-chat crew member may not write a .git path" deny "$(guard wk write_to_file '{"TargetFile":"/r/.git/hooks/pre-commit"}')"
fm start "$R" gx >/dev/null; GX=$(fm path "$R" gx); N0=$(git -C "$R" rev-list --count HEAD)
printf 'gitdir: %s/.git\n' "$R" > "$GX/.git"; echo n > "$GX/new.txt"
check "I1: save refuses a workspace whose .git points elsewhere" 2 "$(fm save "$R" gx x >/dev/null 2>&1; echo $?)"
check "I1: ...and the captain's branch got no commit" "$N0" "$(git -C "$R" rev-list --count HEAD)"
git -C "$R" reset -q; fm clean "$R" gx >/dev/null 2>&1

echo "-- I2: only firstmate workspaces are workspaces"
check "I2: git -C at the captain's repo from a task workspace" deny "$(guard plain run_command "$(cwdjson "git -C $R reset --hard" "$W3")")"
git -C "$R" worktree add -q "$T/capwt" -b cap-wt >/dev/null 2>&1
check "I2: the captain's own linked worktree is the captain's checkout" deny "$(guard plain run_command "$(cwdjson 'git reset --hard' "$T/capwt")")"
check "I2: a task workspace still allows reset --hard" allow "$(guard plain run_command "$(cwdjson 'git reset --hard' "$W3")")"

echo "-- I3: v1 role names in the App are guarded"
check "I3: an in-chat reader cannot write" deny "$(guard rd write_to_file '{"TargetFile":"/r/src/a.js"}')"
check "I3: an in-chat judge cannot deliver" deny "$(guard jd run_command "$(cmdjson "node \"$FMJS\" deliver /r t --approve")")"
check "I3: an in-chat builder cannot forge a gate result" deny "$(guard bd write_to_file '{"TargetFile":"/r/.firstmate/notes/t.gate"}')"
check "I3: an in-chat builder is pinned to Flash" 1 "$(node -e 'process.stdout.write(JSON.stringify({conversationId:"pin2",toolCall:{name:"invoke_subagent",args:{Subagents:[{TypeName:"builder",Model:"inherit"}]}}}))' | node "$GUARD" 2>/dev/null | grep -c '"Model":"flash"')"
check "I3: two in-chat builders in one workspace are refused" deny "$(node -e 'const p="WORKSPACE: /h/.firstmate/wt/rr-1a2b3c4d/x";process.stdout.write(JSON.stringify({conversationId:"two3",toolCall:{name:"invoke_subagent",args:{Subagents:[{TypeName:"builder",Prompt:p},{TypeName:"builder",Prompt:p}]}}}))' | node "$GUARD" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).decision))')"

echo "-- I4: renames"
RN="$T/rn"; mkdir -p "$RN/src"; (cd "$RN" && git init -q -b main && echo a > src/a.js && git add -A && git -c user.name=t -c user.email=t@t commit -qm i && git checkout -q -b feat && git config user.name t && git config user.email t@t)
fm init "$RN" >/dev/null; fm config "$RN" merge commit >/dev/null
fm start "$RN" mv1 >/dev/null; git -C "$(fm path "$RN" mv1)" mv src/a.js src/b.js; fm save "$RN" mv1 x >/dev/null; fm gate "$RN" mv1 >/dev/null 2>&1
echo "CAPTAIN WIP" >> "$RN/src/a.js"
check "I4: a rename over the captain's edits is refused" 2 "$(fm deliver "$RN" mv1 --approve >/dev/null 2>&1; echo $?)"
git -C "$RN" checkout -q -- .
fm deliver "$RN" mv1 --approve >/dev/null 2>&1
check "I4: a rename is committed whole" "" "$(git -C "$RN" status --porcelain)"

echo "-- I5: conflicts leave the captain's files alone"
CF="$T/cf"; mkdir -p "$CF"; (cd "$CF" && git init -q -b main && printf 'one\ntwo\n' > a.txt && git add -A && git -c user.name=t -c user.email=t@t commit -qm i && git checkout -q -b feat && git config user.name t && git config user.email t@t)
fm init "$CF" >/dev/null; fm config "$CF" merge commit >/dev/null
fm start "$CF" cf1 >/dev/null; printf 'one\ntask\n' > "$(fm path "$CF" cf1)/a.txt"; fm save "$CF" cf1 x >/dev/null; fm gate "$CF" cf1 >/dev/null 2>&1
printf 'one\ncaptain\n' > "$CF/a.txt"; git -C "$CF" commit -qam captain
check "I5: a conflicting delivery exits 1" 1 "$(fm deliver "$CF" cf1 >/dev/null 2>&1; echo $?)"
check "I5: ...leaves no conflict markers in the captain's file" "0 captain" "$(grep -c '<<<<<<<' "$CF/a.txt") $(tail -1 "$CF/a.txt")"
check "I5: ...and keeps the task" 1 "$(fm status "$CF" | grep -c 'cf1 |')"

echo "-- I6: only the judge approves medium risk"
fm start "$C" mv6 >/dev/null; printf 'module.exports = 6\n' > "$(fm path "$C" mv6)/six.js"; fm save "$C" mv6 x >/dev/null; fm gate "$C" mv6 >/dev/null 2>&1
fm verdict "$C" mv6 APPROVE "by hand" >/dev/null
check "I6: a hand-written APPROVE does not merge medium risk" 3 "$(fm deliver "$C" mv6 >/dev/null 2>&1; echo $?)"
fm judge "$C" mv6 >/dev/null 2>&1
check "I6: the judge's APPROVE does" 0 "$(fm deliver "$C" mv6 >/dev/null 2>&1; echo $?)"
check "I6: the ledger says who approved" "APPROVE (judge)" "$(tail -1 "$C/.firstmate/notes/ledger.tsv" | cut -f6)"
git -C "$C" checkout -q -- . ; git -C "$C" clean -fdq

echo "-- I7: manifests and hook folders are high risk"
for f in package.json pyproject.toml Cargo.toml pom.xml build.gradle .npmrc Gemfile .husky/pre-commit .githooks/pre-push lefthook.yml .pre-commit-config.yaml; do
  check "I7: $f" high "$(risk "$(rf "$f" M 2)")"
done

echo "-- I8: long prompts do not ride on the command line"
JO8=$(FM_ARGV_LIMIT=500 fm judge "$C" j1 2>&1)
check "I8: a long judge prompt goes through a file" 1 "$(ls "$C/.firstmate/notes/" | grep -c '^j1\.judge\.prompt\.md$')"
check "I8: ...and the judge still answers" 1 "$(grep -c 'VERDICT: APPROVE' <<< "$JO8")"
check "I8: a builder prompt over the limit is refused" 2 "$(FM_ARGV_LIMIT=50 fm crew "$C" b1 --role builder --brief x >/dev/null 2>&1; echo $?)"
