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
SESSION=$(printf '{"conversationId":"fm","workspacePaths":["file://%s%s"]}' "${WIN:+/}" "$(sed 's/ /%20/g' <<< "$T/my repo")" | node "$INJECT" session 2>/dev/null)
check "facts injected for a percent-encoded path" 1 "$(grep -c 'Uses Fastify 5' <<< "$SESSION")"
RULES=$(printf '{"conversationId":"ex","invocationNum":0,"initialNumSteps":1}' | node "$INJECT" invoke 2>/dev/null)
check "explorer gets the reader rules" 1 "$(grep -c 'reader rules' <<< "$RULES")"
check "a crew process gets no facts" '{}' "$(printf '{"conversationId":"fm","workspacePaths":["file:///x"]}' | FM_ROLE=builder node "$INJECT" session 2>/dev/null)"
check "a crew process gets no injected rules" '{}' "$(printf '{"conversationId":"wk","invocationNum":0}' | FM_ROLE=builder node "$INJECT" invoke 2>/dev/null)"
check "default agent gets nothing" '{}' "$(printf '{"conversationId":"plain","invocationNum":0}' | node "$INJECT" invoke 2>/dev/null)"
mkdir -p "$T/no repo"
SESSION=$(printf '{"conversationId":"fm","workspacePaths":["file://%s%s"]}' "${WIN:+/}" "$(sed 's/ /%20/g' <<< "$T/no repo")" | node "$INJECT" session 2>/dev/null)
check "a folder that is not a repo is reported as having no facts" 1 "$(grep -c 'not a git repo' <<< "$SESSION")"
RULES=$(printf '{"conversationId":"fm","invocationNum":0,"initialNumSteps":1}' | node "$INJECT" invoke 2>/dev/null)
check "first mate may pass skills: none" 1 "$(grep -c 'skills: none' <<< "$RULES")"
check "first mate is not told to pass its own playbooks as skills" 0 "$(grep -c 'written deliverables → best' "$P/agents/firstmate.md")"
