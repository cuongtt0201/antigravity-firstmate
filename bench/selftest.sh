#!/usr/bin/env bash
# Checks that the benchmark is sound: every hidden test FAILS on the untouched fixture and PASSES once the
# reference solution is applied. Prints "bench selftest: <ok>/<total>" and exits 1 if anything is off.
set -uo pipefail
B=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
ok=0; total=0
run_hidden() { (cd "$1" && node .hidden/hidden.test.js >/dev/null 2>&1); }
for d in "$B"/hidden/B*; do
  n=$(basename "$d"); W="$T/$n"
  cp -R "$B/fixture" "$W"; mkdir -p "$W/.hidden"; cp "$d"/hidden.test.js "$W/.hidden/"
  total=$((total + 2))
  if run_hidden "$W"; then echo "FAIL: $n hidden test passes on the untouched fixture"; else ok=$((ok + 1)); fi
  if [ -f "$B/solutions/$n.patch" ] && (cd "$W" && git init -q && git apply "$B/solutions/$n.patch") && run_hidden "$W"; then ok=$((ok + 1)); else echo "FAIL: $n reference solution does not pass its hidden test"; fi
done
echo "bench selftest: $ok/$total"
[ "$ok" = "$total" ]
