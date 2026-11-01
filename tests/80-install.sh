echo "== installer --check"
IC=$(env -u FM_AGY HOME="$T/home" USERPROFILE="$T/home" node "$ROOT/install.js" --check 2>&1)
check "check: reports the Antigravity CLI the crew needs" 1 "$(grep -c 'agy (Antigravity CLI)' <<< "$IC")"
check "check: reports where task workspaces go" 1 "$(grep -c 'task workspaces' <<< "$IC")"
check "check: package version is 1.0" 1 "$(grep -c 'this package: v1\.0\.' <<< "$IC")"
