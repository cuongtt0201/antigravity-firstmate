echo "== fixes from the first real runs through agy (the first mate in the CLI)"
export FM_AGY="$ROOT/tests/fixtures/fake-agy.js"
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec(\"insert into conversation_summaries values('fm91','firstmate',50)\")" "$FM_CONVO_DB" 2>/dev/null
reason() { node -e 'process.stdout.write(JSON.stringify({conversationId:process.argv[1],toolCall:{name:process.argv[2],args:JSON.parse(process.argv[3])}}))' "$1" "$2" "$3" | node "$GUARD" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).reason||""))'; }
R91="$T/cli-run"; mkdir -p "$R91"; (cd "$R91" && git init -q -b main && echo a > a.txt && git add -A && git -c user.name=t -c user.email=t@t commit -qm i)
fm init "$R91" >/dev/null; fm start "$R91" c1 >/dev/null

echo "-- the crew says it started, so a first mate whose command went to the background waits for it"
CR=$(fm crew "$R91" c1 --role builder --brief "WRITE_FILE:c.txt x" 2>&1)
check "crew: the first line says the crew started" 1 "$(head -1 <<< "$CR" | grep -c '^\[fm\] crew started')"
check "crew: the start line names the agy it runs" 1 "$(head -1 <<< "$CR" | grep -cF "$FM_AGY")"
check "crew: the start line says to wait and not cancel" 1 "$(head -1 <<< "$CR" | grep -ci 'do not cancel')"
check "crew: a refused crew call never says it started" 0 "$(fm crew "$R91" nope --role builder --brief x 2>&1 | grep -c 'crew started')"
check "judge: says it started too" 1 "$(fm judge "$R91" c1 2>&1 | head -1 | grep -c '^\[fm\] crew started')"

echo "-- readers and the judge run in the CLI's default mode (auto is not available on every account)"
check "crew: a reader gets no --mode flag" 1 "$(fm crew "$R91" look --role reader --brief x 2>&1 | grep -c 'MODE=default')"
check "crew: a builder still runs in accept-edits" 1 "$(fm crew "$R91" c1 --role builder --brief x 2>&1 | grep -c 'MODE=accept-edits')"

echo "-- the budget's hard stop speaks v1: readers through fm.js crew, no explorers"
for i in $(seq 1 15); do guard fm91 view_file "{\"AbsolutePath\":\"/x/g$i.ts\"}" >/dev/null; done
HS=$(reason fm91 view_file '{"AbsolutePath":"/x/g16.ts"}')
check "budget: the hard stop still denies" 1 "$(grep -c 'hard stop' <<< "$HS")"
check "budget: the hard stop points to readers in fm.js crew" 1 "$(grep -c 'fm.js crew' <<< "$HS")"
check "budget: no hook text sends the first mate to explorers" 0 "$(grep -c 'explorer subagents' "$ROOT/plugin/hooks/guard.js")"

echo "-- task work goes through fm.js crew, not an in-chat builder"
sub() { node -e 'process.stdout.write(JSON.stringify({conversationId:"sub91",toolCall:{name:"invoke_subagent",args:JSON.parse(process.argv[1])}}))' "$1" | node "$GUARD" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.decision+(j.reason&&/fm\.js crew/.test(j.reason)?" crew":""))})'; }
check "guard: an in-chat builder briefed on a task workspace is sent to fm.js crew" "deny crew" "$(sub '{"TypeName":"builder","Prompt":"Edit cli.js in /h/.firstmate/wt/b2-43e80e13/add-json-flag"}')"
check "guard: the same inside a Subagents list" "deny crew" "$(sub '{"Subagents":[{"TypeName":"builder","Prompt":"WORKSPACE: /h/.firstmate/wt/rr-1a2b3c4d/x"}]}')"
check "guard: an in-chat builder for /best drafts is allowed" allow "$(sub '{"TypeName":"builder","Prompt":"Write best/draft_1.md from source.md"}')"
check "guard: an in-chat reader may read a task workspace" allow "$(sub '{"TypeName":"reader","Prompt":"Read /h/.firstmate/wt/rr-1a2b3c4d/x and report"}')"

echo "-- the first mate's prompt"
FMD="$ROOT/plugin/agents/firstmate.md"
check "firstmate.md: says fm.js crew takes minutes and must be waited for" 1 "$(grep -ci 'do not cancel' "$FMD")"
check "firstmate.md: no longer offers in-chat builders for tasks" 0 "$(grep -c 'you may also use in-chat subagents' "$FMD")"
check "firstmate.md: looks at a task's change through fm.js review" 1 "$(grep -c 'change with `fm.js review' "$FMD")"

echo "-- install.js --grant: the permissions the first mate needs, only when the captain asks"
GH="$T/granthome"; mkdir -p "$GH/.gemini/config"
printf '{"plugins":{},"userSettings":{"globalPermissionGrants":{"allow":["read_file(/keep/me)"]}}}\n' > "$GH/.gemini/config/config.json"
gr() { env -u FM_AGY HOME="$GH" USERPROFILE="$GH" node "$ROOT/install.js" "$@" 2>&1; }
gr --grant >/dev/null; gr --grant >/dev/null
GA=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).userSettings.globalPermissionGrants.allow.join("\n"))' "$GH/.gemini/config/config.json")
check "grant: fm.js may run without a prompt" 1 "$(grep -cE '^command\(node .*/plugins/flash-ultra/scripts/fm\.js\)$' <<< "$GA")"
check "grant: the task workspaces may be read" 1 "$(grep -cxF "read_file($FM_WT_ROOT)" <<< "$GA")"
check "grant: existing grants are kept, nothing is added twice" "3" "$(wc -l <<< "$GA" | tr -d ' ')"
check "grant: --check reports the grants" 1 "$(gr --check | grep -c 'crew permissions .*granted')"
gr --uninstall >/dev/null
check "grant: uninstall takes back only its own grants" "read_file(/keep/me)" "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).userSettings.globalPermissionGrants.allow.join(","))' "$GH/.gemini/config/config.json")"
