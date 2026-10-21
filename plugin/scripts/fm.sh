#!/usr/bin/env bash
# firstmate workspace: the model's own task worktrees, kept out of the captain's branches.
#   fm.sh init    <repo>                     exclude .firstmate/ locally, create facts.md, show state
#   fm.sh fact    <repo> "<fact>"            add one dated line to .firstmate/facts.md (skips duplicates)
#   fm.sh start   <repo> <task>              detached worktree at <repo>/.firstmate/wt/<task>
#   fm.sh save    <repo> <task> "<message>"  commit the task's changes inside the task
#   fm.sh gate    <repo> <task> [command]    run checks (auto-detected, or the given command)
#   fm.sh deliver <repo> <task> [--keep]     apply the task diff to the captain's checkout, uncommitted
#   fm.sh status  <repo>
#   fm.sh clean   <repo> <task|--all>
# Tasks live in refs/firstmate/<task>/{base,head}, never in refs/heads, so `git branch` and pushes never see them.
set -euo pipefail
# sandboxed agents may not read ~/.gitconfig; fall back to no global config
{ : < "$HOME/.gitconfig"; } 2>/dev/null || export GIT_CONFIG_GLOBAL=/dev/null
HERE=$(cd "$(dirname "$0")" && pwd)
ID=(-c user.name=firstmate -c user.email=firstmate@local)
PROTECTED_RE='^(main|master|prod|production|prod-.*|release/.*)$'

die() { echo "[fm] ERROR: $*" >&2; exit 2; }
[ $# -ge 2 ] || die "usage: fm.sh <init|fact|start|save|gate|deliver|status|clean> <repo> [args]"
CMD=$1; REPO_ARG=$2; shift 2

# main checkout of the repo containing $1 (works when given a task workspace path too)
main_checkout() {
  git -C "$1" rev-parse --show-toplevel >/dev/null 2>&1 || return 1
  git -C "$1" worktree list --porcelain | sed -n '1s/^worktree //p'
}

task_name() {
  [[ ${1:-} =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || die "task name must be lowercase letters, digits and dashes: '${1:-}'"
  echo "$1"
}

need_repo() { R=$(main_checkout "$REPO_ARG") || die "'$REPO_ARG' is not a git repo; run: fm.sh init <repo>"; }

case "$CMD" in
init)
  NEW=0
  if ! git -C "$REPO_ARG" rev-parse --git-dir >/dev/null 2>&1; then
    git -C "$REPO_ARG" init -q -b main; NEW=1
  fi
  need_repo; cd "$R"
  EX="$(git rev-parse --git-common-dir)/info/exclude"; mkdir -p "$(dirname "$EX")"; touch "$EX"
  grep -qxF ".firstmate/" "$EX" || printf '\n# firstmate workspace (this machine only)\n.firstmate/\n' >> "$EX"
  mkdir -p .firstmate/wt .firstmate/notes
  if [ ! -f .firstmate/facts.md ]; then
    cat > .firstmate/facts.md <<'FACTS'
# Facts about this repo (kept by the first mate; local only, never committed)
# One line per fact, newest last: "- <fact> (source or date)". Correct wrong lines instead of adding contradictions.
FACTS
  fi
  if [ "$NEW" = 1 ]; then
    printf '.venv/\nvenv/\n__pycache__/\nnode_modules/\n.DS_Store\n' >> "$EX"
    git add -A
    git "${ID[@]}" commit -q --allow-empty -m "initial commit"
    echo "[fm] new repo created with an initial commit"
  fi
  git rev-parse -q --verify HEAD >/dev/null || die "the repo has no commits yet; commit once, then run init again"
  BR=$(git rev-parse --abbrev-ref HEAD)
  echo "[fm] repo: $R"
  echo "[fm] branch: $BR | last commit: $(git log -1 --format='%h %s')"
  [[ $BR =~ $PROTECTED_RE ]] && echo "[fm] note: you are on '$BR'. Delivered changes stay uncommitted; commit them on the branch you choose."
  echo "[fm] uncommitted files in your checkout: $(git status --porcelain | wc -l | tr -d ' ')"
  echo "[fm] facts: $R/.firstmate/facts.md ($(grep -c '^- ' .firstmate/facts.md || true) facts)"
  ;;

fact)
  need_repo; F="$R/.firstmate/facts.md"
  [ -f "$F" ] || die "run: fm.sh init $R"
  ONE=$(printf '%s' "${1:-}" | tr '\n' ' ' | sed 's/  */ /g; s/^ //; s/ $//')
  [ -n "$ONE" ] || die "usage: fm.sh fact <repo> \"<fact>\""
  if grep -qiF -- "- $ONE (" "$F"; then echo "[fm] already known: $ONE"
  else echo "- $ONE ($(date +%F))" >> "$F"; echo "[fm] fact recorded ($(grep -c '^- ' "$F") facts in $F)"; fi
  ;;

start)
  need_repo; T=$(task_name "${1:-}")
  W="$R/.firstmate/wt/$T"
  [ -e "$W" ] && die "task '$T' already exists at $W (use another name, or: fm.sh clean $R $T)"
  [ -d "$R/.firstmate" ] || die "run: fm.sh init $R"
  BASE=$(git -C "$R" rev-parse HEAD)
  git -C "$R" worktree add -q --detach "$W" "$BASE"
  git -C "$R" update-ref "refs/firstmate/$T/base" "$BASE"
  git -C "$R" update-ref "refs/firstmate/$T/head" "$BASE"
  # git-ignored dependencies and env files are not in a fresh worktree; link them from the captain's
  # checkout so builds and tests run, and exclude the links (by exact path) so a save never commits them
  EX="$(git -C "$R" rev-parse --git-common-dir)/info/exclude"; LINKED=0
  while IFS= read -r p; do
    p=${p%/}; [ -n "$p" ] || continue
    case "$(basename "$p")" in node_modules|.venv|venv|vendor|.env|.env.local|.env.test|.env.development|.env.development.local|.env.test.local) ;; *) continue ;; esac
    case "$p" in .firstmate|.firstmate/*) continue ;; esac
    [ -e "$W/$p" ] && continue
    mkdir -p "$(dirname "$W/$p")"; ln -s "$R/$p" "$W/$p"; LINKED=$((LINKED + 1))
    grep -qxF "/$p" "$EX" || echo "/$p" >> "$EX"
  done < <(git -C "$R" ls-files --others --ignored --exclude-standard --directory 2>/dev/null)
  echo "[fm] task $T: workspace $W (from $(git -C "$R" log -1 --format='%h %s' "$BASE"))"
  [ "$LINKED" = 0 ] || echo "[fm] linked $LINKED git-ignored dependency/env path(s) from your checkout (node_modules, .venv, .env...)"
  [ -n "$(git -C "$R" status --porcelain)" ] && echo "[fm] note: the captain's uncommitted changes are NOT in this workspace"
  true
  ;;

save)
  need_repo; T=$(task_name "${1:-}"); MSG=${2:-"firstmate: $T"}
  W="$R/.firstmate/wt/$T"; [ -d "$W" ] || die "no workspace for task '$T'"
  git -C "$W" add -A
  if git -C "$W" diff --cached --quiet; then echo "[fm] no new changes to save"
  else git -C "$W" "${ID[@]}" commit -q -m "$MSG"; fi
  git -C "$R" update-ref "refs/firstmate/$T/head" "$(git -C "$W" rev-parse HEAD)"
  echo "[fm] task $T saved: $(git -C "$R" diff --shortstat "refs/firstmate/$T/base" "refs/firstmate/$T/head")"
  git -C "$R" diff --stat=100 "refs/firstmate/$T/base" "refs/firstmate/$T/head" | sed '$d' | head -n 30
  ;;

gate)
  need_repo; T=$(task_name "${1:-}"); shift || true
  W="$R/.firstmate/wt/$T"; [ -d "$W" ] || die "no workspace for task '$T'"
  [ -z "$(git -C "$W" status --porcelain)" ] || die "task '$T' has unsaved changes; run: fm.sh save $R $T \"<message>\""
  HEADC=$(git -C "$W" rev-parse HEAD)
  [ "$HEADC" = "$(git -C "$R" rev-parse "refs/firstmate/$T/head")" ] || git -C "$R" update-ref "refs/firstmate/$T/head" "$HEADC"
  NOTE="$R/.firstmate/notes/$T.gate"
  if [ $# -gt 0 ]; then
    echo "[fm] gate $T: running given check in $W: $*"
    if (cd "$W" && bash -c "$*") > "$NOTE.log" 2>&1; then V=PASS; else V=FAIL; fi
    tail -n 40 "$NOTE.log"
  else
    if bash "$HERE/fm-checks.sh" "$W" "refs/firstmate/$T/base" "$R" > "$NOTE.log" 2>&1; then V=PASS; else V=FAIL; fi
    cat "$NOTE.log"
  fi
  LEFT=$(git -C "$W" status --porcelain)
  if [ -n "$LEFT" ]; then
    echo "[fm] the check left files in the workspace; removed so they are not delivered:"; sed 's/^/  /' <<< "$LEFT" | head -n 20
    git -C "$W" checkout -q -- . ; git -C "$W" clean -fdq
  fi
  echo "$HEADC $V" > "$NOTE"
  echo "[fm] gate $T: $V"
  [ "$V" = PASS ]
  ;;

deliver)
  need_repo; T=$(task_name "${1:-}"); KEEP=${2:-}
  B="refs/firstmate/$T/base"; H="refs/firstmate/$T/head"
  git -C "$R" rev-parse -q --verify "$H" >/dev/null || die "no task '$T'"
  W="$R/.firstmate/wt/$T"
  [ ! -d "$W" ] || [ -z "$(git -C "$W" status --porcelain)" ] || die "task '$T' has unsaved changes; save and gate first"
  NOTE="$R/.firstmate/notes/$T.gate"
  read -r GSHA GV < "$NOTE" 2>/dev/null || die "task '$T' has no gate result; run: fm.sh gate $R $T"
  [ "$GSHA" = "$(git -C "$R" rev-parse "$H")" ] || die "task '$T' changed after its gate; run the gate again"
  [ "$GV" = PASS ] || die "task '$T' gate is $GV; fix it first"
  FILES=()
  while IFS= read -r f; do [ -n "$f" ] && FILES+=("$f"); done < <(git -C "$R" diff --name-only "$B" "$H")
  [ "${#FILES[@]}" -gt 0 ] || die "task '$T' has no changes to deliver"
  cd "$R"
  BUSY=""; for f in "${FILES[@]}"; do [ -n "$(git status --porcelain -- "$f")" ] && BUSY="$BUSY '$f'"; done
  [ -z "$BUSY" ] || die "you have uncommitted edits in:$BUSY. Commit or stash them, then deliver again."
  PATCH=$(mktemp); trap 'rm -f "$PATCH"' EXIT
  git diff --binary "$B" "$H" > "$PATCH"
  CLEAN=1
  if git apply --check "$PATCH" 2>/dev/null; then
    git apply "$PATCH"
  else
    echo "[fm] your branch moved since the task started; applying with a 3-way merge"
    RC=0; git apply --3way "$PATCH" || RC=$?
    for f in "${FILES[@]}"; do git reset -q -- "$f" 2>/dev/null || true; done
    CONFLICT=""; for f in "${FILES[@]}"; do [ -f "$f" ] && grep -q '^<<<<<<< ' "$f" && CONFLICT="$CONFLICT '$f'"; done
    if [ -n "$CONFLICT" ]; then
      CLEAN=0; echo "[fm] CONFLICT markers left in:$CONFLICT. Resolve them by hand; the task is kept (fm.sh clean $R $T when done)."
    elif [ "$RC" != 0 ]; then
      die "the task could not be applied to your branch (git apply --3way exit $RC); nothing was changed and the task is kept"
    fi
  fi
  [ "$CLEAN" = 1 ] && STATE="UNCOMMITTED changes" || STATE="UNCOMMITTED changes WITH CONFLICTS"
  echo "[fm] delivered task $T to $R as $STATE on branch $(git rev-parse --abbrev-ref HEAD):"
  git diff --stat=100 -- "${FILES[@]}" | tail -n 30
  echo "[fm] review: git diff | then commit and push yourself"
  if [ "$KEEP" != "--keep" ] && [ "$CLEAN" = 1 ]; then
    [ -d "$W" ] && git worktree remove --force "$W"
    git update-ref -d "$B"; git update-ref -d "$H"; rm -f "$NOTE" "$NOTE.log"
    echo "[fm] task $T removed"
  fi
  [ "$CLEAN" = 1 ]
  ;;

status)
  need_repo; cd "$R"
  echo "[fm] repo: $R | branch: $(git rev-parse --abbrev-ref HEAD) | your uncommitted files: $(git status --porcelain | wc -l | tr -d ' ')"
  TASKS=$(git for-each-ref --format='%(refname)' refs/firstmate/ | sed -n 's#^refs/firstmate/\(.*\)/head$#\1#p')
  [ -n "$TASKS" ] || { echo "[fm] no tasks"; exit 0; }
  for T in $TASKS; do
    W=".firstmate/wt/$T"; NOTE=".firstmate/notes/$T.gate"
    G="-"; [ -f "$NOTE" ] && read -r _ G < "$NOTE"
    D="missing"; [ -d "$W" ] && { [ -z "$(git -C "$W" status --porcelain)" ] && D=saved || D=unsaved; }
    echo "  $T | workspace: $D | gate: $G | $(git diff --shortstat "refs/firstmate/$T/base" "refs/firstmate/$T/head" | sed 's/^ //')"
  done
  ;;

clean)
  need_repo; cd "$R"
  if [ "${1:-}" = "--all" ]; then
    TASKS=$(git for-each-ref --format='%(refname)' refs/firstmate/ | sed -n 's#^refs/firstmate/\([^/]*\)/.*#\1#p' | sort -u)
  else TASKS=$(task_name "${1:-}"); fi
  for T in $TASKS; do
    [ -d ".firstmate/wt/$T" ] && git worktree remove --force ".firstmate/wt/$T"
    for r in base head; do git update-ref -d "refs/firstmate/$T/$r" 2>/dev/null || true; done
    rm -f ".firstmate/notes/$T.gate" ".firstmate/notes/$T.gate.log"
    echo "[fm] removed task $T"
  done
  git worktree prune
  ;;

*) die "unknown command '$CMD'" ;;
esac
