#!/usr/bin/env bash
# firstmate: show branches, worktrees and recent commits of <project>.
set -euo pipefail
# sandboxed agents may not read ~/.gitconfig; fall back to no global config
{ : < "$HOME/.gitconfig"; } 2>/dev/null || export GIT_CONFIG_GLOBAL=/dev/null
P="${1:?usage: fm-status.sh <project_dir>}"; cd "$P"
echo "== base: $(git rev-parse --abbrev-ref HEAD)"
echo "== branches (newest first)"; git for-each-ref --sort=-committerdate --format='%(refname:short)  %(committerdate:relative)  %(subject)' refs/heads | head -20
echo "== worktrees"; git worktree list
echo "== recent commits on base"; git log --oneline -8
echo "== uncommitted on base"; git status --short | head -20
