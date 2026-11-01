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
twonew() { node -e 'const p=(t)=>"Task workspace: "+process.argv[1]+"/.firstmate/wt/myrepo-1a2b3c4d/"+t+"/src";process.stdout.write(JSON.stringify({conversationId:"two2",toolCall:{name:"invoke_subagent",args:{Subagents:[{TypeName:"worker",Prompt:p(process.argv[2])},{TypeName:"worker",Prompt:p(process.argv[3])}]}}}))' "$1" "$2" "$3" | node "$GUARD" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).decision))'; }
check "two workers in one new-style workspace are refused" deny "$(twonew /home/u infra infra)"
check "different new-style workspaces are fine" allow "$(twonew /home/u infra-tf infra-docs)"
check "Windows-style workspace paths are compared" deny "$(twonew 'C:\Users\u' infra INFRA)"

echo "== guard: the crew cannot forge gate results"
check "worker may run fm.js save and gate" allow "$(guard wk run_command "$(cmdjson "cd /r/.firstmate/wt/t && node \"$FMJS\" save /r t x && node \"$FMJS\" gate /r t 'npm test'")")"
check "worker may write in its task workspace" allow "$(guard wk write_to_file '{"TargetFile":"/r/.firstmate/wt/t/src/a.js"}')"
check "worker may not write a gate result" deny "$(guard wk write_to_file '{"TargetFile":"/r/.firstmate/notes/t.gate"}')"
check "worker may not redirect into notes" deny "$(guard wk run_command "$(cmdjson "echo abc PASS > /r/.firstmate/notes/t.gate")")"
check "worker may not move task refs" deny "$(guard wk run_command "$(cmdjson "git -C /r update-ref refs/firstmate/t/head abc")")"
check "worker may not edit facts.md" deny "$(guard wk replace_file_content '{"TargetFile":"/r/.firstmate/facts.md"}')"
check "worker may read notes" allow "$(guard wk view_file '{"AbsolutePath":"/r/.firstmate/notes/t.gate.log"}')"
