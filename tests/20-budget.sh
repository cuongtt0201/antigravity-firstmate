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
check "unindexed Claude chat gets first-mate rules" 1 "$(printf '{"conversationId":"newchat3","invocationNum":0,"modelName":"claude-sonnet-5-5-medium"}' | node "$INJECT" invoke 2>/dev/null | grep -c 'firstmate rules')"
check "a first mate the captain runs on Flash is found by name" 1 "$(printf '{"conversationId":"flashfm","invocationNum":0,"modelName":"gemini-3.8-flash-medium"}' | node "$INJECT" invoke 2>/dev/null | grep -c 'firstmate rules')"
mkdir -p "$T/home/.gemini/antigravity-cli/brain/clichat"
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec('create table conversation_summaries(conversation_id text, agent_name text, step_count integer)');d.exec(\"insert into conversation_summaries values('clichat','explorer',50)\")" "$T/home/.gemini/antigravity-cli/conversation_summaries.db" 2>/dev/null
CLI=$(printf '{"conversationId":"clichat","invocationNum":0,"modelName":"gemini-3.8-flash","artifactDirectoryPath":"%s"}' "$T/home/.gemini/antigravity-cli/brain/clichat" | env -u FM_CONVO_DB HOME="$T/home" USERPROFILE="$T/home" node "$INJECT" invoke 2>/dev/null)
check "the index next to the chat's artifact folder is read (CLI chats)" 1 "$(grep -c 'explorer rules' <<< "$CLI")"
check "worker has no budget" allow "$(for i in $(seq 1 8); do guard wk view_file "{\"AbsolutePath\":\"/x/w$i.ts\"}"; done | tail -c 5)"
