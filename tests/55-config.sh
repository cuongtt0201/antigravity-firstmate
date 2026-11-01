echo "== config"
check "config default merge" apply "$(fm config "$R" merge)"
fm config "$R" checks.test "npm test" >/dev/null
check "config set nested" "npm test" "$(fm config "$R" checks.test)"
mkdir -p "$FM_HOME"; printf '{"packs":["core"],"portBase":4000}' > "$FM_HOME/config.json"
check "global config is read" core "$(fm config "$R" packs)"
check "global portBase reaches the gate" 0 "$(fm gate "$R" t3 'node -e "process.exit(process.env.PORT===\"4001\"?0:1)"' >/dev/null 2>&1; echo $?)"
fm config "$R" packs '["core","devops"]' >/dev/null
check "repo config overrides global" core,devops "$(fm config "$R" packs)"
check "config file stays out of git" "" "$(git -C "$R" status --porcelain --ignored=no .firstmate)"
check "crew may not edit config.json" deny "$(guard wk write_to_file '{"TargetFile":"/r/.firstmate/config.json"}')"
check "whole config prints as JSON" 3100 "$(rm "$FM_HOME/config.json"; fm config "$R" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(String(JSON.parse(s).portBase)))')"
