#!/usr/bin/env bash
# firstmate: automatic checks for the files a task changed. Called by `fm.sh gate`.
#   fm-checks.sh <workspace> <base-ref> [<captain checkout>]
# Prints one line per check (PASS / FAIL / SKIP) and exits 1 if any check failed.
# SKIP means the tool is missing or the check does not apply; it never fails the gate.
set -uo pipefail
W=$1; BASE=$2; MAIN=${3:-}; cd "$W"
HERE=$(cd "$(dirname "$0")" && pwd)
FAILS=0; RAN=0
pass() { echo "PASS  $1"; RAN=$((RAN + 1)); }
fail() { echo "FAIL  $1"; sed 's/^/      /' <<< "$2" | tail -n 25; FAILS=$((FAILS + 1)); RAN=$((RAN + 1)); }
skip() { echo "SKIP  $1"; }
has() { command -v "$1" >/dev/null 2>&1; }
run() { # run <label> <command...>
  local label=$1; shift; local out
  if out=$("$@" 2>&1); then pass "$label"; else fail "$label" "$out"; fi
}

CHANGED=$(git diff --name-only --diff-filter=ACMR "$BASE" HEAD)
[ -n "$CHANGED" ] || { echo "no changed files"; exit 0; }
echo "changed files:"; sed 's/^/  /' <<< "$CHANGED"

CHARTS=""; HELMFILES=""
while IFS= read -r f; do
  base=$(basename "$f")
  case "$f" in
    *.yaml|*.yml)
      if [[ $f == templates/* || $f == */templates/* ]] || grep -q '{{' "$f"; then skip "yaml $f (go template; checked by helm)"
      elif has ruby; then run "yaml $f" ruby -rpsych -e 'Psych.parse_stream(File.read(ARGV[0], encoding: "UTF-8"))' "$f"
      else skip "yaml $f (ruby not found)"; fi ;;
    *.json) run "json $f" python3 -c 'import json,sys; json.load(open(sys.argv[1], encoding="utf-8"))' "$f" ;;
    *.sh) run "bash -n $f" bash -n "$f" ;;
    *.py) run "python syntax $f" python3 -c 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1])' "$f" ;;
    *.tf)
      if has terraform; then run "terraform fmt $f" terraform fmt -check -diff "$f"
      else skip "terraform fmt $f (terraform not found)"; fi ;;
    *.hcl)
      if has terragrunt; then
        if terragrunt hcl fmt --help >/dev/null 2>&1; then run "terragrunt hcl fmt $f" terragrunt hcl fmt --check --file "$f"
        else run "terragrunt hclfmt $f" terragrunt hclfmt --terragrunt-check --terragrunt-hclfmt-file "$f"; fi
      else skip "hcl fmt $f (terragrunt not found)"; fi ;;
  esac
  [ "$base" = Dockerfile ] || [[ $base == *.Dockerfile ]] && { if has hadolint; then run "hadolint $f" hadolint "$f"; else skip "hadolint $f (not installed)"; fi; }
  # nearest Chart.yaml / helmfile.yaml above the changed file
  d=$(dirname "$f")
  while :; do
    [ -f "$d/Chart.yaml" ] && { grep -qxF "$d" <<< "$CHARTS" || CHARTS="$CHARTS$d"$'\n'; break; }
    [ -f "$d/helmfile.yaml" ] && { grep -qxF "$d" <<< "$HELMFILES" || HELMFILES="$HELMFILES$d"$'\n'; break; }
    [ "$d" = . ] && break; d=$(dirname "$d")
  done
done <<< "$CHANGED"

if [ -n "$CHARTS" ]; then
  while IFS= read -r c; do [ -z "$c" ] && continue
    if has helm; then run "helm lint $c" helm lint "$c"; else skip "helm lint $c (helm not found)"; fi
  done <<< "$CHARTS"
fi

if [ -n "$HELMFILES" ]; then
  while IFS= read -r h; do [ -z "$h" ] && continue
    if ! has helm || ! has ruby; then skip "helm template $h/helmfile.yaml (needs helm and ruby)"; continue; fi
    # one line per release: name<TAB>namespace<TAB>chart<TAB>values... ; SKIP lines for what cannot be rendered locally
    PLAN=$(ruby "$HERE/fm-helmfile.rb" "$h/helmfile.yaml" 2>&1) || { fail "read $h/helmfile.yaml" "$PLAN"; continue; }
    while IFS=$'\t' read -r kind name ns chart rest; do
      [ -z "${kind:-}" ] && continue
      if [ "$kind" = SKIP ]; then skip "helm template $h: $name"; continue; fi
      [[ $chart == /* ]] && cdir=$chart || cdir=$h/$chart
      # charts vendored as git submodules are not checked out in task workspaces: use the captain's copy
      if [ ! -f "$cdir/Chart.yaml" ] && [ -n "$MAIN" ] && [ -f "$MAIN/$cdir/Chart.yaml" ]; then cdir="$MAIN/$cdir"; fi
      if [ ! -f "$cdir/Chart.yaml" ]; then skip "helm template $h: $name (chart $chart not available locally; submodule not checked out?)"; continue; fi
      args=(template "$name" "$cdir"); [ "$ns" != - ] && args+=(-n "$ns")
      IFS=$'\t' read -r -a vals <<< "${rest:-}"
      for v in ${vals[@]+"${vals[@]}"}; do [ -n "$v" ] && args+=(-f "$h/$v"); done
      if out=$(helm "${args[@]}" 2>&1); then pass "helm template $h: $name"
      elif grep -qiE 'missing in charts/ directory|update the dependencies|dependencies.*(missing|not found)' <<< "$out"; then
        skip "helm template $h: $name (chart dependencies not built locally; run helm dependency build to check)"
      else fail "helm template $h: $name" "$out"; fi
    done <<< "$PLAN"
  done <<< "$HELMFILES"
fi

if [ "$RAN" = 0 ]; then echo "no automatic check applies to these files; review the diff"; fi
echo "checks run: $RAN, failed: $FAILS"
[ "$FAILS" = 0 ]
