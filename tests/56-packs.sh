echo "== guard: core pack"
while IFS='|' read -r want c; do c=${c//AKIA_/AKIA}; check "core: $c" "$want" "$(guard plain run_command "$(cmdjson "$c")")"; done <<'CASES'
deny|git push --force origin main
deny|npm publish
deny|pnpm publish --access public
deny|twine upload dist/*
deny|docker push registry.example.com/x:1
force_ask|psql postgres://u@db-prod.internal/app -c "select 1"
allow|psql postgres://u@localhost/app -c "select 1"
deny|AWS_ACCESS_KEY_ID=AKIA_ABCDEFGHIJKLMNOP aws s3 ls
deny|set AWS_ACCESS_KEY_ID=AKIA_ABCDEFGHIJKLMNOP&& aws s3 ls
deny|echo "-----BEGIN OPENSSH PRIVATE KEY-----" > id
allow|aws s3 ls --profile acbins-dev
allow|npm test
CASES
cwdjson() { node -e 'console.log(JSON.stringify({CommandLine:process.argv[1],Cwd:process.argv[2]}))' "$1" "$2"; }
check "reset --hard in the captain's checkout" deny "$(guard plain run_command "$(cwdjson 'git reset --hard' "$R")")"
check "reset --hard inside a task workspace" allow "$(guard plain run_command "$(cwdjson 'git reset --hard' "$(fm path "$R" t3)")")"
check "clean -fdx in the captain's checkout" deny "$(guard plain run_command "$(cwdjson 'git clean -fdx' "$R")")"
check "branch -D in the captain's checkout" deny "$(guard plain run_command "$(cwdjson 'git branch -D x' "$R")")"
check "git status in the captain's checkout" allow "$(guard plain run_command "$(cwdjson 'git status' "$R")")"
FAKE_SECRET_JSON="{\"TargetFile\":\"/r/creds.txt\",\"CodeContent\":\"aws_secret_access_key = $(printf %s%s abcdefghijklmnopqrst uvwxyz0123456789ABCD)\"}"
check "secret written to a repo file" deny "$(guard wk write_to_file "$FAKE_SECRET_JSON")"
check "ordinary file write" allow "$(guard wk write_to_file '{"TargetFile":"/r/notes.txt","CodeContent":"hello"}')"
check "npm install over linked node_modules" deny "$(guard wk run_command "$(cwdjson 'npm install lodash' "$(fm path "$R" t3)/svc")")"
check "npm install in the captain's checkout is not judged here" allow "$(guard plain run_command "$(cwdjson 'npm install lodash' "$R/svc")")"
echo "== guard: packs"
mkdir -p "$FM_HOME"; printf '{"packs":["core"]}' > "$FM_HOME/config.json"
check "core only: kubectl delete is not judged" allow "$(guard plain run_command "$(cmdjson 'kubectl delete pod x')")"
check "core only: git push still denied" deny "$(guard plain run_command "$(cmdjson 'git push')")"
rm "$FM_HOME/config.json"
check "default packs include devops" deny "$(guard plain run_command "$(cmdjson 'kubectl delete pod x')")"
