echo "== fm.js workspace"
R="$T/repo"; mkdir -p "$R/hf" "$R/plain/templates" "$R/svc/node_modules/pkg" "$R/docs dir"
(cd "$R" && git init -q -b main
 printf 'node_modules/\n.env\n' > .gitignore; echo "module.exports=1" > svc/node_modules/pkg/index.js; echo "SECRET=abc" > .env
 printf 'defaults: &d\n  image: x\njob:\n  <<: *d\n' > ci.yml
 printf 'apiVersion: v2\nname: plain\nversion: 0.1.0\n' > plain/Chart.yaml
 printf 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: {{ .Release.Name }}\n' > plain/templates/cm.yaml; printf 'a: x\n' > plain/values.yaml
 printf 'releases:\n  - name: novals\n    chart: ../plain\n' > hf/helmfile.yaml
 printf 'one\ntwo\nthree\n' > "docs dir/run book.md"; printf 'a\nb\nc\n' > conflict.txt; printf 'x\n' > gone.txt
 git add -A && git -c user.name=t -c user.email=t@t commit -qm base && git checkout -q -b ft/x)
fm init "$R" >/dev/null
check "init does not commit" 1 "$(git -C "$R" rev-list --count HEAD)"
check "init hides .firstmate" "" "$(git -C "$R" status --porcelain)"
fm start "$R" t1 >/dev/null; W="$R/.firstmate/wt/t1"
check "deps available in the workspace" yes "$([ -f "$W/svc/node_modules/pkg/index.js" ] && grep -q SECRET "$W/.env" && echo yes)"
printf 'job2:\n  <<: *d\n' >> "$W/ci.yml"; sed -i '' 's/a: x/a: y/' "$W/plain/values.yaml" 2>/dev/null || sed -i 's/a: x/a: y/' "$W/plain/values.yaml"; printf 'one\nTWO\nthree\n' > "$W/docs dir/run book.md"
fm save "$R" t1 edits >/dev/null
check "links are never saved" 0 "$(git -C "$W" show --name-only --format= HEAD | grep -cE 'node_modules|\.env')"
check "gate passes (yaml anchors, helm, no-values release)" 0 "$(fm gate "$R" t1 >/dev/null 2>&1; echo $?)"
fm gate "$R" t1 'test -f svc/node_modules/pkg/index.js && grep -q SECRET .env && echo junk > cache.txt' >/dev/null 2>&1
check "gate with deps passes and leaves no junk" "" "$(git -C "$W" status --porcelain)"
fm deliver "$R" t1 >/dev/null 2>&1
check "delivered uncommitted, spaces ok" 3 "$(git -C "$R" status --porcelain | wc -l | tr -d ' ')"
check "delivery logged in notes" 1 "$(grep -c 'delivered task t1 to ft/x, uncommitted:' "$R/.firstmate/notes/log.md")"
check "branches untouched" "ft/x main" "$(git -C "$R" branch --format='%(refname:short)' | sort | tr '\n' ' ' | sed 's/ $//')"
git -C "$R" checkout -q -- .
fm start "$R" c1 >/dev/null; printf 'a\nTASK\nc\n' > "$R/.firstmate/wt/c1/conflict.txt"; fm save "$R" c1 x >/dev/null; fm gate "$R" c1 >/dev/null 2>&1
printf 'a\nCAPTAIN\nc\n' > "$R/conflict.txt"; git -C "$R" -c user.name=t -c user.email=t@t commit -qam captain
fm deliver "$R" c1 >/dev/null 2>&1; check "conflict exits 1" 1 $?
check "conflict keeps the task" 1 "$(fm status "$R" | grep -c 'c1 |')"
git -C "$R" checkout -q -- . ; fm clean "$R" c1 >/dev/null
fm start "$R" f1 >/dev/null; echo y >> "$R/.firstmate/wt/f1/gone.txt"; fm save "$R" f1 x >/dev/null; fm gate "$R" f1 >/dev/null 2>&1
git -C "$R" rm -q gone.txt; git -C "$R" -c user.name=t -c user.email=t@t commit -qm rm
fm deliver "$R" f1 >/dev/null 2>&1; check "unappliable task: error" 2 $?
check "unappliable task: nothing changed" "" "$(git -C "$R" status --porcelain)"
check "unappliable task: kept" 1 "$(fm status "$R" | grep -c 'f1 |')"

if [ "$(uname -s | cut -c1-5)" != MINGW ]; then
  check "old fm.sh entry point still works" 0 "$(bash "$P/scripts/fm.sh" status "$R" >/dev/null 2>&1; echo $?)"
fi
