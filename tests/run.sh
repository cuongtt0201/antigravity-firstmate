#!/usr/bin/env bash
# Regression tests for the plugin's code: guard policy, first-mate budget, context hooks, fm.js workspace and review.
#   bash tests/run.sh
# Needs git, node (with node:sqlite) and bash (Git Bash on Windows); helm and terraform are optional. Runs in a temp dir,
# never touches ~/.gemini or the real hook state.
# Each area lives in tests/NN-<area>.sh and is sourced in name order, sharing the helpers in tests/lib.sh.
ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
source "$ROOT_DIR/tests/lib.sh"
for f in "$ROOT_DIR"/tests/[0-9]*.sh; do source "$f"; done
echo
echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" = 0 ]
