"""[Codex] Small OS boundary for local file actions and folder selection."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def open_path(path: Path, action: str) -> None:
    path = Path(path)
    if sys.platform == 'win32':
        if __package__:
            from .native_windows import open_path as windows_open_path
        else:
            from native_windows import open_path as windows_open_path
        windows_open_path(path, action)
    elif sys.platform == 'darwin':
        command = ['open', '-R', str(path)] if action == 'reveal' else ['open', str(path)]
        subprocess.run(command, check=True, timeout=10, capture_output=True)
    else:
        command = ['xdg-open', str(path.parent if action == 'reveal' and path.is_file() else path)]
        subprocess.run(command, check=True, timeout=10, capture_output=True)


def choose_directory(prompt: str) -> Path | None:
    if sys.platform == 'win32':
        if __package__:
            from .native_windows import choose_directory as windows_choose_directory
        else:
            from native_windows import choose_directory as windows_choose_directory
        return windows_choose_directory(prompt)
    if sys.platform == 'darwin':
        script = f'POSIX path of (choose folder with prompt "{prompt.replace(chr(34), chr(92) + chr(34))}")'
        result = subprocess.run(['osascript', '-e', script], capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            error = result.stderr.lower()
            if '-128' in error or 'user canceled' in error:
                return None
            raise OSError('Native folder selection failed')
        return Path(result.stdout.strip()).resolve() if result.stdout.strip() else None
    raise OSError('Native folder selection is unavailable on this platform')
