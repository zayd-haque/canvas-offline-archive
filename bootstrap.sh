#!/usr/bin/env bash
# ==============================================================================
# Canvas Course Offline Ecosystem - 1-Click Bootstrap & Launch Script
# Creates an isolated Python virtual environment (.venv), installs dependencies,
# sets up Playwright browser automation, and launches the offline web app.
# ==============================================================================

set -euo pipefail

# Determine script directory (repository root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="${SCRIPT_DIR}/.venv"
VENV_PYTHON="${VENV_DIR}/bin/python"
VENV_PIP="${VENV_DIR}/bin/pip"
CONFIG_EXAMPLE="${SCRIPT_DIR}/Canvas Module Downloader/config.example.json"
CONFIG_TARGET="${SCRIPT_DIR}/Canvas Module Downloader/config.json"

# Text styles & colors
BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BOLD}${BLUE}============================================================${NC}"
echo -e "${BOLD}${BLUE}  CANVAS COURSE OFFLINE ARCHIVE - BOOTSTRAPPER${NC}"
echo -e "${BOLD}${BLUE}  100% Offline Local LMS Replica & Desktop File Explorer${NC}"
echo -e "${BOLD}${BLUE}============================================================${NC}"

# Parse optional arguments
SETUP_ONLY=false
FORCE_REINSTALL=false

for arg in "$@"; do
    case "$arg" in
        --setup-only)
            SETUP_ONLY=true
            ;;
        --reinstall)
            FORCE_REINSTALL=true
            ;;
        --help|-h)
            echo "Usage: ./bootstrap.sh [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --setup-only    Set up virtualenv and dependencies without starting server"
            echo "  --reinstall     Force recreation of .venv and reinstall dependencies"
            echo "  --help, -h      Show this help message"
            exit 0
            ;;
    esac
done

# Refuse links before reinstall, dependency setup, or config initialization.
# In particular, rm -rf and Python's venv setup must never operate on a
# redirected .venv path.
if [ -L "$VENV_DIR" ]; then
    echo "Error: .venv is a symbolic link; remove it manually before setup." >&2
    exit 1
fi
if [ -L "$(dirname "$CONFIG_TARGET")" ] || [ -L "$CONFIG_TARGET" ]; then
    echo "Error: the configuration path contains a symbolic link; refusing setup." >&2
    exit 1
fi

# Step 1: Detect the validated Python version
echo -e "\n${BOLD}[1/4] Checking Python environment...${NC}"

PYTHON_BIN=""
if command -v python3.14 &>/dev/null; then
    PYTHON_BIN="$(command -v python3.14)"
fi

if [ -z "$PYTHON_BIN" ]; then
    echo -e "${RED}Error: Python 3.14 is required for this release.${NC}"
    echo "Install Python 3.14, then run ./bootstrap.sh again. See docs/INSTALL.md."
    exit 1
fi

PY_VERSION="$("$PYTHON_BIN" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")')"
echo -e "${GREEN}✓ Found Python ${PY_VERSION} (${PYTHON_BIN})${NC}"

# [Codex] Recover interrupted source updates before reading or installing the lock.
"$PYTHON_BIN" "${SCRIPT_DIR}/release_updater.py" --platform macos --recover-only

# Step 2: Set up isolated virtual environment (.venv)
echo -e "\n${BOLD}[2/4] Setting up isolated virtual environment (.venv)...${NC}"

if [ "$FORCE_REINSTALL" = true ] && [ -d "$VENV_DIR" ]; then
    echo -e "${YELLOW}Notice: Removing existing .venv for fresh reinstallation...${NC}"
    rm -rf "$VENV_DIR"
fi

if [ ! -f "$VENV_PYTHON" ]; then
    echo -e "Creating isolated virtual environment at: ${VENV_DIR}"
    "$PYTHON_BIN" -m venv "$VENV_DIR"
    echo -e "${GREEN}✓ Virtual environment created successfully (isolated from system Python).${NC}"

else
    echo -e "${GREEN}✓ Existing isolated virtual environment detected at: ${VENV_DIR}${NC}"
    if ! "$VENV_PYTHON" -c 'import sys; raise SystemExit(sys.version_info[:2] != (3, 14))'; then
        echo "Existing .venv uses a different Python version. Run ./bootstrap.sh --reinstall."
        exit 1
    fi
fi

# [Codex] Marker publication replaces links instead of truncating their targets.
write_dependency_marker() {
    "$PYTHON_BIN" - "${VENV_DIR}/.deps_installed" "$1" <<'PY_MARKER'
import os
import pathlib
import sys
import tempfile
marker = pathlib.Path(sys.argv[1])
fd, temporary = tempfile.mkstemp(prefix=".deps-", dir=marker.parent)
try:
    with os.fdopen(fd, "w") as output:
        output.write(sys.argv[2])
    os.replace(temporary, marker)
finally:
    pathlib.Path(temporary).unlink(missing_ok=True)
PY_MARKER
}

# Step 3: Install dependencies
echo -e "\n${BOLD}[3/4] Verifying and installing dependencies...${NC}"

NEEDS_INSTALL=false
LOCK_DIGEST="$("$PYTHON_BIN" - "${SCRIPT_DIR}/requirements.txt" <<'PY'
import hashlib
import pathlib
import sys
print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())
PY
)"
if [ ! -f "${VENV_DIR}/.deps_installed" ] || [ "$(cat "${VENV_DIR}/.deps_installed")" != "$LOCK_DIGEST" ]; then
    NEEDS_INSTALL=true
else
    # Quick sanity check on core imports
    if ! "$VENV_PYTHON" -c 'import fastapi, uvicorn, pypdf, requests, playwright' &>/dev/null; then
        NEEDS_INSTALL=true
    fi
fi

if [ "$NEEDS_INSTALL" = true ] || [ "$FORCE_REINSTALL" = true ]; then
    echo -e "Installing dependencies into .venv..."
    if [ -f "${SCRIPT_DIR}/requirements.txt" ]; then
        "$VENV_PYTHON" -m pip install --require-hashes -r "${SCRIPT_DIR}/requirements.txt"
    else
        echo "Error: requirements.txt is missing from this package."
        exit 1
    fi
    write_dependency_marker "$LOCK_DIGEST"
    echo -e "${GREEN}✓ Python dependencies installed successfully.${NC}"
else
    echo -e "${GREEN}✓ All dependencies already satisfied.${NC}"
fi

# The updater uses the pinned CA bundle in .venv, so check after setup.
if [ "$FORCE_REINSTALL" = false ]; then
    "$VENV_PYTHON" "${SCRIPT_DIR}/release_updater.py" --platform macos
    UPDATED_LOCK_DIGEST="$("$VENV_PYTHON" - "${SCRIPT_DIR}/requirements.txt" <<'PY'
import hashlib
import pathlib
import sys
print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())
PY
)"
    if [ "$UPDATED_LOCK_DIGEST" != "$LOCK_DIGEST" ]; then
        "$VENV_PYTHON" -m pip install --require-hashes -r "${SCRIPT_DIR}/requirements.txt"
        write_dependency_marker "$UPDATED_LOCK_DIGEST"
    fi
fi

# Step 4: Verify Playwright browser automation
echo -e "\n${BOLD}[4/4] Verifying Playwright browser automation...${NC}"

PLAYWRIGHT_BIN="${VENV_DIR}/bin/playwright"
if [ -f "$PLAYWRIGHT_BIN" ]; then
    # Test if chromium is runnable via playwright
    if ! "$VENV_PYTHON" -c 'from playwright.sync_api import sync_playwright; p = sync_playwright().start(); b = p.chromium.launch(headless=True); b.close(); p.stop()' &>/dev/null; then
        echo -e "Installing Playwright Chromium browser binary..."
        "$PLAYWRIGHT_BIN" install chromium
        echo -e "${GREEN}✓ Playwright Chromium installed successfully.${NC}"
    else
        echo -e "${GREEN}✓ Playwright Chromium browser already installed and verified.${NC}"
    fi
fi

# Ensure default config.json exists
if [ -L "$(dirname "$CONFIG_TARGET")" ] || [ -L "$CONFIG_TARGET" ]; then
    echo "Error: the configuration path contains a symbolic link; refusing setup." >&2
    exit 1
fi
if [ ! -f "$CONFIG_TARGET" ] && [ -f "$CONFIG_EXAMPLE" ]; then
    echo -e "\n${YELLOW}Initializing default configuration: ${CONFIG_TARGET}${NC}"
    "$PYTHON_BIN" - "$CONFIG_EXAMPLE" "$CONFIG_TARGET" <<'PY'
import os
import shutil
import sys

flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
if hasattr(os, "O_NOFOLLOW"):
    flags |= os.O_NOFOLLOW
with open(sys.argv[1], "rb") as source:
    fd = os.open(sys.argv[2], flags, 0o600)
    with os.fdopen(fd, "wb") as target:
        shutil.copyfileobj(source, target)
PY
fi

echo -e "\n${GREEN}============================================================${NC}"
echo -e "${GREEN}🎉 Environment ready!${NC}"
echo -e "${GREEN}============================================================${NC}"

if [ "$SETUP_ONLY" = true ]; then
    echo -e "\nSetup completed successfully (--setup-only specified)."
    echo -e "To start the web application at any time, run:"
    echo -e "  ${BOLD}./bootstrap.sh${NC}  or  ${BOLD}${VENV_PYTHON} canvas_app/run.py${NC}\n"
    exit 0
fi

# Launch the application
echo -e "\n🚀 Launching Canvas Course Offline Archive..."
echo -e "Local URL: ${BOLD}http://127.0.0.1:8000${NC}\n"
exec "$VENV_PYTHON" "${SCRIPT_DIR}/canvas_app/run.py"
