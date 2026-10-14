# Canvas Offline Archive: Windows installation [Codex]

This source release runs locally on Windows 10 or 11. Previously captured courses can be viewed offline; new Canvas captures need your authorized login and an internet connection.

## Install and start

1. Download the Windows ZIP. First setup needs internet; you do not need to install Python or change your system PATH. Use 64-bit Windows 10 or 11 (x64 or ARM64).
2. Extract the ZIP into a folder you control. The extracted folder contains **Open Canvas Offline Archive Windows.cmd** and **App Files**. Keep them together; the scripts and documentation belong inside App Files. Do not run the launcher from inside the ZIP.
3. Double-click **Open Canvas Offline Archive Windows.cmd**. The first launch uses Windows PowerShell to download and verify a private Python runtime into `App Files/.python`, creates `App Files/.venv`, installs hash-locked dependencies and Playwright Chromium, then opens the local app in your default browser. One launch performs setup and opens the app; there is no separate setup command or administrator installation. Keep the command window open while using the app.
4. In **Settings → Course Directories**, choose an existing folder with the native picker. This is especially useful if Windows redirects Desktop into OneDrive.
5. In **Add Course**, enter an authorized Canvas URL and select an organization method. Keyword Heuristics needs no AI setup; Ollama requires an installed local model; Gemini uses your own API key and sends eligible course excerpts and filenames to Google.
6. Choose categories and start capture. Complete any SSO or two-factor sign-in in the visible browser. Open the resulting archive and wait for search indexing to finish. Restart with the Windows launcher when needed.

Use `Open Canvas Offline Archive Windows.cmd --setup-only` to install without starting the app, or `--reinstall` to replace only this package's `.venv` after a Python-version change.

The launcher checks for a newer published Windows release at startup. It installs only an official release ZIP whose SHA-256 digest is supplied by GitHub; if offline or no suitable release exists, it starts the installed copy. Course archives, local `config.json`, `.venv`, and the private `.python` runtime are preserved. Older updaters reject the new folder layout safely; download and unzip the new Windows ZIP separately to adopt it, keeping the old folder until you migrate its settings. Preview ZIPs skip automatic updates so they cannot revert to an older public release. Set `CANVAS_OFFLINE_NO_UPDATE=1` in the environment to skip the check.
Automatic downloads require a tagged release on `zayd-haque/canvas-offline-archive` with an asset named `canvas-offline-archive-windows.zip`. A copied test ZIP does not become an online update until it is published there.

## Windows capabilities and limits

- Local browsing, PDF viewing, document text extraction, search, and Canvas capture use the same source as the Mac app.
- **Open in application** uses the Windows file association. **Reveal** opens File Explorer. The folder picker uses the native Windows dialog.
- macOS Quick Look previews are unavailable on Windows. Scanned, low-text PDF pages are rendered locally with PDFium and recognized with the built-in Windows OCR engine when a Windows OCR language is installed. OCR is enabled by default, can be disabled with `CANVAS_OCR=0`, and runs in bounded, resumable batches. PPTX/DOCX files still have extracted text for search where supported and can be opened in an installed desktop application.
- The PDF parser still has an input limit and wall timeout, but Unix CPU and memory resource limits are unavailable on Windows. Only open archives you trust.
- Native Windows verification covers local scanned-PDF recognition and the OCR-to-search pipeline with a synthetic page. A separate Windows 11 VM verified authenticated Canvas capture, the folder picker, Explorer reveal, default PDF opening, local previews, and search. This does not guarantee complete capture for every institution or recognition of every scan.

The local browser session is created by the launcher. A bookmarked `127.0.0.1:8000` URL will not create a new session after restart. Keep course archives, browser profiles, API keys, and caches private; none are included in the release ZIP.

## First-run troubleshooting [Codex]

- If the Python download fails, check your connection and double-click the launcher again. A failed or unverified runtime is not installed.
- If another setup is running, let that window finish. An interrupted runtime download can retry on the next launch without manually removing a lock.
- An organization may block `.cmd` or PowerShell execution. Ask its administrator about that policy; the launcher does not change machine-wide execution policy. Its PowerShell setting applies only to that launch. Windows security may still show a warning for an unsigned download.
- The launcher uses the built-in Windows archive tool. Use an up-to-date Windows 10 or Windows 11 installation.

Automatic runtime setup uses Astral Python Standalone Builds, CPython 3.14.8 build 20261013, with separate pinned SHA-256 digests for x64 and ARM64. Runtime licenses ship in that distribution. It makes no global Python installation, PATH change, or Ollama model download. The new automatic setup passed on a native x64 Windows runner (workflow 38519752261): no Python on PATH, private-runtime installation, authenticated Chromium UI, Settings/Add Course, and installation reuse. Native ARM64 and Explorer/security-prompt behavior remain unverified. Run `python tools/verify_windows_first_run.py` in the development checkout on Windows for an isolated setup/browser check.
