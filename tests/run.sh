#!/usr/bin/env bash
# Regression tests for the plugin's code: guard policy, first-mate budget, context hooks, fm.sh workspace.
#   bash tests/run.sh
# Needs git, node (with node:sqlite), ruby; helm and terraform are optional. Runs in a temp dir,
# never touches ~/.gemini or the real hook state.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
P="$ROOT/plugin"; FM="$P/scripts/fm.sh"; GUARD="$P/hooks/guard.js"; INJECT="$P/hooks/inject.js"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export FM_STATE_DIR="$T/state" FM_CONVO_DB="$T/convos.db" FM_BRAIN_DIR="$T/brain" GIT_CONFIG_GLOBAL=/dev/null
PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $*"; }
check() { if [ "$2" = "$3" ]; then ok; else bad "$1 (want '$2', got '$3')"; fi; }

node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec('create table conversation_summaries(conversation_id text, agent_name text)');d.exec(\"insert into conversation_summaries values('fm','firstmate'),('ex','explorer'),('wk','worker'),('plain','')\")" "$FM_CONVO_DB" 2>/dev/null

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
force_ask|kubectl exec -it prod-core-insurance-abc -- sh
allow|kubectl exec -n dev dev-spring-micro-products-abc -- curl localhost
force_ask|kubectl --context gke_globalcare_prod exec api-1 -- ls
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

echo "== guard: subagents pinned to Flash"
OUT=$(node -e 'process.stdout.write(JSON.stringify({conversationId:"pin",toolCall:{name:"invoke_subagent",args:{Subagents:[{TypeName:"explorer",Model:"inherit"},{TypeName:"worker"}]}}}))' | node "$GUARD" 2>/dev/null)
check "explorer+worker pinned" 2 "$(grep -o '"Model":"flash"' <<< "$OUT" | wc -l | tr -d ' ')"

echo "== first-mate budget"
invoke fm 0 1
for i in 1 2 3 4 5 6; do check "read $i within budget" allow "$(guard fm view_file "{\"AbsolutePath\":\"/x/f$i.ts\"}")"; done
check "read 7 over budget" deny "$(guard fm view_file '{"AbsolutePath":"/x/f7.ts"}')"
check "facts.md is free" allow "$(guard fm view_file '{"AbsolutePath":"/r/.firstmate/facts.md"}')"
invoke fm 1 9; invoke fm 2 12
check "later invocations of the same message do not reset" deny "$(guard fm view_file '{"AbsolutePath":"/x/f8.ts"}')"
invoke fm 0 20
check "new message (invocationNum 0) resets" allow "$(guard fm view_file '{"AbsolutePath":"/x/f9.ts"}')"
invoke fm 0 30
check "task workspace source is not free" allow "$(guard fm view_file '{"AbsolutePath":"/r/.firstmate/wt/t1/src/a.ts"}')"
check "...and was counted" 1 "$(used fm)"
invoke fm 0 40
guard fm run_command "$(cmdjson "cd /r && bash $P/scripts/fm.sh init /r && cat a.ts && grep -rn x .")" >/dev/null
check "chained command counts each read segment" 2 "$(used fm)"
invoke fm 0 50
for i in $(seq 1 10); do guard fm view_file "{\"AbsolutePath\":\"/x/p$i.ts\"}" > "$T/par.$i" 2> "$T/par.$i.err" & done; wait
check "parallel reads: every guard answered" 10 "$(grep -lE '^(allow|deny)$' "$T"/par.? "$T"/par.10 | wc -l | tr -d ' ')"
check "parallel reads: exactly 6 allowed" 6 "$(grep -lx allow "$T"/par.? "$T"/par.10 | wc -l | tr -d ' ')"
# per captain message, from the transcript: a subagent report (new execution, same USER_INPUT) does not reset
TR="$FM_BRAIN_DIR/fm/.system_generated/logs"; mkdir -p "$TR"
echo '{"step_index":0,"type":"USER_INPUT","content":"q1"}' > "$TR/transcript.jsonl"
invoke fm 0 60
for i in 1 2 3 4 5 6; do guard fm view_file "{\"AbsolutePath\":\"/x/t$i.ts\"}" >/dev/null; done
echo '{"step_index":5,"type":"SYSTEM_MESSAGE","content":"explorer report"}' >> "$TR/transcript.jsonl"
invoke fm 0 70
check "subagent report does not reset the budget" deny "$(guard fm view_file '{"AbsolutePath":"/x/t7.ts"}')"
echo '{"step_index":9,"type":"USER_INPUT","content":"q2"}' >> "$TR/transcript.jsonl"
invoke fm 3 80
check "new captain message resets the budget" allow "$(guard fm view_file '{"AbsolutePath":"/x/t8.ts"}')"
check "unindexed Argon chat gets first-mate rules" 1 "$(printf '{"conversationId":"newchat","invocationNum":0,"modelName":"gemini-4-argon-medium"}' | node "$INJECT" invoke 2>/dev/null | grep -c 'firstmate rules')"
check "unindexed Flash chat gets nothing" '{}' "$(printf '{"conversationId":"newchat2","invocationNum":0,"modelName":"gemini-3.8-flash"}' | node "$INJECT" invoke 2>/dev/null)"
check "worker has no budget" allow "$(for i in $(seq 1 8); do guard wk view_file "{\"AbsolutePath\":\"/x/w$i.ts\"}"; done | tail -c 5)"

echo "== context hooks"
mkdir -p "$T/my repo" && (cd "$T/my repo" && git init -q -b main && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m i)
bash "$FM" init "$T/my repo" >/dev/null && bash "$FM" fact "$T/my repo" "Uses Fastify 5" >/dev/null
check "fact dedupe" "already" "$(bash "$FM" fact "$T/my repo" "uses fastify 5" | grep -o already)"
SESSION=$(printf '{"conversationId":"fm","workspacePaths":["file://%s"]}' "$(sed 's/ /%20/g' <<< "$T/my repo")" | node "$INJECT" session 2>/dev/null)
check "facts injected for a percent-encoded path" 1 "$(grep -c 'Uses Fastify 5' <<< "$SESSION")"
RULES=$(printf '{"conversationId":"ex","invocationNum":0,"initialNumSteps":1}' | node "$INJECT" invoke 2>/dev/null)
check "explorer gets its rules" 1 "$(grep -c 'explorer rules' <<< "$RULES")"
check "default agent gets nothing" '{}' "$(printf '{"conversationId":"plain","invocationNum":0}' | node "$INJECT" invoke 2>/dev/null)"

echo "== fm.sh workspace"
R="$T/repo"; mkdir -p "$R/hf" "$R/plain/templates" "$R/svc/node_modules/pkg" "$R/docs dir"
(cd "$R" && git init -q -b main
 printf 'node_modules/\n.env\n' > .gitignore; echo "module.exports=1" > svc/node_modules/pkg/index.js; echo "SECRET=abc" > .env
 printf 'defaults: &d\n  image: x\njob:\n  <<: *d\n' > ci.yml
 printf 'apiVersion: v2\nname: plain\nversion: 0.1.0\n' > plain/Chart.yaml
 printf 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: {{ .Release.Name }}\n' > plain/templates/cm.yaml; printf 'a: x\n' > plain/values.yaml
 printf 'releases:\n  - name: novals\n    chart: ../plain\n' > hf/helmfile.yaml
 printf 'one\ntwo\nthree\n' > "docs dir/run book.md"; printf 'a\nb\nc\n' > conflict.txt; printf 'x\n' > gone.txt
 git add -A && git -c user.name=t -c user.email=t@t commit -qm base && git checkout -q -b ft/x)
bash "$FM" init "$R" >/dev/null
check "init does not commit" 1 "$(git -C "$R" rev-list --count HEAD)"
check "init hides .firstmate" "" "$(git -C "$R" status --porcelain)"
bash "$FM" start "$R" t1 >/dev/null; W="$R/.firstmate/wt/t1"
check "deps linked into workspace" yes "$([ -L "$W/svc/node_modules" ] && [ -L "$W/.env" ] && echo yes)"
printf 'job2:\n  <<: *d\n' >> "$W/ci.yml"; sed -i '' 's/a: x/a: y/' "$W/plain/values.yaml" 2>/dev/null || sed -i 's/a: x/a: y/' "$W/plain/values.yaml"; printf 'one\nTWO\nthree\n' > "$W/docs dir/run book.md"
bash "$FM" save "$R" t1 edits >/dev/null
check "links are never saved" 0 "$(git -C "$W" show --name-only --format= HEAD | grep -cE 'node_modules|\.env')"
check "gate passes (yaml anchors, helm, no-values release)" 0 "$(bash "$FM" gate "$R" t1 >/dev/null 2>&1; echo $?)"
bash "$FM" gate "$R" t1 'test -f svc/node_modules/pkg/index.js && grep -q SECRET .env && echo junk > cache.txt' >/dev/null 2>&1
check "gate with deps passes and leaves no junk" "" "$(git -C "$W" status --porcelain)"
bash "$FM" deliver "$R" t1 >/dev/null 2>&1
check "delivered uncommitted, spaces ok" 3 "$(git -C "$R" status --porcelain | wc -l | tr -d ' ')"
check "branches untouched" "ft/x main" "$(git -C "$R" branch --format='%(refname:short)' | sort | tr '\n' ' ' | sed 's/ $//')"
git -C "$R" checkout -q -- .
bash "$FM" start "$R" c1 >/dev/null; printf 'a\nTASK\nc\n' > "$R/.firstmate/wt/c1/conflict.txt"; bash "$FM" save "$R" c1 x >/dev/null; bash "$FM" gate "$R" c1 >/dev/null 2>&1
printf 'a\nCAPTAIN\nc\n' > "$R/conflict.txt"; git -C "$R" -c user.name=t -c user.email=t@t commit -qam captain
bash "$FM" deliver "$R" c1 >/dev/null 2>&1; check "conflict exits 1" 1 $?
check "conflict keeps the task" 1 "$(bash "$FM" status "$R" | grep -c 'c1 |')"
git -C "$R" checkout -q -- . ; bash "$FM" clean "$R" c1 >/dev/null
bash "$FM" start "$R" f1 >/dev/null; echo y >> "$R/.firstmate/wt/f1/gone.txt"; bash "$FM" save "$R" f1 x >/dev/null; bash "$FM" gate "$R" f1 >/dev/null 2>&1
git -C "$R" rm -q gone.txt; git -C "$R" -c user.name=t -c user.email=t@t commit -qm rm
bash "$FM" deliver "$R" f1 >/dev/null 2>&1; check "unappliable task: error" 2 $?
check "unappliable task: nothing changed" "" "$(git -C "$R" status --porcelain)"
check "unappliable task: kept" 1 "$(bash "$FM" status "$R" | grep -c 'f1 |')"

echo
echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" = 0 ]
