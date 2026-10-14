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

# [Codex] Install a checksum-pinned, app-private runtime on a fresh Mac.
# No Homebrew, admin rights, system Python changes, or remote shell scripts.
install_private_python() {
    local runtime_dir="${SCRIPT_DIR}/.python"
    if [ -L "$runtime_dir" ]; then
        echo "Error: .python is a symbolic link; refusing runtime setup." >&2
        return 1
    fi
    if [ -x "$runtime_dir/bin/python3.14" ]; then
        PYTHON_BIN="$runtime_dir/bin/python3.14"
        return
    fi
    if [ -e "$runtime_dir" ]; then
        echo "Error: the private Python setup is incomplete. Rename .python inside App Files and retry." >&2
        return 1
    fi
    local architecture archive_name expected_hash
    architecture="$(uname -m)"
    case "$architecture" in
        arm64)
            archive_name='cpython-3.14.8%2B20261013-aarch64-apple-darwin-install_only.tar.gz'
            expected_hash='709f419d175eb015f810b68aa54bdae1d776c9824cb362aa701c93b0a9f2a9e7'
            ;;
        x86_64)
            archive_name='cpython-3.14.8%2B20261013-x86_64-apple-darwin-install_only.tar.gz'
            expected_hash='e09bce050cf075e777d1a802c4a11b6d43d54291b5f76911887173b28ad9c9fd'
            ;;
        *) echo "Error: unsupported Mac architecture: $architecture" >&2; return 1 ;;
    esac
    # A private stage plus an exclusive lock avoids partially published runtimes.
    local runtime_lock="${SCRIPT_DIR}/.python-install.lock"
    if ! mkdir "$runtime_lock" 2>/dev/null; then
        echo "Another Python setup may be running. Close it before retrying." >&2
        echo "If setup was interrupted, remove .python-install.lock inside App Files."
        return 1
    fi
    local runtime_stage
    runtime_stage="$(mktemp -d "${SCRIPT_DIR}/.python-download.XXXXXX")" || { rmdir "$runtime_lock"; return 1; }
    # The subshell's EXIT trap also cleans up failed downloads and hash checks.
    (
        trap 'rm -rf "$runtime_stage"; rmdir "$runtime_lock"' EXIT
        echo "Setting up Python for this app. You do not need to install Python yourself."
        echo "First setup needs internet. Downloading the Mac runtime..."
        curl --fail --location --proto '=https' --proto-redir '=https' \
            --connect-timeout 20 --max-time 600 --retry 2 \
            "https://github.com/astral-sh/python-build-standalone/releases/download/20261013/${archive_name}" \
            --output "$runtime_stage/runtime.tar.gz" || {
                echo "Python download failed. Check your internet connection and open the launcher again." >&2
                exit 1
            }
        local actual_hash
        actual_hash="$(shasum -a 256 "$runtime_stage/runtime.tar.gz")"
        if [ "${actual_hash%% *}" != "$expected_hash" ]; then
            echo "Python download verification failed. Nothing was installed; retry the launcher." >&2
            exit 1
        fi
        tar -xzf "$runtime_stage/runtime.tar.gz" -C "$runtime_stage" || exit 1
        "$runtime_stage/python/bin/python3.14" -c 'import sys; raise SystemExit(sys.version_info[:2] != (3, 14))' || exit 1
        # Refuse any destination created since the initial check.
        if [ -e "$runtime_dir" ] || [ -L "$runtime_dir" ]; then
            echo "Python destination changed during setup; refusing installation." >&2
            exit 1
        fi
        mv "$runtime_stage/python" "$runtime_dir" || exit 1
    ) || return 1
    PYTHON_BIN="$runtime_dir/bin/python3.14"
}

# Step 1: Detect the validated Python version
echo -e "\n${BOLD}[1/4] Checking Python environment...${NC}"

PYTHON_BIN=""
# Prefer a previously downloaded runtime so later launches work offline.
if [ -L "${SCRIPT_DIR}/.python" ]; then
    echo "Error: .python is a symbolic link; refusing setup." >&2
    exit 1
elif [ -x "${SCRIPT_DIR}/.python/bin/python3.14" ]; then
    PYTHON_BIN="${SCRIPT_DIR}/.python/bin/python3.14"
elif command -v python3.14 &>/dev/null; then
    PYTHON_BIN="$(command -v python3.14)"
fi

if [ -z "$PYTHON_BIN" ]; then
    if [ "$(uname -s)" = Darwin ]; then
        install_private_python
    else
        echo -e "${RED}Error: Python 3.14 is required for this release.${NC}"
        echo "Install Python 3.14, then run bash bootstrap.sh again."
        exit 1
    fi
fi

"$PYTHON_BIN" -c 'import sys; raise SystemExit(sys.version_info[:2] != (3, 14))' || {
    echo "Error: the selected Python runtime is not Python 3.14." >&2
    exit 1
}

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
    echo "Next time, double-click Open Canvas Offline Archive.command to open the app."
    exit 0
fi

# Launch the application
echo -e "\n🚀 Launching Canvas Course Offline Archive..."
echo -e "Local URL: ${BOLD}http://127.0.0.1:8000${NC}\n"
exec "$VENV_PYTHON" "${SCRIPT_DIR}/canvas_app/run.py"
