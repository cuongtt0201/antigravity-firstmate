#!/usr/bin/env bash
# Kept for chats that still call the old shell script; the workspace script is fm.js (Node, every OS).
exec node "$(dirname "$0")/fm.js" "$@"
