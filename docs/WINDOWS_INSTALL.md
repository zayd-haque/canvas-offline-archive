# Canvas Offline Archive: Windows installation [Codex]

This source release runs locally on Windows 10 or 11. Previously captured courses can be viewed offline; new Canvas captures need your authorized login and an internet connection.

## Install and start

1. Install 64-bit Python 3.14 from [python.org](https://www.python.org/downloads/windows/). Enable the Python launcher (`py`) during setup.
2. Extract the Windows ZIP into a folder you control. Do not run it from inside the ZIP.
3. Double-click **Open Canvas Offline Archive Windows.cmd**. The first launch creates `.venv`, installs hash-locked Python dependencies and Playwright Chromium, then opens the local app in your default browser. Keep the command window open while using the app.
4. In **Settings → Course Directories**, choose an existing folder with the native picker. This is especially useful if Windows redirects Desktop into OneDrive.
5. In **Add Course**, enter an authorized Canvas URL and select an organization method. Keyword Heuristics needs no AI setup; Ollama requires an installed local model; Gemini uses your own API key and sends eligible course excerpts and filenames to Google.
6. Choose categories and start capture. Complete any SSO or two-factor sign-in in the visible browser. Open the resulting archive and wait for search indexing to finish. Restart with the Windows launcher when needed.

Use `Open Canvas Offline Archive Windows.cmd --setup-only` to install without starting the app, or `--reinstall` to replace only this package's `.venv` after a Python-version change.

The launcher checks for a newer published Windows release at startup. It installs only an official release ZIP whose SHA-256 digest is supplied by GitHub; if offline or no suitable release exists, it starts the installed copy. Course archives, local `config.json`, and `.venv` are preserved. Set `CANVAS_OFFLINE_NO_UPDATE=1` in the environment to skip the check.
Automatic downloads require a tagged release on `zayd-haque/canvas-offline-archive` with an asset named `canvas-offline-archive-windows.zip`. A copied test ZIP does not become an online update until it is published there.

## Windows capabilities and limits

- Local browsing, PDF viewing, document text extraction, search, and Canvas capture use the same source as the Mac app.
- **Open in application** uses the Windows file association. **Reveal** opens File Explorer. The folder picker uses the native Windows dialog.
- macOS Quick Look previews are unavailable on Windows. Scanned, low-text PDF pages are rendered locally with PDFium and recognized with the built-in Windows OCR engine when a Windows OCR language is installed. OCR is enabled by default, can be disabled with `CANVAS_OCR=0`, and runs in bounded, resumable batches. PPTX/DOCX files still have extracted text for search where supported and can be opened in an installed desktop application.
- The PDF parser still has an input limit and wall timeout, but Unix CPU and memory resource limits are unavailable on Windows. Only open archives you trust.
- Native Windows verification covers local scanned-PDF recognition and the OCR-to-search pipeline with a synthetic page. A separate Windows 11 VM verified authenticated Canvas capture, the folder picker, Explorer reveal, default PDF opening, local previews, and search. This does not guarantee complete capture for every institution or recognition of every scan.

The local browser session is created by the launcher. A bookmarked `127.0.0.1:8000` URL will not create a new session after restart. Keep course archives, browser profiles, API keys, and caches private; none are included in the release ZIP.
