"""[Codex] Windows-only native file actions and folder picker."""

from __future__ import annotations

import os
import subprocess
import tkinter as tk
from pathlib import Path
from tkinter import filedialog


def open_path(path: Path, action: str) -> None:
    path = Path(path)
    if __package__:
        from .native_policy import validate_native_action
    else:
        from native_policy import validate_native_action
    validate_native_action(path, action)
    if action == 'reveal' and path.is_file():
        subprocess.run(['explorer.exe', '/select,', str(path)], check=True, timeout=10)
    else:
        os.startfile(str(path))


def choose_directory(prompt: str) -> Path | None:
    root = tk.Tk()
    root.withdraw()
    try:
        # The browser is foreground when this server request arrives. Give the
        # native dialog a topmost owner so it remains visible over the browser.
        root.attributes('-topmost', True)
        root.update()
        chosen = filedialog.askdirectory(parent=root, title=prompt, mustexist=True)
    finally:
        root.destroy()
    return Path(chosen).resolve() if chosen else None
