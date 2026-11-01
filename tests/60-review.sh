echo "== fm.js review"
V="$T/rv"; mkdir -p "$V/src" "$V/chart"
(cd "$V" && git init -q -b main
 printf 'function toCents(a) {
  return Math.round(a * 100);
}
module.exports = { toCents };
' > src/money.js
 printf "const { toCents } = require('./money');
module.exports = (p) => toCents(p);
" > src/invoice.js
 printf 'memory: 512Mi
' > chart/values.yaml; printf 'memory: 512Mi
' > chart/values-prod.yaml
 git add -A && git -c user.name=t -c user.email=t@t commit -qm base)
fm init "$V" >/dev/null; fm start "$V" r1 >/dev/null; VW="$V/.firstmate/wt/r1"
printf 'function toCents(a) {
  return Math.round((a + Number.EPSILON) * 100);
}
module.exports = { toCents };
' > "$VW/src/money.js"
printf 'memory: 1Gi
' > "$VW/chart/values-prod.yaml"
fm save "$V" r1 x >/dev/null
REV=$(fm review "$V" r1 2>&1)
check "review before the gate says so" 1 "$(grep -c 'gate not run' <<< "$REV")"
check "review lists the unchanged caller of a changed function" 1 "$(grep -cF 'src/invoice.js:2  [unchanged]' <<< "$REV")"
check "review lists the environment left unchanged" 1 "$(grep -cx '  chart/values.yaml' <<< "$REV")"
check "review picks the checklists for values and code" 2 "$(grep -cE '^- (Helm values|Code):' <<< "$REV")"
fm gate "$V" r1 >/dev/null 2>&1
check "review shows the gate result" 1 "$(fm review "$V" r1 2>&1 | grep -c 'gate PASS')"
for i in $(seq 1 300); do echo "line $i"; done > "$VW/big.txt"; fm save "$V" r1 big >/dev/null
check "review after a later save calls the gate stale" 1 "$(fm review "$V" r1 2>&1 | grep -c 'gate stale')"
check "review trims a long diff per file" 1 "$(fm review "$V" r1 2>&1 | grep -c 'more lines in big.txt')"
check "review --full does not trim" 0 "$(fm review "$V" r1 --full 2>&1 | grep -c 'more lines in')"
echo x >> "$VW/src/invoice.js"; fm review "$V" r1 >/dev/null 2>&1
check "review refuses unsaved changes" 2 $?
