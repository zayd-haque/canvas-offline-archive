#!/bin/bash
# [Codex] Double-click launcher for macOS Finder. Terminal shows setup progress.
cd "$(dirname "$0")" || exit 1
bash ./bootstrap.sh
status=$?
if [ "$status" -ne 0 ]; then
  echo
  echo "Canvas Offline Archive could not start. Read the error above or see docs/INSTALL.md."
  read -r -p "Press Return to close this window..." _
fi
exit "$status"
