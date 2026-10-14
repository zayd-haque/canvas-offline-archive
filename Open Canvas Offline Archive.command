#!/bin/bash
# [Codex] Double-click launcher for macOS Finder. Terminal shows setup progress.
cd "$(dirname "$0")" || exit 1
# [Codex] Release downloads keep implementation files out of the launch folder.
# Source checkouts and older installs retain the original layout.
if [ -d "App Files" ]; then
  if [ -L "App Files" ]; then
    echo "App Files must be a real folder, not a symbolic link."
    read -r -p "Press Return to close this window..." _
    exit 1
  fi
  cd "App Files" || exit 1
fi
bash ./bootstrap.sh "$@"
status=$?
if [ "$status" -ne 0 ]; then
  echo
  echo "Canvas Offline Archive could not start. Read the error above or see INSTALL.md inside App Files."
  read -r -p "Press Return to close this window..." _
fi
exit "$status"
