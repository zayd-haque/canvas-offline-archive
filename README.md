# Canvas Offline Archive

Created and maintained by [zayd-haque](https://github.com/zayd-haque).

**Capture Canvas course materials you can access, organize them on your computer, and browse your saved courses offline.** This is a local macOS and Windows app with a browser interface. The [project page](https://zayd-haque.github.io/canvas-offline-archive/) explains the release; the app itself runs on your computer at `http://127.0.0.1:8000`.

[Download for Mac](https://github.com/zayd-haque/canvas-offline-archive/releases/latest/download/canvas-offline-archive-macos.zip) · [Download for Windows](https://github.com/zayd-haque/canvas-offline-archive/releases/latest/download/canvas-offline-archive-windows.zip) · [Mac guide](INSTALL.md) · [Windows guide](WINDOWS_INSTALL.md) · [Project page](https://zayd-haque.github.io/canvas-offline-archive/) · [Report an issue](https://github.com/zayd-haque/canvas-offline-archive/issues)

## What it does

- Captures selected Canvas categories, including modules, files, syllabus, assignments, announcements, discussions, quizzes, grades, pages, media, and available Gradescope content. What can be captured depends on your Canvas permissions and what the course publishes.
- Organizes downloaded material in a directory you choose. The Add Course screen lets you review the destination, select categories, and watch capture progress. A separate Rescan screen can update an existing archive.
- Shows saved courses through a dashboard, modules, assignments, timeline, and folder views. Supported documents can be previewed in the app or opened in the default desktop application.
- Searches local filenames and extracted document text. Apple Vision OCR on macOS and the built-in Windows OCR engine can index scanned PDFs locally; Windows needs an installed OCR language. Indexing may continue after a capture ends.
- Discovers existing course folders and can import a legacy folder when you explicitly choose to do so.

The website and GitHub Pages are **documentation and download pages**. They do not host the running app or your courses.

## Explore a captured course

The dashboard groups your saved courses and gives quick access to modules, files, timelines, and the course folder in the system file manager. Within a course, you can move between assignments, a chronological announcement stream, grades and feedback, syllabus views, and the on-disk folder tree. When the original syllabus PDF is available, the app can show it in its bundled PDF viewer; other syllabus views use the captured course data.

Search starts from the header as you type. The full results view lets you narrow matches by material type and jump to a local file, preview, or folder. Search covers filenames and extracted document text, with on-device OCR available for scanned PDFs on supported Macs and Windows PCs. Results depend on what has been captured and indexed; they are not a live search of Canvas.

The app includes theme, accent, viewer, and directory settings. You can add a discovery root or explicitly import an older course folder. Merely viewing an archive does not start a new Canvas capture.

You can also remove every scan root. The dashboard then shows a getting-started view and the course catalog is empty; your folders are not deleted. When you explicitly capture a new course, the app adds that course's destination as a scan root so the completed course appears in the library.

## Requirements

- A Mac or Windows PC with **Python 3.14**. Initial setup also downloads Python dependencies and Playwright Chromium, so it needs internet access.
- Your own authorized Canvas account and a reachable course URL for new captures. Your institution may require a visible browser sign-in and two-factor authentication.
- Enough free disk space for the course material you choose to save. Local model use also requires Ollama and a model you install yourself.

## Install and open

1. Install [Python 3.14](https://www.python.org/downloads/) for your platform.
2. Download and extract the [Mac ZIP](https://github.com/zayd-haque/canvas-offline-archive/releases/latest/download/canvas-offline-archive-macos.zip) or [Windows ZIP](https://github.com/zayd-haque/canvas-offline-archive/releases/latest/download/canvas-offline-archive-windows.zip) into a folder you control.
3. In the extracted `canvas-offline-archive` folder, double-click **Open Canvas Offline Archive.command** on Mac or **Open Canvas Offline Archive Windows.cmd** on Windows. The launcher creates a local `.venv`, installs dependencies, and starts the app. Keep its terminal window open while using the app.
4. In the browser window opened by the launcher, use the skippable first-run Setup Guide. You can reopen it later. Choose your directory and organization method, then add a course when ready.

To start manually, open Terminal in the unzipped folder and run:

```sh
bash bootstrap.sh
```

For platform-specific details, see the [Mac guide](INSTALL.md) or [Windows guide](WINDOWS_INSTALL.md). Windows verification covers native scanned-PDF OCR and search, plus VM checks of Canvas login/capture, folder selection, Explorer reveal, PDF opening, previews, and search. The full Windows upgrade from v1.0.7 was verified, including dependency installation, restart, and preservation of settings, course files, and the existing virtual environment.

Use the launcher each time you start the server: it opens a fresh authenticated local browser session. Closing the last app tab stops the server after a short grace period; double-click the launcher to reopen it. If you see a login or access error after restarting, close that tab and reopen through the launcher. See [INSTALL.md](INSTALL.md) for troubleshooting and reinstall instructions.

## First course

1. Open **Add Course** and paste a Canvas course URL you can access.
2. Choose a destination folder and an organization option. **Keyword Heuristics** needs no API key or local model. **Ollama** uses a model you installed locally. **Gemini** uses your own Google API key and sends eligible course excerpts and filenames to Google, including submitted coursework during rescans.
3. Select the categories to capture and start the job. Complete any institution sign-in or two-factor prompt in the browser. Keep your computer awake and connected until capture finishes.
4. Open the course, preview a saved file, and try search. Give the search index time to finish, especially for large files or OCR.
5. To confirm offline access, stop the app, disconnect from the network, start it again, and open an already captured course.

The app does not automatically download a local AI model or silently switch providers after a provider error.

## Online and offline behavior

| Task | Connection needed? |
| --- | --- |
| Browse, preview, and search **already captured** material | Usually no; native previews and OCR need their local platform components |
| Capture or rescan a Canvas course or sync Gradescope | Yes, plus valid authorization |
| Classify with Keyword Heuristics or an installed Ollama model | No cloud AI connection |
| Classify with Gemini | Yes; eligible content is sent to Google |

An empty install does not make Canvas available offline. You need to capture a course while online first. Capture completeness varies by institution, permissions, published content, and file type.

## Your data and privacy

The release package contains app source and documentation. It does **not** contain the maintainer's course archives, local configuration, browser session, API keys, or search caches. Your archives and settings are created on your computer after installation. The local server binds to `127.0.0.1` and uses a session opened by the launcher; it is not a hosted service.

Do not share a populated app folder or course archive without reviewing it for private material. Older archives may contain a `.session_cookies.json` export. The [security notes](SECURITY.md) describe the local session and sharing considerations. For removal, stop the app and delete its unzipped folder; archives in your chosen destination and private caches are separate. [INSTALL.md](INSTALL.md) lists their locations.

## Current release status

The automated fixture suite covers ingestion helpers, APIs, search, security boundaries, and frontend contracts. It does not prove a successful fresh login or complete capture for every institution, a clean installation on every Mac, or every native preview and OCR path. Please [report reproducible problems](https://github.com/zayd-haque/canvas-offline-archive/issues) without posting credentials, grades, or private course content.
