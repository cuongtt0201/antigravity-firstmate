#!/usr/bin/env bash
# Regression tests for the plugin's code: guard policy, first-mate budget, context hooks, fm.js workspace.
#   bash tests/run.sh
# Needs git, node (with node:sqlite), ruby; helm and terraform are optional. Runs in a temp dir,
# never touches ~/.gemini or the real hook state.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
P="$ROOT/plugin"; FMJS="$P/scripts/fm.js"; GUARD="$P/hooks/guard.js"; INJECT="$P/hooks/inject.js"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export FM_STATE_DIR="$T/state" FM_CONVO_DB="$T/convos.db" FM_BRAIN_DIR="$T/brain" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
fm() { node "$FMJS" "$@"; }
PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $*"; [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error title=test::$(printf %s "$*" | tr -d '\r' | head -c 300)"; return 0; }
check() { if [ "$2" = "$3" ]; then ok; else bad "$1 (want '$2', got '$3')"; fi; }

node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec('create table conversation_summaries(conversation_id text, agent_name text, step_count integer)');d.exec(\"insert into conversation_summaries values('fm','firstmate',50),('ex','explorer',50),('wk','worker',50),('plain','',50),('young','',2)\")" "$FM_CONVO_DB" 2>/dev/null

# guard <convo> <tool> <args-json>  → prints the decision
guard() { node -e 'process.stdout.write(JSON.stringify({conversationId:process.argv[1],toolCall:{name:process.argv[2],args:JSON.parse(process.argv[3])}}))' "$1" "$2" "$3" | node "$GUARD" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).decision))'; }
cmdjson() { node -e 'console.log(JSON.stringify({CommandLine:process.argv[1]}))' "$1"; }
invoke() { printf '{"conversationId":"%s","invocationNum":%s,"initialNumSteps":%s}' "$1" "$2" "$3" | node "$INJECT" invoke >/dev/null 2>&1; }
used() { [ -f "$FM_STATE_DIR/$1.direct" ] && echo $(( $(wc -c < "$FM_STATE_DIR/$1.direct") / 2 )) || echo 0; }

echo "== guard: live-system policy"
while IFS='|' read -r want c; do check "policy: $c" "$want" "$(guard plain run_command "$(cmdjson "$c")")"; done <<'CASES'
allow|kubectl get pods -n prod-backend-core-service
allow|kubectl -n prod logs prod-core-insurance-x --tail=200
allow|kubectl describe pod x | grep -i delete
deny|kubectl delete pod x -n dev
deny|kubectl -n prod rollout restart deploy/core
allow|kubectl rollout status deploy/core -n prod
deny|kubectl exec -it prod-core-insurance-abc -- sh
deny|kubectl exec -n dev dev-spring-micro-products-abc -- curl localhost
deny|kubectl --context gke_globalcare_prod exec api-1 -- ls
deny|kubectl port-forward svc/x 8080:80
deny|kubectl -n dev cp a pod:/tmp/a
deny|kubectl config use-context prod
allow|kubectl config view --minify
allow|kubectl top pods -n dev
allow|kubectl get events -n dev --sort-by=.lastTimestamp
allow|kubectl auth can-i list pods
allow|kubectl --help
deny|kubectl scale deploy x --replicas=0
deny|kubectl --context gke_prod apply -f x.yaml
allow|helm template x ./chart -f v.yaml
deny|helm upgrade --install x ./chart
allow|helmfile -f h.yaml diff
deny|helmfile -f h.yaml apply
allow|terraform plan
deny|terragrunt apply
allow|terraform state list
deny|terraform state rm aws_x.y
allow|git log --oneline -5
deny|git -C /repo push origin ft/x
deny|cd /repo && git status && git push
allow|gcloud compute instances list
allow|gcloud config set project x
deny|gcloud compute instances delete vm1
allow|gcloud storage cp gs://b/f.txt ./
deny|gcloud storage cp ./f.txt gs://b/
deny|gsutil rm gs://b/x
deny|gsutil rsync -r ./d gs://b/d
force_ask|ssh root@10.0.0.1 uptime
deny|bash -c "kubectl delete ns test"
deny|FOO=1 sudo kubectl drain node-1
allow|bash /Users/me/.gemini/config/plugins/flash-ultra/scripts/fm.sh gate /r t1
allow|node "/Users/me/.gemini/config/plugins/flash-ultra/scripts/fm.js" gate /r t1
allow|node "C:/Users/A B/.gemini/config/plugins/flash-ultra/scripts/fm.js" status C:/r
deny|node "/Users/me/.gemini/config/plugins/flash-ultra/scripts/fm.js" init /r && chmod -R u+w /Users/me/.gemini/config/plugins/flash-ultra
deny|bash /Users/me/.gemini/config/plugins/flash-ultra/scripts/fm.sh init /r && chmod -R u+w /Users/me/.gemini/config/plugins/flash-ultra
CASES

echo "== guard: explorers are read-only"
while IFS='|' read -r want c; do check "explorer: $c" "$want" "$(guard ex run_command "$(cmdjson "$c")")"; done <<'CASES'
deny|sed -i 's/a/b/' app.ts
deny|echo x > app.ts
deny|git checkout -- .
deny|rm -rf node_modules
deny|npm install
allow|grep -rn upload app 2>/dev/null
allow|git log --oneline -5 > /dev/null
allow|kubectl logs pod-x 2>&1 | tail -50
CASES
check "explorer write tool" deny "$(guard ex write_to_file '{"TargetFile":"/x/a.ts"}')"
check "worker may write" allow "$(guard wk write_to_file '{"TargetFile":"/x/a.ts"}')"

echo "== guard: MCP tools (read verbs pass; the rest asks the captain; explorers are denied)"
mcp() { guard "$1" call_mcp_tool "{\"ServerName\":\"$2\",\"ToolName\":\"$3\",\"Arguments\":{},\"toolAction\":\"Delete the export\",\"toolSummary\":\"Delete export\"}"; }
for t in list_buckets get_bucket_metadata read_text read_object search_documents answer_query execute_sql_readonly execute_sql_read_only get_query_results lookup_entry describe_instance listBuckets getObjectMetadata; do
  check "mcp read: $t" allow "$(mcp plain some-server "$t")"
done
for t in download_object set_read_only delete_readonly_replica delete_object delete_bucket write_text execute_sql restore_backup update_database_schema commit send_message merge_pull_request push_files add_issue_comment deleteObject delete-object run_query create_session; do
  check "mcp change asks: $t" force_ask "$(mcp plain some-server "$t")"
  check "mcp change denied for explorer: $t" deny "$(mcp ex some-server "$t")"
done
check "mcp unknown verb asks" force_ask "$(mcp plain some-server frobnicate)"
check "structure viewer is exempt" allow "$(mcp plain science_biomolecular_structure_viewer_mcp remove_annotation)"
check "native mcp read tool" allow "$(guard plain mcp_gemini-api_gemini-api-docs_gemini_search_docs '{"query":"x"}')"
check "native mcp delete tool asks" force_ask "$(guard plain mcp_data-agent-kit-plugin_dak-bigtable_delete_table '{}')"
check "other arg key names" force_ask "$(guard plain call_mcp_tool '{"server_name":"dak-gcs","tool_name":"delete_object"}')"
check "mcp calls are logged with keys" 1 "$(grep -c "call_mcp_tool list_buckets keys=ServerName,ToolName,Arguments,toolAction,toolSummary" "$FM_STATE_DIR/mcp.log")"
check "toolSummary text is not taken as the tool name" allow "$(guard plain call_mcp_tool '{"toolSummary":"Delete old files","ServerName":"x","ToolName":"list_objects"}')"

echo "== agent manifests: every tool name is one the App accepts"
KNOWN="view_file list_dir grep_search find_by_name run_command write_to_file replace_file_content multi_replace_file_content invoke_subagent manage_subagents send_message ask_question manage_task search_web read_url_content"
for f in "$P"/agents/*.md; do
  for t in $(node -e 'const y=require(process.argv[1]);const t=require("fs").readFileSync(process.argv[2],"utf8").split(/^---\s*$/m)[1];console.log((y.load(t).tools||[]).join(" "))' "$P/scripts/vendor/js-yaml.js" "$f" | tr -d '\r'); do
    case " $KNOWN " in *" $t "*) ok ;; *) bad "unknown tool '$t' in $(basename "$f")" ;; esac
  done
done

echo "== guard: subagents pinned to Flash"
OUT=$(node -e 'process.stdout.write(JSON.stringify({conversationId:"pin",toolCall:{name:"invoke_subagent",args:{Subagents:[{TypeName:"explorer",Model:"inherit"},{TypeName:"worker"}]}}}))' | node "$GUARD" 2>/dev/null)
check "explorer+worker pinned" 2 "$(grep -o '"Model":"flash"' <<< "$OUT" | wc -l | tr -d ' ')"
two() { node -e 'process.stdout.write(JSON.stringify({conversationId:"two",toolCall:{name:"invoke_subagent",args:{Subagents:[{TypeName:"worker",Prompt:"Task workspace: /r/.firstmate/wt/"+process.argv[1]+"/x"},{TypeName:"worker",Prompt:"write only in /r/.firstmate/wt/"+process.argv[2]+"/y"},{TypeName:"explorer",Prompt:"read /r/.firstmate/wt/"+process.argv[1]}]}}}))' "$1" "$2" | node "$GUARD" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).decision))'; }
check "two workers in one task workspace are refused" deny "$(two infra infra)"
check "one worker per task workspace is fine" allow "$(two infra-tf infra-docs)"

echo "== first-mate budget"
spend() { for i in $(seq 1 "$2"); do guard fm view_file "{\"AbsolutePath\":\"/x/$1$i.ts\"}" >/dev/null; done; }
invoke fm 0 1
spend a 14
check "read 15 still allowed (6 is a reminder, 15 the hard stop)" allow "$(guard fm view_file '{"AbsolutePath":"/x/f15.ts"}')"
check "read 16 over the hard stop" deny "$(guard fm view_file '{"AbsolutePath":"/x/f16.ts"}')"
check "facts.md is free" allow "$(guard fm view_file '{"AbsolutePath":"/r/.firstmate/facts.md"}')"
RULES=$(printf '{"conversationId":"fm","invocationNum":1,"initialNumSteps":9}' | node "$INJECT" invoke 2>/dev/null)
check "over 6, the rules tell the first mate to delegate" 1 "$(grep -c 'send further reading to explorers' <<< "$RULES")"
invoke fm 2 12
check "later invocations of the same message do not reset" deny "$(guard fm view_file '{"AbsolutePath":"/x/f17.ts"}')"
invoke fm 0 20
check "new message (invocationNum 0) resets" allow "$(guard fm view_file '{"AbsolutePath":"/x/f18.ts"}')"
invoke fm 0 30
check "task workspace source is not free" allow "$(guard fm view_file '{"AbsolutePath":"/r/.firstmate/wt/t1/src/a.ts"}')"
check "...and was counted" 1 "$(used fm)"
invoke fm 0 40
guard fm run_command "$(cmdjson "cd /r && node \"$FMJS\" init /r && cat a.ts && grep -rn x .")" >/dev/null
check "a command costs 1 however it is chained" 1 "$(used fm)"
guard fm run_command "$(cmdjson "curl -s https://x/a | python3 -c \"import sys, json; d=json.load(sys.stdin); print('a | b')\" && curl -s https://x/b | python3 -c \"import json; print(1)\"")" >/dev/null
check "quotes, semicolons and pipes do not multiply the cost" 2 "$(used fm)"
guard fm run_command "$(cmdjson "node \"$FMJS\" status /r")" >/dev/null
check "a plugin-script-only command is free" 2 "$(used fm)"
guard fm run_command "$(cmdjson "node \"$FMJS\" status /r && cat /r/secret.ts")" >/dev/null
check "chaining a read after the plugin script is not free" 3 "$(used fm)"
invoke fm 0 50
for i in $(seq 1 20); do guard fm view_file "{\"AbsolutePath\":\"/x/p$i.ts\"}" > "$T/par.$i" 2> "$T/par.$i.err" & done; wait
check "parallel reads: every guard answered" 20 "$(cat "$T"/par.[0-9]* | grep -oE 'allow|deny' | wc -l | tr -d ' ')"
ALLOWED=$(cat "$T"/par.[0-9]* | grep -o allow | wc -l | tr -d ' ')
check "parallel reads: never more than 15 allowed (races may deny a few early)" yes "$([ "$ALLOWED" -le 15 ] && [ "$ALLOWED" -ge 6 ] && echo yes || echo "no ($ALLOWED)")"
# per captain message, from the transcript: a subagent report (new execution, same USER_INPUT) does not reset
TR="$FM_BRAIN_DIR/fm/.system_generated/logs"; mkdir -p "$TR"
echo '{"step_index":0,"type":"USER_INPUT","content":"q1"}' > "$TR/transcript.jsonl"
invoke fm 0 60
spend t 15
echo '{"step_index":5,"type":"SYSTEM_MESSAGE","content":"explorer report"}' >> "$TR/transcript.jsonl"
invoke fm 0 70
check "subagent report does not reset the budget" deny "$(guard fm view_file '{"AbsolutePath":"/x/t16.ts"}')"
echo '{"step_index":9,"type":"USER_INPUT","content":"q2"}' >> "$TR/transcript.jsonl"
invoke fm 3 80
check "new captain message resets the budget" allow "$(guard fm view_file '{"AbsolutePath":"/x/t17.ts"}')"
check "unindexed Argon chat gets first-mate rules" 1 "$(printf '{"conversationId":"newchat","invocationNum":0,"modelName":"gemini-4-argon-medium"}' | node "$INJECT" invoke 2>/dev/null | grep -c 'firstmate rules')"
check "young chat without agent name, on Argon, gets first-mate rules" 1 "$(printf '{"conversationId":"young","invocationNum":0,"modelName":"gemini-4-argon-medium"}' | node "$INJECT" invoke 2>/dev/null | grep -c 'firstmate rules')"
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec(\"update conversation_summaries set agent_name='firstmate', step_count=9 where conversation_id='young'\")" "$FM_CONVO_DB" 2>/dev/null
check "...and is recognised once the App names it" 1 "$(printf '{"conversationId":"young","invocationNum":1,"modelName":"gemini-4-argon-medium"}' | node "$INJECT" invoke 2>/dev/null | grep -c 'firstmate rules')"
check "older default-agent chat on Argon gets nothing" '{}' "$(printf '{"conversationId":"plain","invocationNum":0,"modelName":"gemini-4-argon-medium"}' | node "$INJECT" invoke 2>/dev/null)"
check "unindexed Flash chat gets nothing" '{}' "$(printf '{"conversationId":"newchat2","invocationNum":0,"modelName":"gemini-3.8-flash"}' | node "$INJECT" invoke 2>/dev/null)"
check "worker has no budget" allow "$(for i in $(seq 1 8); do guard wk view_file "{\"AbsolutePath\":\"/x/w$i.ts\"}"; done | tail -c 5)"

echo "== context hooks"
mkdir -p "$T/my repo" && (cd "$T/my repo" && git init -q -b main && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m i)
mkdir -p "$T/plain folder"; fm init "$T/plain folder" >/dev/null 2>&1
check "init refuses a folder that is not a repo" 2 $?
check "...and creates nothing" no "$([ -d "$T/plain folder/.git" ] && echo yes || echo no)"
fm init "$T/plain folder" --new-repo >/dev/null 2>&1
check "init --new-repo creates the repo" yes "$([ -d "$T/plain folder/.git" ] && echo yes || echo no)"
fm init "$T/my repo" >/dev/null && fm fact "$T/my repo" "Uses Fastify 5" >/dev/null
check "fact dedupe" "already" "$(fm fact "$T/my repo" "uses fastify 5" | grep -o already)"
fm fact "$T/my repo" "Uses Prisma" "uses fastify 5" "Deploys with PM2" >/dev/null
check "several facts in one call, duplicates skipped" 3 "$(grep -c '^- ' "$T/my repo/.firstmate/facts.md")"
SESSION=$(printf '{"conversationId":"fm","workspacePaths":["file://%s"]}' "$(sed 's/ /%20/g' <<< "$T/my repo")" | node "$INJECT" session 2>/dev/null)
check "facts injected for a percent-encoded path" 1 "$(grep -c 'Uses Fastify 5' <<< "$SESSION")"
RULES=$(printf '{"conversationId":"ex","invocationNum":0,"initialNumSteps":1}' | node "$INJECT" invoke 2>/dev/null)
check "explorer gets its rules" 1 "$(grep -c 'explorer rules' <<< "$RULES")"
check "default agent gets nothing" '{}' "$(printf '{"conversationId":"plain","invocationNum":0}' | node "$INJECT" invoke 2>/dev/null)"
mkdir -p "$T/no repo"
SESSION=$(printf '{"conversationId":"fm","workspacePaths":["file://%s"]}' "$(sed 's/ /%20/g' <<< "$T/no repo")" | node "$INJECT" session 2>/dev/null)
check "a folder that is not a repo is reported as having no facts" 1 "$(grep -c 'not a git repo' <<< "$SESSION")"
RULES=$(printf '{"conversationId":"fm","invocationNum":0,"initialNumSteps":1}' | node "$INJECT" invoke 2>/dev/null)
check "first mate may pass skills: none" 1 "$(grep -c 'skills: none' <<< "$RULES")"
check "first mate is not told to pass its own playbooks as skills" 0 "$(grep -c 'written deliverables → best' "$P/agents/firstmate.md")"

echo "== fm.js shape"
B="$T/task one/best"; mkdir -p "$B"
printf 'Brief\n```\ndeliverable: final.md words=20 covers=R1-R2 drafts=draft_*.md\n- deliverable: talk.md words=1.000 covers=R3\n```\n' > "$B/brief.md"
printf '# Kế hoạch\n| --- | --- |\nmột hai ba bốn năm sáu bảy tám chín mười\n## Phần 2\n**Đơn** vị - 2.500 từ\n' > "$B/draft_1.md"
seq 1 30 | tr '\n' ' ' > "$B/draft_2.md"
SHAPE=$(fm shape "$B/brief.md" --sections); RC=$?
check "shape: a draft over the limit exits 1" 1 "$RC"
check "shape: markdown symbols are not words, Vietnamese syllables are" 1 "$(grep -c 'OK     draft_1.md: 18 / 20 words' <<< "$SHAPE")"
check "shape: over by more than 10%" 1 "$(grep -c 'OVER   draft_2.md: 30 / 20' <<< "$SHAPE")"
check "shape: unwritten deliverables are listed" 2 "$(grep -c 'not written yet' <<< "$SHAPE")"
check "shape: limits with a thousands separator" 1 "$(grep -c 'talk.md' <<< "$SHAPE")"
check "shape: words per section" 1 "$(grep -cE '^ +6  ## Phần 2$' <<< "$SHAPE")"
check "shape: one file only" "  OVER   draft_2.md: 30 / 20 words (+50%)" "$(fm shape "$B/brief.md" draft_2.md | grep draft)"
check "shape: one file only, the others are not counted" 0 "$(fm shape "$B/brief.md" --sections draft_1.md >/dev/null; echo $?)"
printf -- '- `deliverable: best/final.md words=20 covers=R1-R2 drafts=best/draft_*.md`\n**deliverable:** **talk.md** words=10\n' > "$B/brief2.md"
SHAPE=$(fm shape "$B/brief2.md")
check "shape: best/ prefixes, backticks and bold are understood" 3 "$(grep -cE 'draft_1.md: 18|draft_2.md: 30|talk.md: not written' <<< "$SHAPE")"
rm "$B/draft_2.md"
fm shape "$B/brief.md" >/dev/null; check "shape: all within limits exits 0" 0 $?
rm "$B/draft_1.md"; check "shape: missing drafts are named" 1 "$(fm shape "$B/brief.md" | grep -c 'draft_\*.md: no drafts yet')"
printf 'no lines\n' > "$B/empty.md"; fm shape "$B/empty.md" >/dev/null 2>&1; check "shape: a brief without deliverable lines is an error" 2 $?

echo "== fm.js workspace"
R="$T/repo"; mkdir -p "$R/hf" "$R/plain/templates" "$R/svc/node_modules/pkg" "$R/docs dir"
(cd "$R" && git init -q -b main
 printf 'node_modules/\n.env\n' > .gitignore; echo "module.exports=1" > svc/node_modules/pkg/index.js; echo "SECRET=abc" > .env
 printf 'defaults: &d\n  image: x\njob:\n  <<: *d\n' > ci.yml
 printf 'apiVersion: v2\nname: plain\nversion: 0.1.0\n' > plain/Chart.yaml
 printf 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: {{ .Release.Name }}\n' > plain/templates/cm.yaml; printf 'a: x\n' > plain/values.yaml
 printf 'releases:\n  - name: novals\n    chart: ../plain\n' > hf/helmfile.yaml
 printf 'one\ntwo\nthree\n' > "docs dir/run book.md"; printf 'a\nb\nc\n' > conflict.txt; printf 'x\n' > gone.txt
 git add -A && git -c user.name=t -c user.email=t@t commit -qm base && git checkout -q -b ft/x)
fm init "$R" >/dev/null
check "init does not commit" 1 "$(git -C "$R" rev-list --count HEAD)"
check "init hides .firstmate" "" "$(git -C "$R" status --porcelain)"
fm start "$R" t1 >/dev/null; W="$R/.firstmate/wt/t1"
check "deps available in the workspace" yes "$([ -f "$W/svc/node_modules/pkg/index.js" ] && grep -q SECRET "$W/.env" && echo yes)"
printf 'job2:\n  <<: *d\n' >> "$W/ci.yml"; sed -i '' 's/a: x/a: y/' "$W/plain/values.yaml" 2>/dev/null || sed -i 's/a: x/a: y/' "$W/plain/values.yaml"; printf 'one\nTWO\nthree\n' > "$W/docs dir/run book.md"
fm save "$R" t1 edits >/dev/null
check "links are never saved" 0 "$(git -C "$W" show --name-only --format= HEAD | grep -cE 'node_modules|\.env')"
check "gate passes (yaml anchors, helm, no-values release)" 0 "$(fm gate "$R" t1 >/dev/null 2>&1; echo $?)"
fm gate "$R" t1 'test -f svc/node_modules/pkg/index.js && grep -q SECRET .env && echo junk > cache.txt' >/dev/null 2>&1
check "gate with deps passes and leaves no junk" "" "$(git -C "$W" status --porcelain)"
fm deliver "$R" t1 >/dev/null 2>&1
check "delivered uncommitted, spaces ok" 3 "$(git -C "$R" status --porcelain | wc -l | tr -d ' ')"
check "delivery logged in notes" 1 "$(grep -c 'delivered task t1 to ft/x, uncommitted:' "$R/.firstmate/notes/log.md")"
check "branches untouched" "ft/x main" "$(git -C "$R" branch --format='%(refname:short)' | sort | tr '\n' ' ' | sed 's/ $//')"
git -C "$R" checkout -q -- .
fm start "$R" c1 >/dev/null; printf 'a\nTASK\nc\n' > "$R/.firstmate/wt/c1/conflict.txt"; fm save "$R" c1 x >/dev/null; fm gate "$R" c1 >/dev/null 2>&1
printf 'a\nCAPTAIN\nc\n' > "$R/conflict.txt"; git -C "$R" -c user.name=t -c user.email=t@t commit -qam captain
fm deliver "$R" c1 >/dev/null 2>&1; check "conflict exits 1" 1 $?
check "conflict keeps the task" 1 "$(fm status "$R" | grep -c 'c1 |')"
git -C "$R" checkout -q -- . ; fm clean "$R" c1 >/dev/null
fm start "$R" f1 >/dev/null; echo y >> "$R/.firstmate/wt/f1/gone.txt"; fm save "$R" f1 x >/dev/null; fm gate "$R" f1 >/dev/null 2>&1
git -C "$R" rm -q gone.txt; git -C "$R" -c user.name=t -c user.email=t@t commit -qm rm
fm deliver "$R" f1 >/dev/null 2>&1; check "unappliable task: error" 2 $?
check "unappliable task: nothing changed" "" "$(git -C "$R" status --porcelain)"
check "unappliable task: kept" 1 "$(fm status "$R" | grep -c 'f1 |')"

if [ "$(uname -s | cut -c1-5)" != MINGW ]; then
  check "old fm.sh entry point still works" 0 "$(bash "$P/scripts/fm.sh" status "$R" >/dev/null 2>&1; echo $?)"
fi
echo
echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" = 0 ]
