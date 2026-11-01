echo "== gate v2: project checks, locked acceptance tests"
J="$T/js"; mkdir -p "$J"; (cd "$J" && git init -q -b main && printf '{"name":"j","scripts":{"test":"node test.js","lint":"node lint.js"}}' > package.json && echo 'process.exit(0)' > test.js && echo 'process.exit(0)' > lint.js && git add -A && git -c user.name=t -c user.email=t@t commit -qm i)
fm init "$J" >/dev/null
check "detect: npm test and lint" 2 "$(fm detect "$J" 2>/dev/null | grep -cE '^(test: npm test --silent|lint: npm run lint --silent)$')"
fm detect "$J" --write >/dev/null 2>&1
check "detect --write stores the checks" "npm test --silent" "$(fm config "$J" checks.test)"
dt() { node -e 'try{process.stdout.write(require(process.argv[1]).detectChecks(process.argv[2])[process.argv[3]]||"")}catch(e){}' "$P/scripts/fm-detect.js" "$1" "$2"; }
G="$T/go"; mkdir -p "$G"; printf 'module x\n' > "$G/go.mod"
check "detect: go" "go test ./..." "$(dt "$G" test)"
N2="$T/npmdefault"; mkdir -p "$N2"; printf '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' > "$N2/package.json"
check "detect: npm's default test script is ignored" "" "$(dt "$N2" test)"
P2="$T/pnpmrepo"; mkdir -p "$P2"; printf '{"scripts":{"test":"vitest run"}}' > "$P2/package.json"; : > "$P2/pnpm-lock.yaml"
check "detect: pnpm lockfile picks pnpm" "pnpm test --silent" "$(dt "$P2" test)"
TS="$T/tsrepo"; mkdir -p "$TS"; printf '{"devDependencies":{"typescript":"5"}}' > "$TS/package.json"; echo '{}' > "$TS/tsconfig.json"
check "detect: tsconfig with typescript gives a typecheck" "npx --no-install tsc --noEmit" "$(dt "$TS" typecheck)"
fm start "$J" g1 >/dev/null; JW=$(fm path "$J" g1); echo 'process.exit(1)' > "$JW/test.js"; fm save "$J" g1 x >/dev/null
check "gate runs the project's test" 1 "$(fm gate "$J" g1 2>&1 | grep -c '^FAIL  check test: npm test --silent')"
fm start "$J" g2 >/dev/null; JW2=$(fm path "$J" g2); fm lock "$J" g2 test.js >/dev/null 2>&1
check "guard: worker may not write a locked test" deny "$(guard wk write_to_file "{\"TargetFile\":\"$JW2/test.js\"}")"
check "guard: worker may write other files" allow "$(guard wk write_to_file "{\"TargetFile\":\"$JW2/lint.js\"}")"
echo '// weakened' >> "$JW2/test.js"; fm save "$J" g2 x >/dev/null
check "gate fails when a locked test changed" 1 "$(fm gate "$J" g2 2>&1 | grep -c 'locked test.js changed after lock')"
