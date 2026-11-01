echo "== ladder and arena"
fm start "$C" l1 --request "ladder" >/dev/null; LW=$(fm path "$C" l1)
check "ladder: nothing done yet → build" "NEXT: build" "$(fm ladder "$C" l1 | head -1)"
echo '{' > "$LW/a.json"; fm save "$C" l1 x >/dev/null; fm gate "$C" l1 >/dev/null 2>&1
check "ladder: first FAIL → fix" "NEXT: fix" "$(fm ladder "$C" l1 | head -1)"
fm gate "$C" l1 >/dev/null 2>&1; fm gate "$C" l1 >/dev/null 2>&1
check "ladder: third FAIL → arena 3" "NEXT: arena 3" "$(fm ladder "$C" l1 | head -1)"
echo '{}' > "$LW/a.json"; fm save "$C" l1 y >/dev/null; fm gate "$C" l1 >/dev/null 2>&1
check "ladder: PASS → judge for medium risk" "NEXT: judge" "$(fm ladder "$C" l1 | head -1)"
fm verdict "$C" l1 APPROVE ok >/dev/null
check "ladder: approved → deliver" "NEXT: deliver" "$(fm ladder "$C" l1 | head -1)"
fm arena "$C" ar --n 3 --request "hard edge case" >/dev/null
check "arena: three variants from one base" 3 "$(fm status "$C" | grep -cE '^  ar--[abc] ')"
check "arena: one base for all" 1 "$(for v in a b c; do git -C "$C" rev-parse "refs/firstmate/ar--$v/base"; done | sort -u | wc -l | tr -d ' ')"
echo 'one' > "$(fm path "$C" ar--a)/x.md"; fm save "$C" ar--a x >/dev/null; fm gate "$C" ar--a >/dev/null 2>&1
echo '{' > "$(fm path "$C" ar--b)/x.json"; fm save "$C" ar--b x >/dev/null; fm gate "$C" ar--b >/dev/null 2>&1
AS=$(fm arena-status "$C" ar)
check "arena-status lists gate per variant" "1 1" "$(grep -c 'ar--a .*gate PASS' <<< "$AS") $(grep -c 'ar--b .*gate FAIL' <<< "$AS")"
fm arena-pick "$C" ar a >/dev/null
check "arena-pick keeps one task with the picked change" "1 0 0" "$(fm status "$C" | grep -cE '^  ar ') $(fm status "$C" | grep -cE '^  ar--') $([ -d "$(fm path "$C" ar--b)" ] && echo 1 || echo 0)"
check "arena-pick carries the picked change and request" "one hard edge case" "$(cat "$(fm path "$C" ar)/x.md") $(cat "$C/.firstmate/notes/ar.request")"
fm clean "$C" l1 >/dev/null; fm start "$C" l1 >/dev/null
check "a task started again under an old name starts with a clean record" "NEXT: build" "$(fm ladder "$C" l1 | head -1)"
