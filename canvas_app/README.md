# Canvas offline backend

Backend reliability, search tuning, and resumable OCR in this release: **[Codex]**.

Install the hash-locked Python 3.14 environment in [SECURITY.md](../SECURITY.md), then run `.venv/bin/python canvas_app/run.py`. The launcher binds **127.0.0.1:8000**, waits for readiness,
and opens the browser. Development reload is disabled for normal launches.
Launcher-opened tabs send authenticated five-second heartbeats. Closing the last tab
stops the server after a four-second reload grace; an unresponsive tab expires after
120 seconds. Shutdown cancels active ingestion and reaps its process group, then
stops indexing workers. Direct Uvicorn development launches do not auto-exit.
Viewing and searching existing archives need no network connection or external extraction service. Ingestion accesses Canvas and, when selected, the cloud AI provider.

## Services and freshness

- `archive.py`: bounded nested course discovery under configured roots; a 30-second read-only discovery cache; stat-keyed blueprint parsing; shared
  relative-path containment. Duplicate course names receive a path-derived suffix
  after the first archive, instead of silently replacing one another.
- `server.py`: existing routes and response fields, with a five-second folder
  inventory cache. Filesystem scans run in FastAPI workers, not on the event loop.
- `search_engine.py`: two indexing workers, at most eight pending/running jobs,
  and one job per archive. Startup and a 30-second background sweep schedule
  incremental refreshes. Course/search/status requests also schedule refreshes,
  throttled to once per five seconds per course. A rebuild requested during a job
  is coalesced into a subsequent forced pass. Deferred jobs retry on the next sweep
  or request. Large backlogs can take longer than the sweep interval.
- `extraction.py`: PDF, PPTX, DOCX, text, Markdown, CSV, and HTML extraction.
  PDF parsing uses a disposable child with a 90-second timeout and CPU limit.
- `ocr.py` / `ocr.swift`: on-device Apple Vision OCR for PDF pages with fewer than
  40 alphanumeric text characters. PDFKit renders only those pages, up to a 2,400
  pixel longest edge; Vision recognizes text without uploading documents. Existing
  text is retained unless OCR recovers more readable content. Original PDFs are
  never modified, and search hits retain the original PDF page numbers.
- `previews.py`: one native Quick Look job at a time, private per-process cache,
  file-version keys, bounded waits/timeouts, and atomic preview publication.
  Failed or busy previews return the existing download fallback.

Discovery notices moves, additions, and removals after its cache expires. Changed
blueprints are revalidated on direct course reads. Indexes compare nanosecond
mtime, ctime, size, and inode; curriculum is refreshed with each index pass.
Incremental passes publish each completed file. Forced rebuilds keep the previous
committed index visible until the complete pass commits. Deleted
result paths are filtered even before the next indexing pass. Files changed during
extraction are recorded as failed and reconsidered on the next changed fingerprint
or explicit rebuild. Transient extraction errors retry with backoff (up to three
attempts). For unchanged files, a failed resumption preserves existing searchable
text. Repeatedly failing files stop retrying until changed or explicitly rebuilt.

## Compatible API additions

Existing course, folder, preview, file, search, and native-action endpoints remain.
Search responses retain `query`, `total`, `curriculum_matches`, and `file_matches`
and add `index_status` and `search_info`. On a cold index, search may initially return no matches;
clients can poll status and retry when it becomes ready. Existing frontend code
can use the additive status contract without changing existing result rendering.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/courses/{course_name}/search/status` | Schedules an incremental check if due; returns status. |
| `POST /api/browser/heartbeat`, `/api/browser/release` | Authenticated launcher tab lease management; JSON body `{ "tab_id": "<32 lowercase hex characters>" }`, HTTP 204. |
| `POST /api/courses/{course_name}/search/rebuild` | Returns HTTP 202 and schedules/coalesces a forced rebuild. |
| `HEAD /api/courses/{course_name}/files/{file_path}` | File metadata without the response body. |

Status includes `state` (`idle`, `queued`, `indexing`, `ready`, `error`),
`processed`, `total`, `failed`, and `last_error`. Completed passes also report
`indexed` and `skipped`; queue saturation adds `deferred: true`. Error counts
include unchanged files whose extraction previously failed or OCR was incomplete.
Status also includes `ocr` with engine, enabled/available/ready flags, last compiler
error, and the per-document OCR page limit. OCR problems are nonfatal: usable
native text and completed OCR pages are still indexed.

Progress fields for frontend polling:

| Field | Meaning |
| --- | --- |
| `revision` | Persisted committed-index revision; unchanged refreshes do not increment it. |
| `phase`, `current_file` | Current scan/extraction phase and course-relative file path. |
| `percent_complete` | Completed file/page work units / currently known file/page work units; may adjust as more OCR candidates are discovered. |
| `pending_ocr`, `partial` | Remaining OCR pages and whether resumable work remains. |
| `ocr_total`, `ocr_completed`, `ocr_failed` | Candidate-page counts, successful/blank pages, and exhausted failures. |

Poll status while queued/indexing or partial, and refresh results when `revision`
changes. A `ready` state can still have pending OCR for the next bounded pass;
its `phase` stays `ocr` and its percentage stays below 100 until that work finishes.
Unavailable OCR is reported as a capability problem, not endless active progress.

Queries accept up to 512 characters/32 terms. Quoted phrases remain contiguous
whole-token phrases under FTS5's tokenizer/stemming; they never use typo correction
or OR fallback. Unquoted numeric terms are exact, so exam 1 does not become exam 12.
Unicode/accent-normalized filename matching handles punctuation and underscores.

Ranking uses disjoint tiers: exact terms, prefixes, corrections, partial matches,
then curriculum-only suggestions. Filename and curriculum boosts cannot push
partial results above exact ones. FTS BM25 breaks ties inside a tier. Numbered
curriculum queries use number boundaries. Each result adds `match_quality`.

Corrections use the local index vocabulary, bounded edit distance/transpositions,
and generic OCR confusions (`rn/m`, `0/o`, `1/l`). Exact matches always rank ahead
of corrected matches; clean and OCR-corrupt variants can coexist. Broad OR fallback
is limited to unquoted, non-numbered queries with no better matches. Exact
byte-for-byte copies are deduplicated, and snippets escape all source HTML.

`search_info` reports applied `corrections`, `partial_matches`, `truncated`,
`timed_out`, and a safe `error` code. A search uses one SQLite read snapshot and
reports its actual committed revision. Timeouts preserve already gathered hits.

Search returns at most 30 files by default from at most 1,000 hits per retrieval
tier and 1,000 filename candidates, plus curriculum suggestions. `total` is the
deduplicated candidate count, not an exhaustive archive-wide hit count. SQLite
work has a three-second instruction deadline. Correction examines at most 2,000
vocabulary candidates per term within a shared 120ms budget. Very large or unusual
vocabularies may therefore have incomplete fuzzy recall; truncation is explicit.

## Local security and limits

- Hostnames are restricted to localhost, 127.0.0.1, and ::1. Browser requests must
  use the app's own origin; remote/null origins and cross-site requests are denied.
  There is no wildcard CORS. Local CLI requests without Origin remain supported.
- Absolute paths, parent traversal, NUL paths, and symlink escapes are rejected.
  Discovery and inventories skip symlinked/hidden trees. Native action names are
  limited to `open` and `reveal`; commands have timeouts and use argument arrays.
- Archived documents and generated previews receive a restrictive sandbox CSP
  and `nosniff`. Archived HTML scripts and external assets intentionally do not run.
- Native file serving retains streaming and Range/If-Range handling. Tests verify
  206, 416, HEAD, Content-Range, and security headers with the installed Starlette.
- Blueprints are limited to 32 MiB. Extraction skips input above 128 MiB and caps
  output at two million characters / 2,000 pages or slides. Office XML is limited
  to 16 MiB per entry / 64 MiB total; entity declarations are rejected.
- On macOS, virtual-memory rlimits may be unavailable; parser isolation, CPU,
  wall-time, input, and output bounds still apply. This is not an OS security sandbox.
- Preview caches are pruned on generation at 512 MiB / one day and removed on
  normal process exit. Crashes may leave private temporary cache directories.

Indexes live in `~/.canvas_search_cache` (override with `CANVAS_CACHE_DIR`), with
path hashes and a new schema suffix. Previous slug-only caches are left untouched.
Moves create a fresh index; obsolete disk indexes are not automatically deleted.
The engine cache retains at most 64 idle/active course objects under the bounded
job policy. File protection assumes the normal single-user local workflow; another
process racing to replace files after validation is not fully prevented.

## Validation and limitations

Run `python3 -m unittest discover tests`.
The fixture suite needs no user archives, network, httpx, or native GUI processes.
It includes PDF child extraction, Office XML, corruption and size limits, cache
invalidation, duplicate names/content, atomic rebuilds, curriculum refresh,
large multipage search, startup/status APIs, traversal, and file ranges.

Validated with Python 3.14, FastAPI 0.141.1, Starlette 1.6.0, and SQLite FTS5.
Search uses materialized CTEs (SQLite 3.35+). An opt-in real-archive smoke tool
creates a disposable index without modifying source courses or persistent caches:
`python3 canvas_app/verify_search.py --course '/path/to/archive' --query 'exam 1'`.
Add `--ocr` to include native OCR; it is disabled by default in this diagnostic.

OCR is enabled by default on macOS. The first scanned PDF compiles the bundled
Swift helper locally (requires Apple Command Line Tools / `swiftc`, up to 90
seconds); subsequent runs reuse the binary from the local search cache. There is
no model download or additional Python OCR dependency. A missing compiler causes
a graceful fallback, surfaced in status. Set `CANVAS_OCR=0` to disable OCR.

OCR processes at most 100 low-text pages per pass with a 90-second process
timeout. Per-page SQLite checkpoints survive process restarts and retain successful
blank pages too. Subsequent index sweeps resume the next pages automatically;
100 pages is a batch limit, not a permanent document limit. A timed-out batch
charges retries only to emitted failures and the first interrupted page, not pages
the helper never reached. Page failures back off and stop after three attempts.
An explicit rebuild retries failed pages while reusing successful OCR. Source
changes invalidate checkpoints; cached text is never reused for a changed PDF. OCR output
shares the extraction text limit. Previously indexed PDFs are automatically
revisited when OCR support is enabled or becomes available. OCR is best for
printed text; handwriting, formulas, image-heavy pages containing a substantial
text layer, and unusual layouts may need future improvements. Recognition uses
Vision's local supported languages, with automatic detection on macOS 13+.

The sandbox used for development can block Vision image buffers. The native
helper was separately verified outside that sandbox against a generated
image-only PDF, recovering its printed sentence. Normal app launches run locally
without the development sandbox. Legacy Office formats have preview/fallback
but no text extraction. Native Quick Look output varies by macOS and installed
applications; tests mock native generation, so visual smoke testing remains useful.
There is no filesystem watcher; refresh is eventually consistent within the cache,
sweep, and job-processing intervals. Index corruption recovery and automatic disk
cache garbage collection remain follow-up work. OCR checkpoints also occupy local
cache space and are not yet subject to an automatic disk quota.


Backend rendering and resource limits [Codex]
--------------------------------------------
The frontend continues to consume `body_html` and `formatted_html`. HTML is rebuilt
from source text rather than trusting HTML supplied in an archive. Unsupported or
unsafe Markdown links remain plain text. Assignment prompts without separators,
fenced code, lists, and tables are handled on the server.

Course responses use a bounded cache keyed by blueprint and attachment-metadata
file signatures. Text previews and file statistics have separate stat-keyed caches;
concurrent requests for the same work share one computation. Overload returns a
structured 503 with `Retry-After: 2`. Preview/timeline reads select only the blueprint
fields they need. Discovery refreshes no longer hold the blueprint-reader lock;
cold enumeration can still wait on macOS filesystem access.

`GET /api/health` returns `{"status":"ok"}` without scanning archives. The launcher
uses this readiness endpoint. All API responses disable browser caching. File-info
retains existing fields and adds `stats_truncated` and, on parser failure,
`stats_unavailable`. PDF metadata runs in a child process with an eight-second
wall timeout, six-second CPU limit, and a memory limit where supported. Files over
128 MiB skip optional statistics; original downloads/streaming remain available.
Text statistics cover at most 500,000 characters. Text previews read at most 1 MiB;
Markdown renders at most 256 Ki characters per document and 2 Mi characters across
a course response, with visible truncation notices.

Timeline records sort chronologically by timezone-aware instants before pagination,
with undated records last. Naive/date-only dates are interpreted as UTC. Malformed
records are ignored; publication dates alone do not make assignments overdue.
Quick Look cache hits bypass unrelated native generation work and still validate
the source file version. Native preview appearance remains dependent on macOS.


Modular presentation contract [Codex]
------------------------------------
Edit `static/js/src/*.js` and `static/css/modules/*.css`, then run
`python3 canvas_app/bundle.py`. Numbered sources concatenate deterministically into
classic-script/CSS bundles; they share JavaScript scope rather than ES module
isolation. Unchanged builds preserve mtimes; changed output is published atomically.
The regular launcher builds before serving. Direct Uvicorn launches require an
explicit build after source edits.

Backend assignment projections include `due_display` (normalized archived deadline
text) and recalculate `status` per request, independently of cached document HTML.
Grade totals reject nonfinite values. Syllabus file fallbacks use the same course
containment policy and invalidate cached HTML when edited. Frontend course and
preview requests use cancellation plus identity guards, clear cross-course search
state, and treat filenames as plain text. UI composition remains client-side;
archived document parsing and grade calculations remain server-side.


Security remediation [Codex]
----------------------------
See [SECURITY.md](../SECURITY.md) for privacy, upgrade, recovery and verification instructions. Passive discovery no longer writes blueprints: import legacy course folders explicitly. The launcher permits one active pipeline for the shared browser profile and returns 409/429 for conflicts; logs and subscriber queues are bounded. Credentials use the dedicated settings endpoint only, and validation errors do not echo input. Metadata rendering escapes dates, points and link identifiers; the application CSP denies inline scripts. DOCX ZIP entries are checked and read with decompressed-size budgets before parsing.

A failed or disconnected pipeline never becomes a simulated success. SSE reconnects while completion is unconfirmed; cancelling requires a confirmed backend response. Zero file counts remain zero, and missing counts remain unknown. Shared transport replaces duplicated demo behavior. Provider selection never silently falls back. New downloader session cookies remain in memory rather than course folders.

### Authenticated local startup [Codex]

Use `python canvas_app/run.py` and the browser window it opens. The launcher exchanges a one-use URL-fragment token for an HttpOnly local session before any course data loads. A plain bookmarked URL works only while that browser has a valid session; after server restart, reopen through the launcher. All course/settings/job APIs, document files, and generated previews require authentication; generic static assets and the minimal health endpoint remain public. See SECURITY.md for the loopback cookie/port limitation.
