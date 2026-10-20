#!/usr/bin/env bash
# firstmate: make <project> a git repo with a clean base commit. Safe to re-run.
set -euo pipefail
# sandboxed agents may not read ~/.gitconfig; fall back to no global config
{ : < "$HOME/.gitconfig"; } 2>/dev/null || export GIT_CONFIG_GLOBAL=/dev/null
P="${1:?usage: fm-init.sh <project_dir>}"; cd "$P"
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
mkdir -p .firstmate
git add -A
if ! git diff --cached --quiet || ! git rev-parse HEAD >/dev/null 2>&1; then
  git -c user.name=firstmate -c user.email=firstmate@local commit -q -m "firstmate: base snapshot" --allow-empty
fi
echo "[fm-init] base: $(git rev-parse --abbrev-ref HEAD) $(git log -1 --oneline)"
