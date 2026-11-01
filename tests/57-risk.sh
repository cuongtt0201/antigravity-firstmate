echo "== risk"
risk() { node -e 'const {classify}=require(process.argv[1]);process.stdout.write(classify(JSON.parse(process.argv[2])).level)' "$P/scripts/fm-risk.js" "$1" 2>/dev/null; }
rf() { printf '{"files":[{"path":"%s","status":"%s"}],"changedLines":%s}' "$1" "$2" "$3"; }
check "risk: docs only" low "$(risk "$(rf docs/a.md M 3)")"
check "risk: test only" low "$(risk "$(rf src/a.test.ts M 10)")"
check "risk: small code change" medium "$(risk "$(rf src/a.ts M 10)")"
check "risk: migration" high "$(risk "$(rf db/migrations/001_init.sql A 5)")"
check "risk: deleted file" high "$(risk "$(rf src/old.ts D 5)")"
check "risk: CI" high "$(risk "$(rf .github/workflows/ci.yml M 2)")"
check "risk: auth path" high "$(risk "$(rf src/auth/login.ts M 2)")"
check "risk: lockfile" high "$(risk "$(rf package-lock.json M 2)")"
check "risk: big diff" high "$(risk "$(rf src/a.ts M 401)")"
check "risk: Windows path" high "$(risk "$(rf 'src\\\\auth\\\\login.ts' M 2)")"
check "risk: six doc files" medium "$(risk '{"files":[{"path":"a.md","status":"M"},{"path":"b.md","status":"M"},{"path":"c.md","status":"M"},{"path":"d.md","status":"M"},{"path":"e.md","status":"M"},{"path":"f.md","status":"M"}],"changedLines":12}')"
fm start "$R" rk1 >/dev/null; RW=$(fm path "$R" rk1); rm -f "$RW/conflict.txt"; fm save "$R" rk1 x >/dev/null
check "fm risk on a task that deletes a file" "RISK: high" "$(fm risk "$R" rk1 | head -1)"
check "risk is recorded" high "$(cat "$R/.firstmate/notes/rk1.risk" 2>/dev/null)"
