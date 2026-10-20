#!/usr/bin/env bash
# firstmate: make <project> a git repo with a clean base commit. Run once per project, never to commit a worker's work.
set -euo pipefail
# sandboxed agents may not read ~/.gitconfig; fall back to no global config
{ : < "$HOME/.gitconfig"; } 2>/dev/null || export GIT_CONFIG_GLOBAL=/dev/null
P="${1:?usage: fm-init.sh <project_dir>}"; cd "$P"
# always work on the main checkout, even when called with a worktree path, so merges land on the base branch
P=$(git -C "$P" worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p' || true); P="${P:-$1}"; cd "$P"
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git init -q -b main
  echo "[fm-init] git repo created"
fi
if [ ! -f .gitignore ] || ! grep -q "# firstmate" .gitignore; then
  cat >> .gitignore <<'IGN'
# firstmate: keep data, environments and run outputs out of git
dataset/
data/
public/
working/
kaggle_out/
*.zip
*.npy
*.npz
*.pt
*.pth
*.ckpt
*.parquet
.venv/
venv/
__pycache__/
.DS_Store
IGN
fi
# first-mate notes are private to the main checkout; never commit them (they caused merge conflicts)
grep -qx ".firstmate/" .gitignore || echo ".firstmate/" >> .gitignore
git rm -r -q --cached --ignore-unmatch .firstmate
mkdir -p .firstmate
git add -A
if ! git diff --cached --quiet || ! git rev-parse HEAD >/dev/null 2>&1; then
  git -c user.name=firstmate -c user.email=firstmate@local commit -q -m "firstmate: base snapshot" --allow-empty
fi
echo "[fm-init] base: $(git rev-parse --abbrev-ref HEAD) $(git log -1 --oneline)"
