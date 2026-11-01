echo "== deliver modes, undo, ledger"
D="$T/dl"; mkdir -p "$D/docs" "$D/src"; (cd "$D" && git init -q -b main && echo a > docs/a.md && echo 'x' > src/a.js && echo k > keep.txt && git add -A && git -c user.name=t -c user.email=t@t commit -qm base && git checkout -q -b feat)
git -C "$D" config user.name t; git -C "$D" config user.email t@t
fm init "$D" >/dev/null
mk() { fm start "$D" "$1" >/dev/null; printf "$3" > "$(fm path "$D" "$1")/$2"; fm save "$D" "$1" x >/dev/null; fm gate "$D" "$1" >/dev/null 2>&1; }
L="$D/.firstmate/notes/ledger.tsv"
fm config "$D" merge apply >/dev/null; mk a1 docs/a.md 'b\n'; fm deliver "$D" a1 >/dev/null 2>&1
check "apply: change is uncommitted" 1 "$(git -C "$D" status --porcelain | wc -l | tr -d ' ')"
check "apply: ledger row" apply "$(tail -1 "$L" 2>/dev/null | cut -f3)"
fm undo "$D" a1 >/dev/null 2>&1
check "undo apply: tree clean again" "" "$(git -C "$D" status --porcelain)"
check "undo is marked in the ledger" yes "$([ -n "$(tail -1 "$L" 2>/dev/null | cut -f9)" ] && echo yes)"
fm config "$D" merge commit >/dev/null; N=$(git -C "$D" rev-list --count HEAD); mk c2 docs/a.md 'c\n'; fm deliver "$D" c2 >/dev/null 2>&1
check "commit: one new commit with the task trailer" "$((N + 1)) 1" "$(git -C "$D" rev-list --count HEAD) $(git -C "$D" log -1 --format=%B | grep -c '^Firstmate-Task: c2$')"
check "commit: tree clean" "" "$(git -C "$D" status --porcelain)"
fm undo "$D" c2 >/dev/null 2>&1
check "undo commit makes a revert commit" 1 "$(git -C "$D" log -1 --format=%s | grep -c '^Revert')"
git -C "$D" checkout -q main; mk p3 docs/a.md 'p\n'; fm deliver "$D" p3 >/dev/null 2>&1
check "protected branch: applied, not committed" apply "$(tail -1 "$L" 2>/dev/null | cut -f3)"
git -C "$D" checkout -q -- . ; git -C "$D" checkout -q feat
fm config "$D" merge propose >/dev/null; mk q4 docs/a.md 'q\n'; fm deliver "$D" q4 >/dev/null 2>&1
check "propose exits 3, tree untouched, task kept" "3  1" "$(fm deliver "$D" q4 >/dev/null 2>&1; echo $?) $(git -C "$D" status --porcelain) $(fm status "$D" | grep -c 'q4 |')"
fm clean "$D" q4 >/dev/null; fm config "$D" merge commit >/dev/null
fm start "$D" h5 >/dev/null; rm "$(fm path "$D" h5)/keep.txt"; fm save "$D" h5 x >/dev/null; fm gate "$D" h5 >/dev/null 2>&1
check "high risk waits for the captain" 3 "$(fm deliver "$D" h5 >/dev/null 2>&1; echo $?)"
check "--approve delivers it" 0 "$(fm deliver "$D" h5 --approve >/dev/null 2>&1; echo $?)"
fm config "$D" merge apply >/dev/null; mk u7 docs/a.md 'u\n'; fm deliver "$D" u7 >/dev/null 2>&1; echo captain >> "$D/docs/a.md"
check "undo refuses after the captain edited the file" 2 "$(fm undo "$D" u7 >/dev/null 2>&1; echo $?)"
check "...and keeps the captain's line" 1 "$(grep -c captain "$D/docs/a.md")"
git -C "$D" checkout -q -- .
if [ -z "$WIN" ]; then
  printf '#!/bin/sh\nexit 1\n' > "$D/.git/hooks/pre-commit"; chmod +x "$D/.git/hooks/pre-commit"
  fm config "$D" merge commit >/dev/null; mk k8 docs/a.md 'k\n'
  check "failing pre-commit hook: reported" 1 "$(fm deliver "$D" k8 2>&1 | grep -c 'commit failed')"
  check "...applied, uncommitted, ledger says apply" "apply 1" "$(tail -1 "$L" 2>/dev/null | cut -f3) $(git -C "$D" status --porcelain | wc -l | tr -d ' ')"
  rm "$D/.git/hooks/pre-commit"; git -C "$D" checkout -q -- .
fi
