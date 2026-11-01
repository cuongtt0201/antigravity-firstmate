echo "== probe plugin"
PL="$T/probe.log"
printf '{"conversationId":"c1","toolCall":{"name":"run_command","args":{"CommandLine":"ls"}}}' | FM_PROBE_LOG="$PL" node "$ROOT/tools/probe/probe.js" PreToolUse > "$T/probe.out" 2>/dev/null
check "probe: logs one line" 1 "$(wc -l < "$PL" 2>/dev/null | tr -d ' ')"
check "probe: answers {} by default" '{}' "$(cat "$T/probe.out")"
check "probe: deny marker" deny "$(printf '{"toolCall":{"name":"run_command","args":{"CommandLine":"echo PROBE_DENY"}}}' | FM_PROBE_LOG="$PL" node "$ROOT/tools/probe/probe.js" PreToolUse 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).decision||"")}catch(e){}})')"
check "probe: pins the model of probe-sub" '"Model":"flash-lite"' "$(printf '{"toolCall":{"name":"invoke_subagent","args":{"TypeName":"probe-sub"}}}' | FM_PROBE_LOG="$PL" FM_PROBE_MODEL=flash-lite node "$ROOT/tools/probe/probe.js" PreToolUse 2>/dev/null | grep -o '"Model":"flash-lite"')"
node "$ROOT/tools/probe/install.js" --target "$T/plugins" >/dev/null 2>&1
check "probe: install fills paths" 0 "$(grep -c '{{' "$T/plugins/fm-probe/hooks.json" 2>/dev/null; true)"
