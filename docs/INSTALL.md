# Canvas Offline Archive: install on your Mac

This is a local app. It runs on your Mac at `http://127.0.0.1:8000`; it is not a hosted Canvas service. Viewing previously captured courses works offline. Capturing a course requires your own authorized Canvas login and an internet connection.

## Set up

1. Install Python 3.14 and make sure `python3.14 --version` works in Terminal. The installer downloads Python packages and Playwright Chromium, so the first setup needs internet access.
2. Unzip the package into a folder you control. In Terminal, `cd` into `canvas-offline-archive`.
3. Double-click `Open Canvas Offline Archive.command`. It opens Terminal to show setup progress, creates `.venv` inside the app folder, installs the hash-locked dependencies, installs Chromium if needed, and opens the local app. Later, double-click the same launcher. Keep its Terminal window open while using the app. If you prefer to start it manually, run `bash bootstrap.sh` from the app folder.
   Closing the last app tab stops the server after a short grace period. Double-click the launcher again to reopen it.
4. In **Add Course**, paste a Canvas course URL you can access and choose the desktop folder name. Check the destination preview before starting.
5. Choose **Keyword Heuristics** for no AI setup, **Offline Ollama** if you have installed Ollama and a model yourself, or **Gemini** if you want to use your own Google API key. Gemini sends course excerpts and filenames, including submitted coursework on rescans, to Google. Never use someone else's API key.
6. Select categories and start the capture. The first login may open a browser for your institution's SSO or 2FA. Leave it visible until login completes. Keep the Mac awake and connected until the job finishes.
7. Open the captured course, preview a file, and try search. Search and OCR may continue indexing after capture. Quit the app, disconnect from the internet, restart it, and verify the captured course opens offline.

You may leave the scan-root list empty in **Settings → Course Directories**. This hides existing courses from the catalog without deleting their folders. Capturing a new course explicitly adds its destination to the scan roots so you can open it afterward.

## Troubleshooting

- **Python 3.14 not found:** install it, open a new Terminal window, and retry.
- **Existing `.venv` uses another Python:** run `bash bootstrap.sh --reinstall` in the unzipped package folder. This replaces that folder's virtual environment.
- **Port 8000 is busy:** stop another copy of the app, then retry.
- **Browser did not open:** set a default browser and restart the launcher; it opens a one-use authenticated browser session. A plain URL after server restart will not sign you in.
- **Canvas login stalls:** complete the institution's login and 2FA in the visible browser. A saved session can expire.
- **No results yet:** wait for the search indicator to finish. OCR requires macOS and Apple Command Line Tools for `swiftc`; other text can still index without it.
- **Gemini or Ollama fails:** verify your own key or locally installed model. The app does not silently switch providers.

## Privacy and removal

Your Canvas browser profile, local configuration, course archive, search cache, and previews are created on **your** Mac after install. They are not supplied in this package. Do not send your app folder or course archive to someone else without checking for private content. Older archives can contain `.session_cookies.json`; see [SECURITY.md](SECURITY.md) before sharing them.

To remove the app, stop it and delete the unzipped app folder. Captured courses under your chosen destination, the private browser profile at `~/.canvas_browser_profile/`, and the search cache at `~/.canvas_search_cache/` are separate; remove those yourself only if you no longer need their contents.

The launcher checks for a newer published Mac release at startup. It installs only an official release ZIP whose SHA-256 digest is supplied by GitHub; if offline or no suitable release exists, it starts the installed copy. Course archives, local `config.json`, and `.venv` are preserved. Set `CANVAS_OFFLINE_NO_UPDATE=1` in the environment to skip the check.
Automatic downloads require a tagged release on `zayd-haque/canvas-offline-archive` with an asset named `canvas-offline-archive-macos.zip`. A copied test ZIP does not become an online update until it is published there.

## Known limits

This release has automated fixture coverage, but a fresh authenticated crawl of every institution and category, native preview appearance, OCR on every document, and a clean-Mac install still need real-world verification. Use the app only for courses you are authorized to access and retain.
