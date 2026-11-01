# Shared setup and helpers for the test files; sourced by tests/run.sh.
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WIN=; [ "$(uname -s | cut -c1-5)" = MINGW ] && WIN=1 && ROOT=$(cygpath -m "$ROOT")
P="$ROOT/plugin"; FMJS="$P/scripts/fm.js"; GUARD="$P/hooks/guard.js"; INJECT="$P/hooks/inject.js"
T=$(mktemp -d); [ -n "$WIN" ] && T=$(cygpath -m "$T"); trap 'rm -rf "$T"' EXIT
# git must not find a repo above the temp dir (for example a home folder that is itself a repo)
export GIT_CEILING_DIRECTORIES=$(dirname "$T")
export FM_STATE_DIR="$T/state" FM_CONVO_DB="$T/convos.db" FM_BRAIN_DIR="$T/brain" GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
fm() { node "$FMJS" "$@"; }
PASS=0; FAIL=0
ok()  { PASS=$((PASS + 1)); }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $*"; [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error title=test::$(printf %s "$*" | tr -d '\r' | head -c 300)"; return 0; }
check() { if [ "$2" = "$3" ]; then ok; else bad "$1 (want '$2', got '$3')"; fi; }

node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec('create table conversation_summaries(conversation_id text, agent_name text, step_count integer)');d.exec(\"insert into conversation_summaries values('fm','firstmate',50),('ex','explorer',50),('wk','worker',50),('plain','',50),('young','',2),('flashfm','firstmate',50)\")" "$FM_CONVO_DB" 2>/dev/null

# guard <convo> <tool> <args-json>  → prints the decision
guard() { node -e 'process.stdout.write(JSON.stringify({conversationId:process.argv[1],toolCall:{name:process.argv[2],args:JSON.parse(process.argv[3])}}))' "$1" "$2" "$3" | node "$GUARD" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).decision))'; }
cmdjson() { node -e 'console.log(JSON.stringify({CommandLine:process.argv[1]}))' "$1"; }
invoke() { printf '{"conversationId":"%s","invocationNum":%s,"initialNumSteps":%s}' "$1" "$2" "$3" | node "$INJECT" invoke >/dev/null 2>&1; }
used() { [ -f "$FM_STATE_DIR/$1.direct" ] && echo $(( $(wc -c < "$FM_STATE_DIR/$1.direct") / 2 )) || echo 0; }
export FM_HOME="$T/fmhome"
