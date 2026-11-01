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
fm start "$R" t1 >/dev/null; W=$(fm path "$R" t1)
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
fm start "$R" c1 >/dev/null; printf 'a\nTASK\nc\n' > "$(fm path "$R" c1)/conflict.txt"; fm save "$R" c1 x >/dev/null; fm gate "$R" c1 >/dev/null 2>&1
printf 'a\nCAPTAIN\nc\n' > "$R/conflict.txt"; git -C "$R" -c user.name=t -c user.email=t@t commit -qam captain
fm deliver "$R" c1 >/dev/null 2>&1; check "conflict exits 1" 1 $?
check "conflict keeps the task" 1 "$(fm status "$R" | grep -c 'c1 |')"
git -C "$R" checkout -q -- . ; fm clean "$R" c1 >/dev/null
fm start "$R" f1 >/dev/null; echo y >> "$(fm path "$R" f1)/gone.txt"; fm save "$R" f1 x >/dev/null; fm gate "$R" f1 >/dev/null 2>&1
git -C "$R" rm -q gone.txt; git -C "$R" -c user.name=t -c user.email=t@t commit -qm rm
fm deliver "$R" f1 >/dev/null 2>&1; check "unappliable task: error" 2 $?
check "unappliable task: nothing changed" "" "$(git -C "$R" status --porcelain)"
check "unappliable task: kept" 1 "$(fm status "$R" | grep -c 'f1 |')"

if [ "$(uname -s | cut -c1-5)" != MINGW ]; then
  check "old fm.sh entry point still works" 0 "$(bash "$P/scripts/fm.sh" status "$R" >/dev/null 2>&1; echo $?)"
fi

echo "== workspace v2: outside the repo, slots, lock, sweep, legacy clean-up"
fm clean "$R" --all >/dev/null   # task f1 (kept by the test above) must not hold slot 0
fm start "$R" t2 >/dev/null
check "workspace lives outside the repo" yes "$(case "$(fm path "$R" t2)" in ("$FM_WT_ROOT"/*) echo yes;; (*) echo no;; esac)"
check "no in-repo workspace for new tasks" no "$([ -d "$R/.firstmate/wt/t2" ] && echo yes || echo no)"
fm start "$R" t3 >/dev/null
check "slots are distinct" "0 1" "$(cat "$R/.firstmate/notes/t2.slot" "$R/.firstmate/notes/t3.slot" | tr '\n' ' ' | sed 's/ $//')"
check "gate passes FIRSTMATE_SLOT and PORT" 0 "$(fm gate "$R" t3 'node -e "process.exit(process.env.FIRSTMATE_SLOT===\"1\"&&process.env.PORT===\"3101\"?0:1)"' >/dev/null 2>&1; echo $?)"
mkdir -p "$R/.firstmate/wt" && git -C "$R" worktree add -q --detach "$R/.firstmate/wt/old1" HEAD && git -C "$R" update-ref refs/firstmate/old1/base HEAD && git -C "$R" update-ref refs/firstmate/old1/head HEAD
check "a v0.12 in-repo task still resolves" "$(cd "$R/.firstmate/wt/old1" && pwd -P)" "$(cd "$(fm path "$R" old1)" && pwd -P)"
for i in 1 2 3 4; do fm start "$R" race >/dev/null 2>&1 & done; wait
check "concurrent starts of one task make one workspace" 1 "$(git -C "$R" worktree list | grep -c '[/\\]race ')"
if [ -z "$WIN" ]; then
  mkdir -p "$T/ro"; chmod 555 "$T/ro"
  check "unwritable workspace root: exit 2 naming FM_WT_ROOT" "2 1" "$(FM_WT_ROOT="$T/ro/wt" fm start "$R" nowrite > "$T/nw.out" 2>&1; echo "$? $(grep -c FM_WT_ROOT "$T/nw.out")")"
fi
touch -t 202001010000 "$R/.firstmate/notes/t2.slot"
check "sweep lists an old task (dry run)" 1 "$(fm sweep "$R" | grep -c 't2')"
check "...and keeps it" 1 "$(fm status "$R" | grep -c 't2 |')"
fm sweep "$R" --yes >/dev/null
check "sweep --yes removes only the old task" "0 1" "$(fm status "$R" | grep -c 't2 |') $(fm status "$R" | grep -c 't3 |')"
git -C "$R" branch subagent-merged main
git -C "$R" checkout -q -b subagent-unmerged && git -C "$R" -c user.name=t -c user.email=t@t commit -q --allow-empty -m x && git -C "$R" checkout -q ft/x
check "clean --legacy lists both, deletes nothing" "2 2" "$(fm clean "$R" --legacy | grep -c 'subagent-') $(git -C "$R" branch --list 'subagent-*' | wc -l | tr -d ' ')"
fm clean "$R" --legacy --yes >/dev/null
check "clean --legacy --yes deletes only merged branches" subagent-unmerged "$(git -C "$R" branch --list 'subagent-*' --format='%(refname:short)')"
fm clean "$R" --legacy --yes --force >/dev/null
check "--force deletes unmerged too" "" "$(git -C "$R" branch --list 'subagent-*' --format='%(refname:short)')"
