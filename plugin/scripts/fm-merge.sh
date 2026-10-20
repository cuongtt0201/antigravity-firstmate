#!/usr/bin/env bash
# firstmate: merge worker <branch> into the base branch of <project>. Aborts cleanly on conflict.
set -euo pipefail
# sandboxed agents may not read ~/.gitconfig; fall back to no global config
{ : < "$HOME/.gitconfig"; } 2>/dev/null || export GIT_CONFIG_GLOBAL=/dev/null
P="${1:?usage: fm-merge.sh <project_dir> <branch>}"; B="${2:?branch required}"; cd "$P"
# always work on the main checkout, even when called with a worktree path, so merges land on the base branch
P=$(git -C "$P" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p' || true); P="${P:-$1}"; cd "$P"
git rev-parse --verify -q "refs/heads/$B" >/dev/null || { echo "[fm-merge] ERROR: branch '$B' not found"; git branch --list | head -20; exit 2; }
BASE=$(git rev-parse --abbrev-ref HEAD)
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then echo "[fm-merge] ERROR: base '$BASE' has uncommitted tracked changes; commit or stash them first"; git status --short | head; exit 3; fi
AHEAD=$(git rev-list --count "$BASE..$B")
[ "$AHEAD" -eq 0 ] && { echo "[fm-merge] nothing to merge: '$B' has no commits beyond '$BASE'"; exit 0; }
if git -c user.name=firstmate -c user.email=firstmate@local merge --no-ff -q -m "firstmate: merge $B" "$B"; then
  echo "[fm-merge] OK merged $B ($AHEAD commit(s)) into $BASE -> $(git log -1 --oneline)"
  git diff --stat HEAD~1 HEAD | tail -1
  git worktree prune
else
  echo "[fm-merge] CONFLICT merging $B into $BASE. Conflicted files:"; git diff --name-only --diff-filter=U
  git merge --abort; echo "[fm-merge] merge aborted; base unchanged"; exit 1
fi
