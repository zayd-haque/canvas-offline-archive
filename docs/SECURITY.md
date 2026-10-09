# Security and privacy for Canvas Offline Archive

Canvas Offline Archive runs on your computer at `127.0.0.1:8000`. The release ZIP contains application code and documentation, without course archives, saved browser sessions, API keys, or search caches. Those are created locally after installation.

## Install and local access

Follow the [Mac guide](INSTALL.md) or [Windows guide](WINDOWS_INSTALL.md): install Python 3.14, unzip the release, and use its launcher. Setup installs hash-locked Python dependencies and Playwright Chromium into an isolated `.venv` in the app folder. It needs internet access the first time.

The launcher opens a browser tab with a one-use token in the URL fragment. The app exchanges it for an HttpOnly, SameSite=Strict local session cookie before loading private course data. Restarting the server invalidates that session. If a bookmarked tab shows `401 Unauthorized`, close old app tabs and reopen through the launcher. The app checks file paths before serving course documents and binds to loopback, not a public network interface.

A local session protects against an unauthenticated browser request; it does not isolate the app from software running as your OS user. Browser cookies are scoped to a host rather than a port, so an untrusted service on another port at the same loopback host is part of the local threat model.

## Course data and cloud choices

Capturing or rescanning a course requires your own authorized Canvas login and an internet connection. The app stores browser authentication in a private profile on your computer. Do not share that profile or a populated app folder.

Keyword Heuristics runs locally. Ollama classification uses a model you install yourself. If you select Gemini, eligible course excerpts, filenames, and context are sent to Google, including submitted coursework and previously downloaded files during reclassification. Provider errors do not silently switch to another provider.

Captured courses remain in the destination you chose. Removing a scan root hides matching courses from the catalog but does not delete their files. Search indexes and previews are local caches. Older archives may contain `.session_cookies.json`; inspect and remove any credential exports before sharing an archive. If credentials were shared, revoke them at the issuing service.

## File operations and update recovery [Codex]

The app writes to selected course destinations, its configuration, private browser profile, and local caches. Generated knowledge/homework files preserve earlier versions in `.generated-backups`. Updates replace packaged application files and retain originals in private `.canvas-recovery-*` directories. Interrupted updates are recovered before launch; retain any pending recovery directory. Backups can contain personal edits and should not be shared blindly.

Native Open blocks executable, script, and link attachments; use Reveal to inspect those files manually. Keep your OS and document viewers updated. Automated checks do not establish that every native Windows action works correctly: Windows installation, OCR, and process cleanup still need a real Windows smoke test. Browser-managed downloads can consume temporary disk space, and Windows child processes can remain after an unexpected parent exit.

## Reporting

Please report ordinary bugs through [GitHub Issues](https://github.com/zayd-haque/canvas-offline-archive/issues), using synthetic examples. Do not post API keys, cookies, student grades, or private course documents in a public issue. For a sensitive security report, contact the repository owner privately.
