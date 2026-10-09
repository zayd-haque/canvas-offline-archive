#!/usr/bin/env python3
"""
FastAPI Server for Canvas Course Offline Web App.
Discovers local archived Canvas courses, serves the Canvas blueprint JSON,
streams local files (PDFs, PPTX, images) with inline viewing support,
generates on-demand macOS Quick Look HTML slide previews for PPTX/DOCX files,
and interfaces with macOS Preview/PowerPoint/Finder.
"""

import os
import re
import html
import mimetypes
import subprocess
from pathlib import Path
from typing import Dict, Any, Literal, Optional, List, Union
from datetime import datetime, timezone
import threading
import time
import copy
import asyncio
import logging
import collections
from contextlib import asynccontextmanager
from urllib.parse import quote

import uuid
import json
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse, StreamingResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

try:
    from .search_engine import get_search_engine, is_synthetic_file, _STOP_INDEXING
    from .local_auth import LocalAccess, COOKIE_NAME
    from .processes import start_pipeline_process, terminate_pipeline_process
    from .cache import DerivedCache, CacheBusy
    from .timeline import project_timeline
    from .file_info import probe_file
    from .archive import ArchiveCatalog, safe_path, walk_files, signature
    from .previews import PREVIEW_CACHE_DIR, _LOCK as _PREVIEW_CACHE_LOCK, generate_document_preview
    from .browser_lifecycle import BrowserLeases
    from .native import open_path, choose_directory
except ImportError:
    from search_engine import get_search_engine, is_synthetic_file, _STOP_INDEXING
    from local_auth import LocalAccess, COOKIE_NAME
    from processes import start_pipeline_process, terminate_pipeline_process
    from cache import DerivedCache, CacheBusy
    from timeline import project_timeline
    from file_info import probe_file
    from archive import ArchiveCatalog, safe_path, walk_files, signature
    from previews import PREVIEW_CACHE_DIR, _LOCK as _PREVIEW_CACHE_LOCK, generate_document_preview
    from browser_lifecycle import BrowserLeases
    from native import open_path, choose_directory

try:
    from . import formatting
    from .formatting import (format_document_preview, format_markdown,
                             calculate_grade_summary, calculate_assignment_status,
                             format_syllabus_html, format_file_size)
except ImportError:
    import formatting
    from formatting import (format_document_preview, format_markdown,
                            calculate_grade_summary, calculate_assignment_status,
                            format_syllabus_html, format_file_size)

try:
    import sys
    _cmd_dir = str(Path(__file__).resolve().parent.parent / "Canvas Module Downloader")
    if _cmd_dir not in sys.path:
        sys.path.insert(0, _cmd_dir)
    from canvas_blueprint import CourseBlueprint, synthesize_course_blueprint, infer_course_name_from_folder, clean_module_title, module_category_sort_key, natural_sort_key
    from category_manager import ALL_CATEGORY_KEYS
    from llm_client import get_system_hardware_profile, get_hardware_recommendations
except Exception:
    CourseBlueprint = None
    synthesize_course_blueprint = None
    infer_course_name_from_folder = lambda f: f
    clean_module_title = lambda title, course_name="": title
    module_category_sort_key = lambda title: (7, 0, str(title))
    natural_sort_key = lambda s: [str(s)]
    ALL_CATEGORY_KEYS = {
        "modules", "syllabus", "announcements", "assignments",
        "discussions", "quizzes", "grades", "files", "pages", "media", "gradescope"
    }
    def get_system_hardware_profile():
        return {
            "ram_gb": 16.0,
            "chip": "Apple Silicon",
            "is_apple_silicon": True,
            "tier": "high",
            "device_model": "Mac",
            "is_fanless": False,
        }
    def get_hardware_recommendations(profile=None, has_gemini_key=False):
        return {
            "recommended_local_model": "qwen2.5:7b",
            "recommended_provider": "gemini",
            "reason": "Default hardware profile",
        }

async def maintain_indexes():
    """Warm new archives and refresh existing ones without blocking the event loop."""
    offset = 0
    while True:
        try:
            courses = list((await asyncio.to_thread(discover_courses)).items())
            if courses:
                offset %= len(courses)
                courses = courses[offset:] + courses[:offset]
            for name, info in courses:
                engine = await asyncio.to_thread(get_search_engine, name, info['path'])
                engine.request_index()
            offset += min(8, len(courses))
        except Exception:
            logging.getLogger(__name__).exception('Background archive refresh failed')
        await asyncio.sleep(30)


@asynccontextmanager
async def lifespan(app):
    _STOP_INDEXING.clear()
    monitor = asyncio.create_task(maintain_indexes())
    browser_monitor = asyncio.create_task(_watch_browser_tabs(app)) if getattr(app.state, 'stop_when_tabs_close', False) else None
    try:
        yield
    finally:
        _STOP_INDEXING.set()
        if browser_monitor:
            browser_monitor.cancel()
            await asyncio.gather(browser_monitor, return_exceptions=True)
        monitor.cancel()
        await asyncio.gather(monitor, return_exceptions=True)
        for job in list(_launcher_jobs.values()):
            if job.get('task') and not job['task'].done():
                job['cancelled'] = True
                job['task'].cancel()
        await asyncio.gather(*(job['task'] for job in list(_launcher_jobs.values())
                               if job.get('task')), return_exceptions=True)


_browser_leases = BrowserLeases()


async def _watch_browser_tabs(app):
    while True:
        await asyncio.sleep(1)
        if _browser_leases.should_stop():
            app.state.request_shutdown()
            return


LOCAL_ACCESS = LocalAccess()

app = FastAPI(title="Canvas Course Offline Archive", version="1.9.0", lifespan=lifespan)


class BrowserTabRequest(BaseModel):
    tab_id: str = Field(pattern=r'^[0-9a-f]{32}$')


@app.post('/api/browser/heartbeat', status_code=204)
async def browser_heartbeat(payload: BrowserTabRequest):
    _browser_leases.touch(payload.tab_id)
    return Response(status_code=204)


@app.post('/api/browser/release', status_code=204)
async def browser_release(payload: BrowserTabRequest):
    _browser_leases.release(payload.tab_id)
    return Response(status_code=204)

@app.exception_handler(RequestValidationError)
async def invalid_request(request, exc):
    # [Codex] Never reflect request bodies, credentials, or validator context.
    return JSONResponse({'detail': [{'loc': list(e['loc']), 'type': e['type'],
                                   'msg': 'Invalid request value'} for e in exc.errors()]}, status_code=422)


@app.middleware('http')
async def local_browser_policy(request: Request, call_next):
    host = request.url.hostname
    if host not in {'localhost', '127.0.0.1', '::1'}:
        return JSONResponse({'detail': 'Local host required'}, status_code=403)
    origin = request.headers.get('origin')
    if origin and origin != f'{request.url.scheme}://{request.headers.get("host")}':
        return JSONResponse({'detail': 'Cross-origin access denied'}, status_code=403)
    if request.headers.get('sec-fetch-site') == 'cross-site':
        return JSONResponse({'detail': 'Cross-site access denied'}, status_code=403)
    path = request.url.path
    is_public = (path == '/' or path.startswith('/static/') or
                 (path == '/api/health' and request.method in {'GET', 'HEAD'}) or
                 (path == '/api/auth/session' and request.method == 'POST'))
    if not is_public and not LOCAL_ACCESS.authenticate(request.cookies.get(COOKIE_NAME)):
        return JSONResponse({'detail': 'Open this app from the local launcher to authenticate'},
                            status_code=401, headers={'Cache-Control': 'no-store'})
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    if not request.url.path.startswith('/static/pdfjs/'):
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; connect-src 'self'; font-src 'self' data:"
    # Archived HTML and native previews are untrusted documents, not application code.
    if '/files/' in request.url.path or request.url.path.startswith('/api/preview-cache/'):
        response.headers['Content-Security-Policy'] = "sandbox allow-same-origin; default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src 'self'; frame-ancestors 'self'"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    return response


@app.post('/api/auth/session')
async def create_local_session(request: Request):
    """[Codex] Exchange one launch fragment for an HttpOnly browser session."""
    expected_origin = f'{request.url.scheme}://{request.headers.get("host")}'
    if request.headers.get('origin') != expected_origin:
        raise HTTPException(403, detail='Same-origin browser bootstrap required')
    if request.headers.get('content-type', '').split(';', 1)[0].strip().lower() != 'application/json':
        raise HTTPException(415, detail='JSON required')
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > 1024:
            raise HTTPException(413, detail='Bootstrap request too large')
        body.extend(chunk)
    try:
        payload = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(400, detail='Invalid bootstrap request')
    session = LOCAL_ACCESS.exchange(payload.get('token') if isinstance(payload, dict) else None)
    if session is None:
        raise HTTPException(401, detail='Invalid or expired launcher token')
    response = Response(status_code=204)
    response.set_cookie(COOKIE_NAME, session, httponly=True, samesite='strict', secure=False, path='/')
    return response


@app.get('/api/auth/session', status_code=204)
def verify_local_session():
    return Response(status_code=204)


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / 'static'
app.mount('/api/preview-cache', StaticFiles(directory=str(PREVIEW_CACHE_DIR)), name='preview_cache')
_catalog = ArchiveCatalog()
_course_cache = DerivedCache(max_items=24)
_preview_cache = DerivedCache()
_info_cache = DerivedCache(max_bytes=4 * 1024 * 1024, max_items=512, max_pending=4)


@app.exception_handler(CacheBusy)
async def cache_busy(request, exc):
    return JSONResponse({'detail': str(exc)}, status_code=503, headers={'Retry-After': '2'})


def raw_course(info, fields=None):
    try:
        return _catalog.blueprint(info, fields=fields)
    except (OSError, ValueError):
        raise HTTPException(409, detail='Course blueprint changed or is unreadable; refresh courses')


def optional_signature(path):
    try:
        return signature(path)
    except OSError:
        return None

_folder_cache = {}
_folder_lock = threading.Lock()

# Default directories where courses might reside
DEFAULT_SEARCH_DIRS = [
    Path.home() / "Desktop",
    Path.home() / "Documents",
    Path.home() / "Downloads"
]
SEARCH_DIRS = list(DEFAULT_SEARCH_DIRS)


def _to_display_path(p: Union[Path, str]) -> str:
    """Converts a Path or path string to ~/... display format if inside user's home."""
    try:
        resolved = Path(p).expanduser().resolve()
        home = Path.home().resolve()
        if resolved == home:
            return "~"
        if resolved.is_relative_to(home):
            rel = resolved.relative_to(home)
            return f"~/{rel.as_posix()}"
        return str(resolved)
    except Exception:
        return str(p)


def _read_configured_directories() -> tuple[List[str], str]:
    """Reads configured search_dirs and default_course_dir from config.json."""
    search_dirs: Optional[List[str]] = None
    default_dir = "~/Desktop"
    try:
        config, _ = _read_gemini_config()
        raw_dirs = config.get("search_dirs")
        if isinstance(raw_dirs, list):
            search_dirs = []
            for d in raw_dirs:
                if isinstance(d, str) and d.strip():
                    search_dirs.append(d.strip())
        raw_def = config.get("default_course_dir")
        if isinstance(raw_def, str) and raw_def.strip():
            default_dir = raw_def.strip()
    except Exception:
        pass

    if search_dirs is None:
        search_dirs = [_to_display_path(p) for p in DEFAULT_SEARCH_DIRS]
    return search_dirs, default_dir


def _prune_nested_roots(roots: List[Path]) -> List[Path]:
    """Prunes redundant child directories when a parent directory is already in roots."""
    unique_roots: List[Path] = []
    seen = set()
    for r in roots:
        res = Path(r).expanduser().resolve()
        if res not in seen:
            seen.add(res)
            unique_roots.append(res)
    pruned: List[Path] = []
    for r in unique_roots:
        if not any(r != parent and r.is_relative_to(parent) for parent in unique_roots):
            pruned.append(r)
    return pruned


def get_effective_search_dirs() -> List[Path]:
    """
    Returns list of existing Path directories to scan for courses.
    Supports dynamic configured directories from config.json, while respecting
    test patch overrides on SEARCH_DIRS.
    Prunes redundant nested child directories when a parent root is configured.
    """
    configured_dirs, _ = _read_configured_directories()
    if not configured_dirs:
        return []
    configured_paths = [Path(d).expanduser().resolve() for d in configured_dirs]

    # Check if SEARCH_DIRS has been patched by a test harness (e.g. patch.object(server, 'SEARCH_DIRS', [self.root]))
    is_custom_or_patched = False
    for p in SEARCH_DIRS:
        res = Path(p).expanduser().resolve()
        if res not in DEFAULT_SEARCH_DIRS and res not in configured_paths:
            is_custom_or_patched = True
            break

    if is_custom_or_patched:
        raw = [Path(p).expanduser().resolve() for p in SEARCH_DIRS if Path(p).expanduser().resolve().is_dir()]
        return _prune_nested_roots(raw)

    existing = [p for p in configured_paths if p.is_dir()]
    return _prune_nested_roots(existing)


def format_size(bytes_num: int) -> str:
    """Format bytes to human readable string."""
    for unit in ["B", "KB", "MB", "GB"]:
        if bytes_num < 1024.0:
            return f"{bytes_num:.1f} {unit}" if unit != "B" else f"{bytes_num} B"
        bytes_num /= 1024.0
    return f"{bytes_num:.1f} TB"


def discover_courses():
    roots = get_effective_search_dirs()
    return _catalog.discover(roots)


def course_info(course_name):
    info = discover_courses().get(course_name)
    if info is None:
        raise HTTPException(404, detail='Course not found')
    return info


def resolve_course_path(course_name, relative, directory=False):
    info = course_info(course_name)
    base_path = Path(info['path']).resolve()
    if isinstance(relative, str):
        relative = html.unescape(relative).strip()
    # Normalize self-referencing course directory targets for system actions
    if directory and (not relative or relative == '.' or str(relative).strip() in ('', '.')):
        return base_path
    if directory and isinstance(relative, str) and Path(relative).resolve() == base_path:
        return base_path
    try:
        return safe_path(base_path, relative, directory=directory)
    except ValueError:
        raise HTTPException(403, detail='Access denied: invalid file path')
    except OSError:
        raise HTTPException(404, detail='File not found')


def get_course_data(course_name):
    info = course_info(course_name)
    dependencies = syllabus_dependencies(info)
    key = (_catalog, course_name, info['path'], dependencies, optional_signature(info['blueprint_path']),
           optional_signature(Path(info['path']) / '.file_metadata.json'))
    data = _course_cache.get(key, lambda: render_course(course_name, info))
    # [Codex] Time-dependent status must not share the HTML cache lifetime.
    for assignment in data.get('assignments', []):
        assignment['status'] = calculate_assignment_status(assignment)
    data['grades'].update(calculate_grade_summary(data.get('assignments', [])))
    return data


def syllabus_dependencies(info):
    """[Codex] Contained, versioned physical fallback dependencies."""
    data = raw_course(info, fields=('syllabus', 'file_path_map'))
    syllabus = data.get('syllabus')
    if isinstance(syllabus, dict) and isinstance(syllabus.get('body'), str) and syllabus['body'].strip():
        return ()
    candidates = []
    for relative in data.get('file_path_map', {}).values():
        if not isinstance(relative, str) or Path(relative).name.lower() not in {'syllabus.md', 'syllabus.txt'}:
            continue
        try:
            target = safe_path(info['path'], relative)
            candidates.append((relative, signature(target)))
        except (OSError, ValueError):
            continue
    return tuple(candidates)


def render_course(course_name, info):
    """[Codex] Compile trusted HTML from archived source text, never archived HTML."""
    data = raw_course(info)
    data['_course_meta'] = info
    if not data.get('term') and info.get('term'):
        data['term'] = info.get('term')
    for field in ('announcements', 'assignments'):
        data[field] = [item for item in data.get(field, []) if isinstance(item, dict)]
        for item in data[field]:
            item['body_html'] = ''
            for key in ('body', 'title', 'url', 'author'):
                if not isinstance(item.get(key), str):
                    item[key] = ''
    if isinstance(data.get('syllabus'), dict):
        data['syllabus']['body_html'] = ''
    # Ensure announcements are cleanly sanitized and pre-linked for the offline frontend
    if CourseBlueprint and data.get("announcements"):
        try:
            bp = CourseBlueprint(
                course_name=data.get("course_name", course_name),
                course_url=data.get("course_url", ""),
                output_dir=info.get("path", "")
            )
            bp.announcements = data.get("announcements", [])
            bp.file_path_map = data.get("file_path_map", {})
            bp.clean_announcements()
            metadata = Path(info['path']) / '.file_metadata.json'
            if not metadata.exists() or (not metadata.is_symlink() and metadata.stat().st_size <= 32 * 1024 * 1024):
                bp.link_announcements_to_files()
            data["announcements"] = bp.announcements
        except Exception:
            pass

    # [Codex] Bound aggregate render work as well as individual document size.
    remaining = 2 * 1024 * 1024
    def render_body(body):
        nonlocal remaining
        take = min(len(body), 256 * 1024, remaining)
        remaining -= take
        result = format_markdown(body[:take], file_path_map=file_map, course_name=course_name)
        if take < len(body):
            result += '<p class="preview-truncated">Preview truncated; open the original archive for the remainder.</p>'
        return result

    # Pre-compile body_html for announcements, assignments, and syllabus
    file_map = data.get("file_path_map", {})
    if data.get("announcements"):
        for ann in data["announcements"]:
            if isinstance(ann.get("body"), str):
                ann["body_html"] = render_body(ann["body"])

    if data.get("assignments"):
        for assign in data["assignments"]:
            if isinstance(assign.get("body"), str):
                assign["body_html"] = render_body(assign["body"])
            assign["status"] = calculate_assignment_status(assign)
            # [Codex] Normalize repeated scraper display text once, on the server.
            due_text = assign.get('due') or assign.get('due_date') or ''
            due_text = re.sub(r'^Due\s+', '', due_text, flags=re.I) if isinstance(due_text, str) else ''
            words = due_text.split()
            while len(words) % 2 == 0 and words and words[:len(words)//2] == words[len(words)//2:]:
                words = words[:len(words)//2]
            assign['due_display'] = ' '.join(words)

    # Pre-calculate grade summary metrics
    grades = data.get("grades") if isinstance(data.get("grades"), dict) else {}
    summary = calculate_grade_summary(data.get("assignments", []))
    grades.update(summary)
    data["grades"] = grades

    # Pre-compile syllabus body_html
    if not isinstance(data.get("syllabus"), dict):
        data["syllabus"] = {"body": "", "body_html": ""}
    syl = data["syllabus"]
    syl_body = syl.get("body")
    if not syl_body or not isinstance(syl_body, str) or not syl_body.strip():
        for name, rel_path in file_map.items():
            if isinstance(rel_path, str) and Path(rel_path).name.lower() in ("syllabus.md", "syllabus.txt"):
                try:
                    syl_target = safe_path(info["path"], rel_path)
                    if syl_target.is_file():
                        with syl_target.open(encoding="utf-8", errors="replace") as source:
                            syl_body = source.read(256 * 1024 + 1)
                        syl["body"] = syl_body
                        break
                except Exception:
                    pass
    if isinstance(syl.get("body"), str) and syl["body"].strip():
        clean_syl = syl["body"]
        clean_syl = re.sub(r'^(?:Title|URL):[^\r\n]*(?:\r?\n|$)', '', clean_syl, flags=re.MULTILINE)
        clean_syl = re.sub(r'Course Syllabus\s+Jump to Today', '', clean_syl, flags=re.IGNORECASE)
        clean_syl = re.sub(r'Syllabus\s+Actions', '', clean_syl, flags=re.IGNORECASE)
        clean_syl = re.sub(r'Links to an external site\.', '', clean_syl, flags=re.IGNORECASE)
        syl["body_html"] = render_body(clean_syl.strip())
    else:
        syl["body_html"] = ""

    # For synthesized courses or courses with synthesized modules, enforce clean non-redundant titles and chronological order
    if data.get("is_synthesized") or (data.get("modules") and all(str(m.get("id", "")).startswith(("synth_", "mod_synth_")) for m in data.get("modules", []))):
        try:
            for m in data.get("modules", []):
                if isinstance(m, dict):
                    if m.get("title"):
                        m["title"] = clean_module_title(m["title"], course_name)
                    if isinstance(m.get("items"), list):
                        m["items"].sort(key=lambda it: natural_sort_key(it.get("title", "")))
            data["modules"].sort(key=lambda m: module_category_sort_key(m.get("title", "")))
        except Exception:
            pass

    return data


def scan_physical_folders(course_path: str) -> Dict[str, Any]:
    """Scan the physical folder structure of the course directory."""
    base_path = Path(course_path).resolve()
    if not base_path.exists() or not base_path.is_dir():
        raise HTTPException(status_code=404, detail="Course directory does not exist")
    
    with _folder_lock:
        cached = _folder_cache.get(str(base_path))
        if cached and cached[0] > time.monotonic():
            return copy.deepcopy(cached[1])
    categories = []
    all_files = []
    grouped = {}
    for path, relative, sig in walk_files(base_path):
        grouped.setdefault(str(path.parent), []).append((path.name, sig[2]))
    
    for root, files in grouped.items():
        rel_root = Path(root).relative_to(base_path).as_posix()
        if rel_root == ".":
            display_folder = "Root"
        else:
            display_folder = rel_root
            
        folder_files = []
        for file, size in sorted(files):
            if file.startswith(".") or file == "canvas_course.json":
                continue
            
            full_file_path = Path(root) / file
            rel_file_path = full_file_path.relative_to(base_path).as_posix()
            
            # Skip synthetic meta-files from physical folder catalog
            if is_synthetic_file(file, rel_file_path):
                continue
            ext = full_file_path.suffix.lower()
            
            file_info = {
                "name": file,
                "relative_path": rel_file_path,
                "folder": display_folder,
                "size_bytes": size,
                "size_str": format_size(size),
                "extension": ext,
                "is_pdf": ext == ".pdf",
                "is_image": ext in [".png", ".jpg", ".jpeg", ".gif", ".webp"],
                "is_text": ext in [".txt", ".md", ".py", ".json", ".csv", ".html"],
                "is_presentation": ext in [".pptx", ".ppt", ".key"],
                "is_document": ext in [".docx", ".doc", ".pages"],
            }
            folder_files.append(file_info)
            all_files.append(file_info)
            
        if folder_files:
            categories.append({
                "folder_name": os.path.basename(root) if rel_root != "." else "Root",
                "folder_path": display_folder,
                "file_count": len(folder_files),
                "files": folder_files
            })
            
    result = {
        "categories": categories,
        "total_files": len(all_files),
        "files": all_files
    }

    with _folder_lock:
        if len(_folder_cache) >= 64:
            _folder_cache.pop(next(iter(_folder_cache)))
        _folder_cache[str(base_path)] = (time.monotonic() + 5, result)
    return copy.deepcopy(result)


# Request models
class PreviewRequest(BaseModel):
    file_path: str = Field(min_length=1, max_length=4096)


class SystemActionRequest(BaseModel):
    file_path: str = Field(min_length=0, max_length=4096, default=".")
    action: Literal["open", "reveal"] = "open"  # "open" or "reveal"



@app.get('/api/health')
def api_health():
    """[Codex] Readiness independent of archive enumeration or extraction."""
    return {'status': 'ok'}


@app.get("/api/courses")
def api_list_courses():
    """List all available Canvas archived courses."""
    courses = discover_courses()
    return {"courses": list(courses.values())}


@app.get("/api/courses/{course_name}")
def api_get_course(course_name: str):
    """Get full blueprint data for a specific course and warm up the search index."""
    data = get_course_data(course_name)
    course_path = data["_course_meta"]["path"]
    engine = get_search_engine(course_name, course_path)
    engine.request_index()
    return data


@app.get("/api/courses/{course_name}/search")
def api_search_course(course_name: str, q: str = Query(..., min_length=1, max_length=512)):
    """
    Search course files and curriculum intelligence.
    Returns curriculum matches and ranked document matches.
    """
    courses = discover_courses()
    if course_name not in courses:
        raise HTTPException(status_code=404, detail=f"Course '{course_name}' not found")
    
    course_path = courses[course_name]["path"]
    engine = get_search_engine(course_name, course_path)
    return engine.search(q)


@app.get("/api/courses/{course_name}/folders")
def api_get_course_folders(course_name: str):
    """Get physical desktop folder tree and file categories."""
    courses = discover_courses()
    if course_name not in courses:
        raise HTTPException(status_code=404, detail="Course not found")
    
    course_path = courses[course_name]["path"]
    return scan_physical_folders(course_path)


@app.post("/api/courses/{course_name}/preview-document")
def api_preview_document(course_name: str, req: PreviewRequest):
    """
    Prepares a browser-compatible preview for any course document (PDF, PPTX, image, markdown, text, assignment).
    Performs server-side parsing and rich HTML formatting.
    """
    target_file = resolve_course_path(course_name, req.file_path)
    info = course_info(course_name)
    file_map = raw_course(info, fields=('file_path_map',)).get('file_path_map', {}) if info.get('blueprint_path') else {}
    try:
        stamp = signature(target_file)
        def build():
            result = format_document_preview(target_file=target_file, relative_path=req.file_path,
                course_name=course_name, file_path_map=file_map)
            if signature(target_file) != stamp:
                raise HTTPException(409, detail='Document changed while preparing preview; retry')
            return result
        # Native previews manage their own versioned cache and retry lifecycle.
        if target_file.suffix.lower() in {'.ppt', '.pptx', '.doc', '.key', '.pages'}:
            return build()
        return _preview_cache.get((str(target_file), stamp, course_name, req.file_path,
            optional_signature(info['blueprint_path']) if info.get('blueprint_path') else None), build)
    except OSError:
        raise HTTPException(404, detail='Document is no longer readable')


@app.api_route("/api/courses/{course_name}/files/{file_path:path}", methods=["GET", "HEAD"])
def api_serve_file(course_name: str, file_path: str):
    """
    Stream a course file with appropriate headers for browser preview.
    Validates path security against directory traversal.
    """
    target_file = resolve_course_path(course_name, file_path)
    mime_type, _ = mimetypes.guess_type(str(target_file))
    if not mime_type:
        mime_type = "application/octet-stream"
        
    return FileResponse(
        path=str(target_file),
        media_type=mime_type,
        filename=target_file.name,
        content_disposition_type="inline",
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
        }
    )


@app.post("/api/courses/{course_name}/open-system")
def api_open_system(course_name: str, req: SystemActionRequest):
    """
    Open in the default application or reveal in the native file manager.
    """
    target_path = resolve_course_path(course_name, req.file_path, directory=True)
    try:
        open_path(target_path, req.action)
            
        return {"success": True, "path": str(target_path), "action": req.action}
    except PermissionError:
        raise HTTPException(status_code=403, detail="File type cannot be opened directly; reveal it in the file manager")
    except (OSError, subprocess.SubprocessError):
        raise HTTPException(status_code=500, detail="Failed to open with the system")


@app.get('/api/courses/{course_name}/search/status')
def api_search_status(course_name: str):
    engine = get_search_engine(course_name, course_info(course_name)['path'])
    engine.request_index()
    return engine.status()


@app.post('/api/courses/{course_name}/search/rebuild', status_code=202)
def api_rebuild_search(course_name: str):
    engine = get_search_engine(course_name, course_info(course_name)['path'])
    return engine.request_index(force=True)


@app.get("/api/courses/{course_name}/file-info")
def api_file_info(course_name: str, path: str = Query(..., min_length=1, max_length=4096)):
    """
    Returns detailed file metadata, page/slide counts, text stats, and blueprint categorization.
    """
    target_file = resolve_course_path(course_name, path)
    if not target_file.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    try:
        stamp = signature(target_file)
        st = target_file.stat()
    except OSError:
        raise HTTPException(404, detail='File is no longer readable')
    ext = target_file.suffix.lower()
    mime_type, _ = mimetypes.guess_type(str(target_file))
    if not mime_type:
        mime_type = "application/octet-stream"

    # Supported extraction formats
    is_extractable = ext in {".pdf", ".pptx", ".docx", ".txt", ".md", ".csv", ".html"}

    def probe():
        try:
            result = probe_file(target_file)
            if signature(target_file) != stamp:
                raise HTTPException(409, detail='File changed while reading metadata; retry')
            return result
        except OSError:
            raise HTTPException(404, detail='File is no longer readable')
    stats = _info_cache.get((str(target_file), stamp), probe)
    rel_path_str = target_file.relative_to(Path(course_info(course_name)['path']).resolve()).as_posix()
    parent_folder = target_file.parent.name if target_file.parent != target_file else ""
    file_url = '/api/courses/' + quote(course_name, safe='') + '/files/' + quote(rel_path_str, safe='/')

    return {
        "name": target_file.name,
        "relative_path": rel_path_str,
        "url": file_url,
        "extension": ext,
        "mime_type": mime_type,
        "size_bytes": st.st_size,
        "formatted_size": format_size(st.st_size),
        "modified_at": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
        "is_extractable": is_extractable,
        **stats,
        "category": parent_folder
    }


@app.get("/api/courses/{course_name}/timeline")
def api_get_course_timeline(
    course_name: str,
    type: Optional[str] = Query(None, description="Filter by event type (assignment, announcement, quiz, exam)"),
    status: Optional[str] = Query(None, description="Filter by status (upcoming, past, missing, submitted, unsubmitted)"),
    group: Optional[str] = Query(None, description="Filter by assignment group name"),
    q: Optional[str] = Query(None, min_length=1, max_length=256, description="Search keyword in title or details"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0)
):
    """
    Returns enriched, filterable chronological timeline events and summary metrics for a course.
    """
    records = raw_course(course_info(course_name), fields=('timeline',)).get('timeline', [])
    return project_timeline(course_name, records, type=type, status=status, group=group, q=q, limit=limit, offset=offset)


# [Codex] Credential settings reuse the downloader's configuration without exposing keys.
_GEMINI_CONFIG_PATH = Path(__file__).resolve().parent.parent / "Canvas Module Downloader" / "config.json"
_gemini_config_lock = threading.Lock()


def _read_gemini_config():
    if not _GEMINI_CONFIG_PATH.exists():
        example_path = _GEMINI_CONFIG_PATH.with_name("config.example.json")
        if example_path.exists():
            import shutil
            shutil.copyfile(example_path, _GEMINI_CONFIG_PATH)
            try:
                _GEMINI_CONFIG_PATH.chmod(0o600)
            except Exception:
                pass
    try:
        content = _GEMINI_CONFIG_PATH.read_bytes()
        config = json.loads(content)
        if not isinstance(config, dict):
            raise ValueError()
        return config, content
    except (OSError, ValueError):
        raise HTTPException(503, detail="Downloader configuration is unavailable") from None


@app.get("/api/settings/gemini-key")
def get_gemini_key_status():
    with _gemini_config_lock:
        config, _ = _read_gemini_config()
        key = config.get("gemini_api_key") or os.environ.get("GEMINI_API_KEY")
        tier = config.get("gemini_tier", "paid")
        return {
            "configured": isinstance(key, str) and bool(key.strip()),
            "tier": tier if tier in ("free", "paid") else "paid"
        }


class GeminiTierRequest(BaseModel):
    tier: str


@app.put("/api/settings/gemini-tier")
async def update_gemini_tier(req: GeminiTierRequest):
    tier = req.tier.strip().lower()
    if tier not in ("free", "paid"):
        raise HTTPException(400, detail="tier must be 'free' or 'paid'")
    return await asyncio.to_thread(_store_gemini_settings, tier=tier)


def _update_config_values(values):
    """[Codex] One atomic owner-only writer for all non-course configuration."""
    import tempfile
    temporary = None
    with _gemini_config_lock:
        config, original = _read_gemini_config()
        config.update(values)
        try:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=_GEMINI_CONFIG_PATH.parent,
                                             prefix='.settings-', delete=False) as stream:
                temporary = Path(stream.name)
                os.chmod(temporary, 0o600)
                json.dump(config, stream, indent=2, ensure_ascii=False)
                stream.write('\n')
                stream.flush()
                os.fsync(stream.fileno())
            if _GEMINI_CONFIG_PATH.read_bytes() != original:
                raise HTTPException(409, detail='Configuration changed; retry saving settings')
            os.replace(temporary, _GEMINI_CONFIG_PATH)
            temporary = None
        except OSError:
            raise HTTPException(503, detail='Could not save configuration') from None
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    return config


def _store_gemini_settings(key=None, tier=None):
    values = {}
    if key is not None and str(key).strip():
        values['gemini_api_key'] = str(key).strip()
    if tier is not None and str(tier).strip().lower() in ('free', 'paid'):
        values['gemini_tier'] = str(tier).strip().lower()
    config = _update_config_values(values)
    result = {'configured': True}
    if tier is not None:
        result['tier'] = config.get('gemini_tier', 'paid')
    return result


def _store_gemini_key(key):
    return _store_gemini_settings(key=key)


@app.put("/api/settings/gemini-key")
async def update_gemini_key(request: Request):
    # Parse explicitly so framework validation errors never echo a credential.
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        raise HTTPException(415, detail="JSON content required")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 4096:
            raise HTTPException(413, detail="Request too large")
    try:
        payload = json.loads(body)
    except (ValueError, UnicodeError):
        raise HTTPException(400, detail="Invalid key request") from None
    key = payload.get("api_key") if isinstance(payload, dict) else None
    if not isinstance(key, str) or not 1 <= len(key) <= 512 or not key.isascii() or any(c.isspace() or ord(c) < 33 or ord(c) == 127 for c in key):
        raise HTTPException(400, detail="Enter a valid API key without whitespace")
    return await asyncio.to_thread(_store_gemini_key, key)


def _probe_ollama():
    import urllib.request
    for url in ("http://localhost:11434/api/tags", "http://127.0.0.1:11434/api/tags"):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "CanvasApp"})
            with urllib.request.urlopen(req, timeout=1.5) as response:
                if response.status == 200:
                    data = json.loads(response.read().decode("utf-8"))
                    models = [m.get("name") for m in data.get("models", []) if m.get("name")]
                    return {"running": True, "installed_models": models}
        except Exception:
            continue
    return {"running": False, "installed_models": []}


@app.get("/api/settings/ollama-status")
async def get_ollama_status():
    return await asyncio.to_thread(_probe_ollama)


# [Codex] The private directory is created by previews.py for this server run.
_SLIDE_PREVIEWS_CACHE_DIR = PREVIEW_CACHE_DIR


@app.get("/api/settings/cache-status")
def get_cache_status():
    file_count = 0
    total_bytes = 0
    if (_SLIDE_PREVIEWS_CACHE_DIR.is_dir()
            and not _SLIDE_PREVIEWS_CACHE_DIR.is_symlink()):
        for root, _, files in os.walk(_SLIDE_PREVIEWS_CACHE_DIR):
            for f in files:
                fp = Path(root) / f
                try:
                    if not fp.is_symlink():
                        total_bytes += fp.stat().st_size
                    file_count += 1
                except OSError:
                    pass
    return {
        "file_count": file_count,
        "byte_size": total_bytes,
        "formatted_size": formatting.format_file_size(total_bytes),
        "preview_available": sys.platform == 'darwin'
    }


@app.post("/api/settings/cache-clear")
def clear_cache():
    freed_bytes = 0
    # Serialise with Quick Look publication and pruning so clearing cannot
    # remove a work directory while a preview is being generated.
    with _PREVIEW_CACHE_LOCK:
        # Refuse a replaced root instead of traversing an arbitrary target.
        if _SLIDE_PREVIEWS_CACHE_DIR.is_symlink():
            raise HTTPException(409, detail="Preview cache path is a symlink")
        if _SLIDE_PREVIEWS_CACHE_DIR.is_dir():
            for root, dirs, files in os.walk(_SLIDE_PREVIEWS_CACHE_DIR, topdown=False):
                for f in files:
                    fp = Path(root) / f
                    try:
                        sz = fp.stat().st_size if not fp.is_symlink() else 0
                        fp.unlink(missing_ok=True)
                        freed_bytes += sz
                    except OSError:
                        pass
                for d in dirs:
                    dp = Path(root) / d
                    try:
                        if dp.is_symlink():
                            dp.unlink()
                        else:
                            dp.rmdir()
                    except OSError:
                        pass
    return {
        "freed_bytes": freed_bytes,
        "freed_size": formatting.format_file_size(freed_bytes)
    }


class DirectoriesSettingsRequest(BaseModel):
    search_dirs: List[str]
    default_dir: Optional[str] = None


class ImportCourseRequest(BaseModel):
    course_path: str


class BrowseDirectoryRequest(BaseModel):
    prompt: Optional[str] = "Select Course Directory"


class ScanLegacyCoursesRequest(BaseModel):
    root_path: Optional[str] = None
    max_depth: Optional[int] = 4


class SynthesizeCourseRequest(BaseModel):
    course_path: str
    course_name: Optional[str] = None
    term: Optional[str] = None


def _store_directories_settings(search_dirs: List[str], default_dir: str):
    _update_config_values({'search_dirs': list(search_dirs), 'default_course_dir': str(default_dir)})

    global SEARCH_DIRS
    SEARCH_DIRS.clear()
    SEARCH_DIRS.extend([Path(d).expanduser().resolve() for d in search_dirs])
    with _folder_lock:
        _folder_cache.clear()
    with _catalog.lock:
        _catalog.roots = None
        _catalog.expires = 0
    _course_cache.clear()


@app.get("/api/settings/directories")
def get_directories_settings():
    search_dirs, default_dir = _read_configured_directories()
    courses = discover_courses()

    courses_by_dir: Dict[str, List[str]] = {d: [] for d in search_dirs}
    for name, c_info in courses.items():
        try:
            c_path = Path(c_info.get("path", "")).resolve()
            parent_path = c_path.parent
            parent_display = _to_display_path(parent_path)
            matched = False
            for d in search_dirs:
                d_resolved = Path(d).expanduser().resolve()
                if c_path == d_resolved or c_path.is_relative_to(d_resolved):
                    if name not in courses_by_dir[d]:
                        courses_by_dir[d].append(name)
                    matched = True
                    break
            if not matched:
                if parent_display not in courses_by_dir:
                    courses_by_dir[parent_display] = []
                if name not in courses_by_dir[parent_display]:
                    courses_by_dir[parent_display].append(name)
        except Exception:
            pass

    return {
        "search_dirs": search_dirs,
        "default_dir": default_dir,
        "courses_by_dir": courses_by_dir
    }


@app.put("/api/settings/directories")
def update_directories_settings(req: DirectoriesSettingsRequest):
    normalized_display_dirs = []
    for raw in req.search_dirs:
        if not isinstance(raw, str) or not raw.strip():
            continue
        clean = raw.strip()
        p = Path(clean).expanduser().resolve()
        if not p.is_dir():
            raise HTTPException(400, detail=f"Directory does not exist or is not a directory: {clean}")
        disp = _to_display_path(p)
        if disp not in normalized_display_dirs:
            normalized_display_dirs.append(disp)

    if req.search_dirs and not normalized_display_dirs:
        raise HTTPException(400, detail="No valid directory paths provided")

    previous_default = _read_configured_directories()[1]
    raw_def = req.default_dir.strip() if req.default_dir and isinstance(req.default_dir, str) and req.default_dir.strip() else (normalized_display_dirs[0] if normalized_display_dirs else previous_default)
    p_def = Path(raw_def).expanduser().resolve()
    if not p_def.is_dir():
        raise HTTPException(400, detail=f"Default directory does not exist or is not a directory: {raw_def}")
    default_display = _to_display_path(p_def)
    # The destination for new downloads is independent of discovery roots.
    # Re-adding it here made the UI's Remove action appear to do nothing.

    _store_directories_settings(normalized_display_dirs, default_display)
    return {
        "success": True,
        "search_dirs": normalized_display_dirs,
        "default_dir": default_display
    }


@app.post("/api/settings/directories/scan")
def scan_directories():
    with _folder_lock:
        _folder_cache.clear()
    with _catalog.lock:
        _catalog.roots = None
        _catalog.expires = 0
    _course_cache.clear()

    courses = discover_courses()
    effective_dirs = get_effective_search_dirs()
    return {
        "success": True,
        "course_count": len(courses),
        "directories_scanned": len(effective_dirs)
    }


@app.post("/api/settings/directories/browse")
def browse_directory(req: Optional[BrowseDirectoryRequest] = None):
    """Choose a folder with the host operating system's native dialog."""
    prompt_text = "Select Course Directory"
    if req and req.prompt and req.prompt.strip():
        prompt_text = req.prompt.strip()

    try:
        p = choose_directory(prompt_text)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Folder selection dialog timed out")
    except (OSError, RuntimeError):
        raise HTTPException(status_code=500, detail="Failed to launch native folder dialog")

    if p is None:
        return {"success": True, "canceled": True}

    if not p.is_dir():
        raise HTTPException(status_code=400, detail="Selected path is not a directory")

    return {
        "success": True,
        "path": str(p),
        "display_path": _to_display_path(p)
    }


@app.post("/api/settings/directories/import")
def import_course_directory(req: ImportCourseRequest):
    if not req.course_path or not req.course_path.strip():
        raise HTTPException(400, detail="course_path is required")

    target = Path(req.course_path.strip()).expanduser().resolve()
    if not target.exists() or not target.is_dir():
        raise HTTPException(400, detail=f"Course path does not exist or is not a directory: {req.course_path}")

    # Validate that target contains canvas_course.json in standard layout
    hierarchy = _read_hierarchy_config()
    lectures_template = hierarchy.get("lectures_folder", "{course} Lectures & Resources")
    custom_sub = lectures_template.replace("{course}", target.name).strip() if lectures_template else f"{target.name} Lectures & Resources"
    bp_file = None
    bp_candidates = [
        target / "canvas_course.json",
        target / custom_sub / "canvas_course.json",
        target / f"{target.name} Lectures & Resources" / "canvas_course.json",
        target / "Lectures" / "canvas_course.json",
    ]
    for c in bp_candidates:
        if c.is_file():
            bp_file = c
            break

    # A blueprint in an arbitrary child belongs to that child course. Treat
    # its parent (Desktop, a quarter folder, or an archive vault) as a scan
    # root rather than importing it as one course and adding its parent.
    if not bp_file:
        try:
            if any(sub.is_dir() and not sub.is_symlink() and
                   (sub / 'canvas_course.json').is_file()
                   for sub in target.iterdir()):
                raise HTTPException(400, detail='Selected folder contains course folders; add it as a scan root')
        except OSError:
            pass

    synthesized = False
    if not bp_file:
        # Automatically synthesize a blueprint for this unindexed / legacy course folder
        # if it qualifies as an academic course candidate
        try:
            from archive import _is_legacy_course_candidate
        except ImportError:
            from .archive import _is_legacy_course_candidate

        if _is_legacy_course_candidate and _is_legacy_course_candidate(target) and synthesize_course_blueprint:
            try:
                synthesize_course_blueprint(target, save=True)
                for c in bp_candidates:
                    if c.is_file():
                        bp_file = c
                        synthesized = True
                        break
            except Exception as e:
                raise HTTPException(400, detail=f"Failed to synthesize course blueprint: {e}")

    if not bp_file or not bp_file.is_file():
        raise HTTPException(400, detail=f"No canvas_course.json blueprint found in {target}")

    course_name = target.name
    try:
        with open(bp_file, "r", encoding="utf-8") as f:
            bp_data = json.load(f)
        if isinstance(bp_data, dict) and bp_data.get("course_name"):
            course_name = str(bp_data["course_name"]).strip()
    except Exception:
        pass

    parent_dir = target.parent
    parent_display = _to_display_path(parent_dir)

    search_dirs, default_dir = _read_configured_directories()
    parent_resolved = parent_dir.resolve()
    already_present = any(
        (target == Path(d).expanduser().resolve() or target.is_relative_to(Path(d).expanduser().resolve()))
        for d in search_dirs
    )
    if not already_present:
        search_dirs.append(parent_display)
        _store_directories_settings(search_dirs, default_dir)

    with _folder_lock:
        _folder_cache.clear()
    with _catalog.lock:
        _catalog.roots = None
        _catalog.expires = 0
    _course_cache.clear()
    discover_courses()

    return {
        "success": True,
        "course_name": course_name,
        "parent_dir": parent_display,
        "synthesized": synthesized
    }


@app.post("/api/settings/courses/scan-legacy")
def api_scan_legacy_courses(req: Optional[ScanLegacyCoursesRequest] = None):
    """
    Scans a given directory path or all configured search roots for folders that look
    like courses but lack a canvas_course.json blueprint.
    """
    try:
        from archive import _is_legacy_course_candidate, _find_course_blueprint_in_folder, extract_course_term, IGNORED_DIR_NAMES
    except ImportError:
        from .archive import _is_legacy_course_candidate, _find_course_blueprint_in_folder, extract_course_term, IGNORED_DIR_NAMES
    
    roots_to_scan: List[Path] = []
    if req and req.root_path and req.root_path.strip():
        p = Path(req.root_path.strip()).expanduser().resolve()
        if not p.is_dir():
            raise HTTPException(400, detail=f"Directory does not exist: {req.root_path}")
        roots_to_scan.append(p)
    else:
        roots_to_scan = get_effective_search_dirs()

    max_depth = req.max_depth if req and req.max_depth and 1 <= req.max_depth <= 6 else 4
    candidates = []
    seen_paths = set()

    for root in roots_to_scan:
        if not root.is_dir():
            continue
        queue = collections.deque([(root, 0)])
        while queue:
            curr_dir, depth = queue.popleft()
            if curr_dir != root:
                curr_res = curr_dir.resolve()
                if curr_res in seen_paths:
                    continue
                seen_paths.add(curr_res)

                # If already has a blueprint, do not treat as legacy candidate and don't traverse inside
                if _find_course_blueprint_in_folder(curr_dir):
                    continue

                if _is_legacy_course_candidate(curr_dir):
                    # Gather details
                    inferred_name = infer_course_name_from_folder(curr_dir.name) if infer_course_name_from_folder else curr_dir.name
                    term = extract_course_term({}, curr_dir)
                    subfolders = []
                    course_files = []
                    has_syl = False
                    try:
                        for item in curr_dir.iterdir():
                            if item.name.startswith("."):
                                continue
                            if item.is_dir() and not item.is_symlink():
                                subfolders.append(item.name)
                            elif item.is_file():
                                course_files.append(item.name)
                                if "syllabus" in item.name.lower():
                                    has_syl = True
                    except OSError:
                        pass

                    candidates.append({
                        "path": str(curr_res),
                        "display_path": _to_display_path(curr_res),
                        "folder_name": curr_dir.name,
                        "inferred_name": inferred_name,
                        "detected_term": term,
                        "file_count": len(course_files),
                        "has_syllabus": has_syl,
                        "subfolders": sorted(subfolders)
                    })
                    # Do not traverse further into an identified course folder
                    continue

            if depth < max_depth:
                try:
                    for child in curr_dir.iterdir():
                        if child.is_dir() and not child.is_symlink():
                            if not child.name.startswith(".") and child.name.lower() not in IGNORED_DIR_NAMES:
                                queue.append((child, depth + 1))
                except OSError:
                    pass

    return {
        "success": True,
        "count": len(candidates),
        "candidates": candidates
    }


@app.post("/api/settings/courses/synthesize")
def api_synthesize_course(req: SynthesizeCourseRequest):
    """
    Explicitly synthesizes a canvas_course.json blueprint for any target folder on disk,
    optionally overriding course name and academic term, and refreshes the course catalog.
    """
    if not req.course_path or not req.course_path.strip():
        raise HTTPException(400, detail="course_path is required")

    target = Path(req.course_path.strip()).expanduser().resolve()
    if not target.is_dir():
        raise HTTPException(400, detail=f"Target path does not exist or is not a directory: {req.course_path}")

    if not synthesize_course_blueprint:
        raise HTTPException(500, detail="Synthesizer engine is not available")

    try:
        synth_bp = synthesize_course_blueprint(
            course_dir=target,
            course_name=req.course_name.strip() if req.course_name and req.course_name.strip() else None,
            term=req.term.strip() if req.term and req.term.strip() else None,
            save=True
        )
    except Exception as e:
        raise HTTPException(400, detail=f"Failed to synthesize course blueprint: {e}")

    # Ensure parent dir is in search_dirs if not already
    parent_dir = target.parent
    parent_display = _to_display_path(parent_dir)
    search_dirs, default_dir = _read_configured_directories()
    already_present = any(
        (target == Path(d).expanduser().resolve() or target.is_relative_to(Path(d).expanduser().resolve()))
        for d in search_dirs
    )
    if not already_present:
        search_dirs.append(parent_display)
        _store_directories_settings(search_dirs, default_dir)

    # Invalidate catalog caches
    with _folder_lock:
        _folder_cache.clear()
    with _catalog.lock:
        _catalog.roots = None
        _catalog.expires = 0
    _course_cache.clear()
    discover_courses()

    return {
        "success": True,
        "course_name": synth_bp.course_name,
        "path": str(target),
        "term": getattr(synth_bp, "term", None),
        "file_count": len(synth_bp.file_path_map),
        "modules_count": len(synth_bp.modules)
    }


DEFAULT_CUSTOM_FOLDERS: List[Dict[str, Any]] = [
    {"id": "folder_slides", "name": "Lecture Slides", "parent": "study_materials", "types": ["slides", "lectures"]},
    {"id": "folder_solutions", "name": "Homework Solutions", "parent": "study_materials", "types": ["solutions", "keys"]},
    {"id": "folder_worksheets", "name": "Discussion Worksheets", "parent": "study_materials", "types": ["discussions", "worksheets"]},
    {"id": "folder_exams", "name": "Exams & Quizzes", "parent": "study_materials", "types": ["exams", "quizzes"]},
    {"id": "folder_syllabus", "name": "Syllabus & Admin", "parent": "study_materials", "types": ["syllabus", "admin"]},
    {"id": "folder_other", "name": "Other Materials", "parent": "study_materials", "types": ["other", "reference"]},
    {"id": "folder_assignments", "name": "Assignments", "parent": "student_work", "types": ["assignments", "homework"]},
    {"id": "folder_quizzes", "name": "Quizzes", "parent": "student_work", "types": ["student_quizzes"]},
]

DEFAULT_MAIN_FOLDERS: List[Dict[str, Any]] = [
    {"id": "main_lectures", "name": "{course} Lectures & Resources", "role": "study_materials"},
    {"id": "main_work", "name": "{course} Work", "role": "student_work"},
]


DEFAULT_HIERARCHY_CONFIG: Dict[str, Any] = {
    "preset": "standard",
    "lectures_folder": "{course} Lectures & Resources",
    "enable_work_folder": True,
    "work_folder": "{course} Work",
    "timeline_file": "{course} Assignments_and_Milestones_Timeline.md",
    "categorization_style": "standard",
    "custom_folders": DEFAULT_CUSTOM_FOLDERS,
    "main_folders": DEFAULT_MAIN_FOLDERS,
}


def _validate_folder_component(value):
    """[Codex] Folder templates must remain one visible path component."""
    if (not isinstance(value, str) or not value.strip() or value.strip().startswith('.')
            or len(value) > 240 or any(c in value for c in '/\\:*?"<>|')
            or any(ord(c) < 32 or ord(c) == 127 for c in value)):
        raise HTTPException(400, detail='Folder names must be a single visible path component')
    if os.name == 'nt' and (value.rstrip(' .') != value or
                            re.match(r'(?i)^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', value)):
        raise HTTPException(400, detail='Folder name is reserved on Windows')
    return value.strip()


class HierarchySettingsRequest(BaseModel):
    preset: Literal["standard", "unified", "compact", "custom"] = "standard"
    lectures_folder: str = Field(default="{course} Lectures & Resources", min_length=1)
    enable_work_folder: bool = True
    work_folder: str = "{course} Work"
    timeline_file: str = "{course} Assignments_and_Milestones_Timeline.md"
    categorization_style: Literal["standard", "prefixed", "minimal"] = "standard"
    custom_folders: Optional[List[Dict[str, Any]]] = None
    main_folders: Optional[List[Dict[str, Any]]] = None


def _read_hierarchy_config() -> Dict[str, Any]:
    try:
        config, _ = _read_gemini_config()
        stored = config.get("disk_hierarchy")
        if isinstance(stored, dict):
            res = dict(DEFAULT_HIERARCHY_CONFIG)
            res.update({k: v for k, v in stored.items() if k in DEFAULT_HIERARCHY_CONFIG})
            if "main_folders" not in stored or not stored.get("main_folders"):
                res["main_folders"] = [
                    {"id": "main_lectures", "name": res.get("lectures_folder") or "{course} Lectures & Resources", "role": "study_materials"},
                    {"id": "main_work", "name": res.get("work_folder") or "{course} Work", "role": "student_work"},
                ]
            return res
    except Exception:
        pass
    return dict(DEFAULT_HIERARCHY_CONFIG)


def _store_hierarchy_settings(hierarchy_dict: Dict[str, Any]):
    if hierarchy_dict.get("custom_folders") is None:
        hierarchy_dict["custom_folders"] = list(DEFAULT_CUSTOM_FOLDERS)
    if hierarchy_dict.get("main_folders") is None:
        hierarchy_dict["main_folders"] = [
            {"id": "main_lectures", "name": hierarchy_dict.get("lectures_folder") or "{course} Lectures & Resources", "role": "study_materials"},
            {"id": "main_work", "name": hierarchy_dict.get("work_folder") or "{course} Work", "role": "student_work"},
        ]
    else:
        mfs = hierarchy_dict["main_folders"]
        if isinstance(mfs, list) and len(mfs) > 0 and isinstance(mfs[0], dict):
            first_name = str(mfs[0].get("name", "")).strip()
            if first_name:
                hierarchy_dict["lectures_folder"] = first_name
        if isinstance(mfs, list) and len(mfs) > 1 and isinstance(mfs[1], dict):
            second_name = str(mfs[1].get("name", "")).strip()
            if second_name:
                hierarchy_dict["work_folder"] = second_name
    _update_config_values({'disk_hierarchy': dict(hierarchy_dict)})

    with _folder_lock:
        _folder_cache.clear()
    with _catalog.lock:
        _catalog.roots = None
        _catalog.expires = 0
    _course_cache.clear()


@app.get("/api/settings/hierarchy")
def get_hierarchy_settings():
    """Returns the configured on-disk hierarchy templates from config.json."""
    hierarchy = _read_hierarchy_config()
    return {
        "ok": True,
        "disk_hierarchy": hierarchy
    }


@app.put("/api/settings/hierarchy")
def update_hierarchy_settings(req: HierarchySettingsRequest):
    """Validates and persists disk hierarchy configuration atomically to config.json."""
    if req.main_folders is not None:
        if not isinstance(req.main_folders, list) or len(req.main_folders) == 0:
            raise HTTPException(400, detail="main_folders must contain at least one folder")
        for mf in req.main_folders:
            if not isinstance(mf, dict) or not str(mf.get("name", "")).strip():
                raise HTTPException(400, detail="Each main folder must have a non-empty name")
    data = req.model_dump() if hasattr(req, "model_dump") else req.dict()
    for key in ('lectures_folder', 'work_folder', 'timeline_file'):
        if key == 'work_folder' and not data.get('enable_work_folder') and not data[key]:
            continue
        _validate_folder_component(data[key])
    for key in ('main_folders', 'custom_folders'):
        for folder in data.get(key) or []:
            if not isinstance(folder, dict):
                raise HTTPException(400, detail='Invalid folder entry')
            _validate_folder_component(folder.get('name'))
    if data.get("custom_folders") is None:
        data["custom_folders"] = list(DEFAULT_CUSTOM_FOLDERS)
    if data.get("main_folders") is not None:
        mfs = data["main_folders"]
        if isinstance(mfs, list) and len(mfs) > 0 and isinstance(mfs[0], dict):
            first_name = str(mfs[0].get("name", "")).strip()
            if first_name:
                data["lectures_folder"] = first_name
        if isinstance(mfs, list) and len(mfs) > 1 and isinstance(mfs[1], dict):
            second_name = str(mfs[1].get("name", "")).strip()
            if second_name:
                data["work_folder"] = second_name
        data["enable_work_folder"] = len(mfs) > 1
    else:
        data["main_folders"] = [
            {"id": "main_lectures", "name": data.get("lectures_folder") or "{course} Lectures & Resources", "role": "study_materials"},
            {"id": "main_work", "name": data.get("work_folder") or "{course} Work", "role": "student_work"},
        ]
    _store_hierarchy_settings(data)
    return {
        "ok": True,
        "disk_hierarchy": data
    }


# --- Course Ingestion Launcher Daemon & Streaming Endpoints ---

class LauncherStartRequest(BaseModel):
    course_url: str = Field(default="", max_length=4096)
    course_name: str = Field(max_length=240)
    ai_provider: Literal["gemini", "ollama", "rules"] = "gemini"
    gemini_tier: Optional[str] = None
    ollama_model: Optional[str] = Field(default="qwen2.5:7b", max_length=200)
    headless: bool = True
    categories: List[str] = Field(default_factory=list)
    gradescope_url: Optional[str] = Field(default="", max_length=4096)
    mode: Literal["full", "organize_only", "gradescope_only"] = "full"
    output_dir: Optional[str] = Field(default=None, max_length=4096)


_launcher_jobs: Dict[str, Dict[str, Any]] = {}
_launcher_lock = threading.Lock()
_TEST_LAUNCHER_RUNNER = None


def _broadcast_launcher_event(job: dict, event: dict):
    event = dict(event)
    # Progress belongs to the whole job, including repeated crawler phases.
    if event.get("type") == "step" and isinstance(event.get("pct"), (int, float)):
        event["pct"] = max(job.get("progress_pct", 0), min(100, max(0, event["pct"])))
        job["progress_pct"] = event["pct"]
    if isinstance(event.get('message'), str):
        event['message'] = event['message'][:8192]
    job["events"].append(event)
    if len(job['events']) > 1000:
        del job['events'][:-1000]
    for q in list(job.get("subscribers", set())):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            # Keep consumers bounded and preserve the newest terminal event.
            q.get_nowait()
            q.put_nowait(event)


async def _run_launcher_daemon(job: dict, req: LauncherStartRequest):
    """[Codex] A job owns its child processes for its entire lifetime."""
    try:
        if not job.get('cancelled'):
            await _run_launcher_body(job, req)
    except asyncio.CancelledError:
        job['cancelled'] = True
        job['status'] = 'cancelled'
        raise
    except Exception:
        job['status'] = 'error'
        _broadcast_launcher_event(job, {'type': 'error', 'message': 'Pipeline failed safely; check course inputs.'})
    finally:
        proc = job.get('process')
        if proc is not None:
            await terminate_pipeline_process(proc)


async def _run_launcher_body(job: dict, req: LauncherStartRequest):
    if _TEST_LAUNCHER_RUNNER is not None:
        try:
            await _TEST_LAUNCHER_RUNNER(job, req)
        except Exception as e:
            job["status"] = "error"
            _broadcast_launcher_event(job, {"type": "error", "message": str(e)})
        return

    workspace_root = Path(__file__).resolve().parent.parent
    cmd_dir = workspace_root / "Canvas Module Downloader"
    main_py = cmd_dir / "main.py"

    _broadcast_launcher_event(job, {
        "type": "log",
        "message": f"Initiating pipeline daemon for '{job['course_name']}' in '{req.mode}' mode...",
        "level": "info"
    })
    if req.mode == "organize_only":
        job["active_step"] = 3
        _broadcast_launcher_event(job, {
            "type": "step",
            "step": 3,
            "pct": 50,
            "phase_title": "AI Classification & Sorting",
            "message": "Starting local file organization & classification..."
        })
    elif req.mode == "gradescope_only":
        job["active_step"] = 2
        _broadcast_launcher_event(job, {
            "type": "step",
            "step": 2,
            "pct": 35,
            "phase_title": "Gradescope Synchronization",
            "message": "Starting headless Gradescope sync..."
        })
    else:
        job["active_step"] = 1
        _broadcast_launcher_event(job, {
            "type": "step",
            "step": 1,
            "pct": 10,
            "phase_title": "Authentication & Session",
            "message": "Verifying Canvas session..."
        })

    if not main_py.exists():
        job["status"] = "error"
        _broadcast_launcher_event(job, {
            "type": "error",
            "message": f"Ingestion CLI not found at {main_py}"
        })
        return

    venv_subpath = Path('Scripts/python.exe') if os.name == 'nt' else Path('bin/python')
    venv_python = workspace_root / 'venv' / venv_subpath
    if not venv_python.exists():
        venv_python = workspace_root / '.venv' / venv_subpath
    python_bin = str(venv_python) if venv_python.exists() else sys.executable

    cmd_args = [
        python_bin,
        str(main_py),
        "--course", job["course_name"]
    ]
    if req.course_url:
        cmd_args += ["--url", req.course_url]

    output_root = None
    if req.output_dir and str(req.output_dir).strip():
        output_root = str(Path(req.output_dir).expanduser().resolve())
    else:
        _, configured_default = _read_configured_directories()
        if configured_default:
            output_root = str(Path(configured_default).expanduser().resolve())

    if output_root:
        cmd_args += ["--output-dir", output_root]

    hierarchy = _read_hierarchy_config()
    lectures_template = hierarchy.get("lectures_folder", "{course} Lectures & Resources")
    custom_subfolder = lectures_template.replace("{course}", job["course_name"]).strip()
    if not custom_subfolder:
        custom_subfolder = f"{job['course_name']} Lectures & Resources"

    cmd_args += ["--subfolder", custom_subfolder]

    if req.mode == "organize_only":
        cmd_args += ["--action", "3"]
    elif req.mode == "gradescope_only":
        cmd_args += ["--action", "4"]
        if req.gradescope_url:
            cmd_args += ["--gradescope", req.gradescope_url]
    else:
        cmd_args += ["--action", "1"]

    if req.ai_provider == "ollama":
        cmd_args += ["--provider", "ollama"]
        if req.ollama_model:
            cmd_args += ["--model", req.ollama_model]
    elif req.ai_provider == "rules":
        cmd_args += ["--provider", "rules"]
    elif req.ai_provider == "gemini":
        cmd_args += ["--provider", "gemini"]
        if req.gemini_tier:
            cmd_args += ["--tier", req.gemini_tier.strip().lower()]

    if req.headless:
        cmd_args.append("--headless")

    if req.categories:
        valid_cats = [c.strip().lower() for c in req.categories if isinstance(c, str) and c.strip().lower() in ALL_CATEGORY_KEYS]
        if valid_cats:
            cmd_args += ["--categories", ",".join(valid_cats)]

    env = dict(os.environ)
    env["PYTHONUNBUFFERED"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    if venv_python.exists():
        env["VIRTUAL_ENV"] = str(venv_python.parent.parent)
        env["PATH"] = f"{venv_python.parent}:{env.get('PATH', '')}"

    try:
        proc = await start_pipeline_process(
            job, *cmd_args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=env,
            cwd=str(cmd_dir)
        )
        if job.get("cancelled"):
            return
        if job.get("mode") == "organize_only":
            job["active_step"] = 3
            _broadcast_launcher_event(job, {
                "type": "step",
                "step": 3,
                "pct": 50,
                "phase_title": "AI Classification & Sorting",
                "message": "Initializing local file reclassification..."
            })
        elif job.get("mode") == "gradescope_only":
            job["active_step"] = 2
            _broadcast_launcher_event(job, {
                "type": "step",
                "step": 2,
                "pct": 35,
                "phase_title": "Gradescope Synchronization",
                "message": "Connecting to Gradescope..."
            })
    except Exception as e:
        job["status"] = "error"
        _broadcast_launcher_event(job, {
            "type": "error",
            "message": f"Failed to spawn pipeline process: {e}"
        })
        return

    try:
        while True:
            line_bytes = await proc.stdout.readline()
            if not line_bytes:
                break
            raw_line = line_bytes.decode("utf-8", errors="replace").rstrip()
            if not raw_line or raw_line.startswith("===="):
                continue

            lower = raw_line.lower()
            level = "info"
            if "[download]" in lower or "downloaded" in lower or "downloading" in lower:
                level = "download"
            elif "[ai]" in lower or "ollama" in lower or "gemini" in lower or "classifying" in lower or "classification" in lower:
                level = "ai"
            elif "✅" in raw_line or "[success]" in lower or "successfully" in lower:
                level = "success"
            elif "⚠️" in raw_line or "[warn]" in lower or "warning" in lower:
                level = "warn"
            elif "❌" in raw_line or "[error]" in lower or "error:" in lower:
                level = "error"

            clean_msg = re.sub(r'^[🚀📥🤖🎓✅⚠️❌ℹ️\s]*(\[[A-Z]+\])?\s*', '', raw_line).strip()
            if not clean_msg:
                clean_msg = raw_line

            if req.mode == "organize_only":
                m_cls = re.search(r'\[(\d+)/(\d+)\]\s*(?:Classifying:)?\s*[\'"]?([^\'\"]+)', raw_line, re.IGNORECASE)
                if m_cls:
                    cur, total = int(m_cls.group(1)), int(m_cls.group(2))
                    pct = 50 + int((cur / max(1, total)) * 24)
                    _broadcast_launcher_event(job, {
                        "type": "step",
                        "step": 3,
                        "pct": min(pct, 74),
                        "phase_title": "AI Classification & Sorting",
                        "message": f"Classifying ({cur}/{total}): {m_cls.group(3).strip()[:35]}"
                    })
                elif "classif" in lower or "organizing" in lower or "ai" in lower:
                    _broadcast_launcher_event(job, {
                        "type": "step",
                        "step": 3,
                        "pct": 52,
                        "phase_title": "AI Classification & Sorting",
                        "message": "Classifying files with AI..."
                    })
            elif req.mode == "gradescope_only":
                if "gradescope" in lower or "sync" in lower or "submission" in lower:
                    _broadcast_launcher_event(job, {
                        "type": "step",
                        "step": 2,
                        "pct": 45,
                        "phase_title": "Gradescope Synchronization",
                        "message": clean_msg[:60]
                    })
            else:
                if "phase 1" in lower or "browser authentication" in lower or "session active" in lower or "login detected" in lower:
                    if job.get("active_step") != 1:
                        job["active_step"] = 1
                    pct = 20 if ("session active" in lower or "login detected" in lower) else 10
                    _broadcast_launcher_event(job, {
                        "type": "step",
                        "step": 1,
                        "pct": pct,
                        "phase_title": "Authentication & Session",
                        "message": clean_msg
                    })
                elif "phase 2" in lower or "file downloads" in lower or "starting download of" in lower:
                    if job.get("active_step") != 2:
                        job["active_step"] = 2
                    _broadcast_launcher_event(job, {
                        "type": "step",
                        "step": 2,
                        "pct": 25,
                        "phase_title": "Category Scraping & Downloads",
                        "message": "Starting downloads of course materials..."
                    })
                elif "phase 3" in lower or "ai classification" in lower or "classifying and organizing" in lower:
                    if job.get("active_step") != 3:
                        job["active_step"] = 3
                    _broadcast_launcher_event(job, {
                        "type": "step",
                        "step": 3,
                        "pct": 52,
                        "phase_title": "AI Classification & Sorting",
                        "message": "Classifying files with AI..."
                    })
                elif "phase 4" in lower or "gradescope" in lower:
                    _broadcast_launcher_event(job, {
                        "type": "step",
                        "step": 2,
                        "pct": 48,
                        "phase_title": "Category Scraping & Downloads",
                        "message": "Syncing Gradescope submissions..."
                    })
                else:
                    m_dl = re.search(r'\[(\d+)/(\d+)\]\s*(?:Downloading:)?\s*[\'"]?([^\'\"]+)', raw_line, re.IGNORECASE)
                    if m_dl and ("download" in lower or job.get("active_step") == 2):
                        cur, total = int(m_dl.group(1)), int(m_dl.group(2))
                        pct = 25 + int((cur / max(1, total)) * 25)
                        _broadcast_launcher_event(job, {
                            "type": "step",
                            "step": 2,
                            "pct": min(pct, 50),
                            "phase_title": "Category Scraping & Downloads",
                            "message": f"Downloading ({cur}/{total}): {m_dl.group(3).strip()[:35]}"
                        })
                    else:
                        m_cls = re.search(r'\[(\d+)/(\d+)\]\s*(?:Classifying:)?\s*[\'"]?([^\'\"]+)', raw_line, re.IGNORECASE)
                        if m_cls and ("classif" in lower or job.get("active_step") == 3):
                            cur, total = int(m_cls.group(1)), int(m_cls.group(2))
                            pct = 52 + int((cur / max(1, total)) * 22)
                            _broadcast_launcher_event(job, {
                                "type": "step",
                                "step": 3,
                                "pct": min(pct, 74),
                                "phase_title": "AI Classification & Sorting",
                                "message": f"Classifying ({cur}/{total}): {m_cls.group(3).strip()[:35]}"
                            })

            _broadcast_launcher_event(job, {
                "type": "log",
                "message": clean_msg,
                "level": level
            })

        returncode = await proc.wait()
    except Exception as stream_err:
        if not job.get("cancelled"):
            job["status"] = "error"
            _broadcast_launcher_event(job, {
                "type": "error",
                "message": f"Pipeline stream error: {stream_err}"
            })
        return

    if job.get("cancelled"):
        return

    if returncode != 0:
        job["status"] = "error"
        _broadcast_launcher_event(job, {
            "type": "error",
            "message": f"Pipeline crawler process exited with status code {returncode}."
        })
        return

    course_name = job["course_name"]
    course_dir = None
    try:
        discovered = discover_courses()
        if isinstance(discovered, dict):
            info = discovered.get(course_name) or discovered.get(job["course_name"])
            if info and info.get("path"):
                course_dir = str(Path(info["path"]).resolve())
    except Exception:
        pass
    if not course_dir or not os.path.isdir(course_dir):
        candidates = []
        if output_root:
            candidates.append(Path(output_root) / course_name)
            candidates.append(Path(output_root) / job["course_name"])
        for sdir in get_effective_search_dirs():
            candidates.append(Path(sdir) / course_name)
            candidates.append(Path(sdir) / job["course_name"])
        candidates.append(Path(os.path.expanduser(f"~/Desktop/{course_name}")))
        candidates.append(Path(os.path.expanduser(f"~/Desktop/{job['course_name']}")))
        for cand in candidates:
            if cand.is_dir():
                course_dir = str(cand.resolve())
                break
        if not course_dir:
            course_dir = str(candidates[0].resolve()) if candidates else os.path.expanduser(f"~/Desktop/{course_name}")

    job["active_step"] = 4
    _broadcast_launcher_event(job, {
        "type": "step",
        "step": 4,
        "pct": 78,
        "phase_title": "Course Blueprint & Timeline",
        "message": "Refreshing course blueprint file mappings and milestone timeline..."
    })

    bp_path = Path(course_dir) / "canvas_course.json"
    bp_candidates = [
        Path(course_dir) / custom_subfolder / "canvas_course.json",
        Path(course_dir) / f"{course_name} Lectures & Resources" / "canvas_course.json",
        Path(course_dir) / "canvas_course.json",
    ]
    for c in bp_candidates:
        if c.is_file():
            bp_path = c
            break

    if not CourseBlueprint or not os.path.isdir(course_dir):
        raise ValueError("Course directory is unavailable after ingestion")
    from safety import contained_path
    trusted_root = Path(contained_path(course_dir))
    if bp_path.is_file() or bp_path.is_symlink():
        contained_path(trusted_root, bp_path.relative_to(trusted_root))
        bp = CourseBlueprint.load(str(bp_path))
    else:
        bp = CourseBlueprint(course_name=course_name, course_url=req.course_url or "", output_dir=course_dir)
    bp.scan_course_directory(course_dir)
    lectures_dir = Path(contained_path(trusted_root, custom_subfolder))
    if not lectures_dir.is_dir():
        fallback = Path(contained_path(trusted_root, f"{course_name} Lectures & Resources"))
        lectures_dir = fallback if fallback.is_dir() else trusted_root
    bp.save(str(lectures_dir), course_root=str(trusted_root))
    with _catalog.lock:
        _catalog.roots = None
        _catalog.expires = 0

    # Explicit capture destinations are enrolled in course discovery.
    configured_dirs, default_dir = _read_configured_directories()
    if not configured_dirs:
        destination = _to_display_path(trusted_root.parent)
        _store_directories_settings([destination], destination)
    elif not any(trusted_root.is_relative_to(Path(d).expanduser().resolve()) for d in configured_dirs):
        # An explicitly selected capture outside existing roots must be visible too.
        destination = _to_display_path(trusted_root)
        _store_directories_settings(configured_dirs + [destination], default_dir)

    _broadcast_launcher_event(job, {
        "type": "log",
        "message": "Course blueprint (canvas_course.json) and milestone timeline confirmed.",
        "level": "success"
    })

    job["active_step"] = 5
    _broadcast_launcher_event(job, {
        "type": "step",
        "step": 5,
        "pct": 88,
        "phase_title": "FTS5 Search & Document Index",
        "message": "Building SQLite FTS5 search index and OCR cache..."
    })
    _broadcast_launcher_event(job, {
        "type": "log",
        "message": "Building SQLite FTS5 search index and OCR cache for offline access...",
        "level": "info"
    })

    files_count = 0
    if os.path.isdir(course_dir):
        for root, _, files in os.walk(course_dir):
            for f in files:
                if not f.startswith("."):
                    files_count += 1

    try:
        engine = get_search_engine(course_name, course_dir)
        await asyncio.to_thread(engine.request_index)
    except Exception as idx_err:
        _broadcast_launcher_event(job, {
            "type": "log",
            "message": f"Search engine notice: {idx_err}",
            "level": "warn"
        })

    _broadcast_launcher_event(job, {
        "type": "step",
        "step": 5,
        "pct": 100,
        "phase_title": "FTS5 Search & Document Index",
        "message": f"Capture complete ({files_count} files organized); search indexing continues in the background"
    })
    _broadcast_launcher_event(job, {
        "type": "log",
        "message": f"Capture complete ({files_count} files organized); search indexing continues in the background.",
        "level": "success"
    })

    job["status"] = "done"
    job["active_step"] = 0
    _broadcast_launcher_event(job, {
        "type": "done",
        "success": True,
        "course_name": course_name,
        "files_count": files_count
    })


@app.get("/api/launcher/hardware-profile")
async def api_launcher_hardware_profile():
    """Returns host machine hardware profile, RAM, and tailored AI recommendations."""
    profile = await asyncio.to_thread(get_system_hardware_profile)
    recs = await asyncio.to_thread(get_hardware_recommendations, profile)
    is_apple_silicon = bool(profile.get("is_apple_silicon", False))
    ram_gb = float(profile.get("ram_gb", 16.0))
    tier_str = "apple_silicon_high_ram" if (is_apple_silicon and ram_gb >= 16.0) else ("apple_silicon_low_ram" if is_apple_silicon else "intel_or_generic")
    return {
        "chip": profile.get("chip", "Unknown"),
        "ram_gb": ram_gb,
        "is_apple_silicon": is_apple_silicon,
        "tier": tier_str,
        "recommended_model": recs.get("recommended_local_model", "qwen2.5:7b"),
        "recommended_provider": recs.get("recommended_provider", "gemini"),
        "device_model": profile.get("device_model", "Mac"),
        "is_fanless": profile.get("is_fanless", False),
        "reason": recs.get("reason", "")
    }


@app.post("/api/launcher/start")
async def api_launcher_start(req: LauncherStartRequest):
    """Launches an asynchronous course ingestion pipeline job."""
    cleaned_name = _validate_folder_component(req.course_name)
    if req.mode == "full" and not req.course_url.strip():
        # Attempt to auto-resolve course_url from existing course blueprint on disk
        candidate_paths = []
        try:
            discovered = discover_courses()
            if isinstance(discovered, dict):
                for target_key in (req.course_name, cleaned_name):
                    info = discovered.get(target_key)
                    if info and info.get("path"):
                        candidate_paths.append(Path(info["path"]))
                c_lowers = (req.course_name.lower(), cleaned_name.lower())
                for k, v in discovered.items():
                    if isinstance(v, dict):
                        f_name = os.path.basename(v.get("path", "")).lower()
                        k_name = str(k).lower()
                        if k_name in c_lowers or f_name in c_lowers:
                            if v.get("path"):
                                candidate_paths.append(Path(v["path"]))
        except Exception:
            pass

        for target_name in (req.course_name, cleaned_name):
            if req.output_dir and str(req.output_dir).strip():
                candidate_paths.append(Path(req.output_dir).expanduser().resolve() / target_name)
            for search_dir in get_effective_search_dirs():
                candidate_paths.append(Path(search_dir) / target_name)
            candidate_paths.append(Path(os.path.expanduser(f"~/Desktop/{target_name}")))

        for base_p in candidate_paths:
            if not base_p.exists():
                continue
            hierarchy = _read_hierarchy_config()
            lectures_template = hierarchy.get("lectures_folder", "{course} Lectures & Resources")
            custom_sub_1 = lectures_template.replace("{course}", req.course_name).strip() if lectures_template else f"{req.course_name} Lectures & Resources"
            custom_sub_2 = lectures_template.replace("{course}", cleaned_name).strip() if lectures_template else f"{cleaned_name} Lectures & Resources"
            bp_candidates = [
                base_p / "canvas_course.json",
                base_p / custom_sub_1 / "canvas_course.json",
                base_p / custom_sub_2 / "canvas_course.json",
                base_p / f"{req.course_name} Lectures & Resources" / "canvas_course.json",
                base_p / f"{cleaned_name} Lectures & Resources" / "canvas_course.json",
                base_p / "Lectures" / "canvas_course.json",
            ]
            for bp_file in bp_candidates:
                if bp_file.is_file():
                    try:
                        with open(bp_file, "r", encoding="utf-8") as f:
                            bp_data = json.load(f)
                        resolved_url = bp_data.get("course_url") or bp_data.get("url")
                        if resolved_url and str(resolved_url).strip():
                            req.course_url = str(resolved_url).strip()
                            break
                    except Exception:
                        pass
            if req.course_url.strip():
                break

        if not req.course_url.strip():
            raise HTTPException(status_code=400, detail="course_url is required for full pipeline mode (could not be resolved from existing course blueprint)")

    # Credentials are accepted only by the bounded dedicated settings endpoint.
    if req.gemini_tier:
        if req.gemini_tier not in ('free', 'paid'):
            raise HTTPException(400, detail='Invalid Gemini tier')
        _store_gemini_settings(tier=req.gemini_tier)

    with _launcher_lock:
        active = [j for j in _launcher_jobs.values() if j.get('status') in ('running', 'pending')
                  or (j.get('process') is not None and j['process'].returncode is None)
                  or (j.get('task') is not None and not j['task'].done())]
        if any(j.get('course_name', '').casefold() == cleaned_name.casefold() for j in active):
            raise HTTPException(409, detail='This course already has an active pipeline')
        # Browser authentication uses one persistent profile shared by all courses.
        if active:
            raise HTTPException(429, detail='Another pipeline is running; wait for it to finish')
        if len(_launcher_jobs) > 50:
            removable = [jid for jid, j in _launcher_jobs.items() if j.get("status") in ("done", "error", "cancelled")]
            for jid in removable[:20]:
                _launcher_jobs.pop(jid, None)

        job_id = f"job_{int(time.time())}_{uuid.uuid4().hex[:8]}"
        job = {
            "job_id": job_id,
            "course_name": cleaned_name,
            "mode": req.mode,
            "status": "running",
            "active_step": 1,
            "events": [],
            "subscribers": set(),
            "process": None,
            "created_at": time.time(),
            "cancelled": False
        }
        _launcher_jobs[job_id] = job

    job["task"] = asyncio.create_task(_run_launcher_daemon(job, req))
    return {
        "job_id": job_id,
        "status": "started",
        "course_name": cleaned_name,
        "mode": req.mode
    }


@app.get("/api/launcher/stream/{job_id}")
async def api_launcher_stream(job_id: str):
    """Streams live Server-Sent Events (SSE) for a pipeline ingestion job."""
    job = _launcher_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator():
        q = asyncio.Queue(maxsize=128)
        # Subscribe before yielding replay so a completion cannot be lost.
        replay = list(job.get('events', []))
        job['subscribers'].add(q)
        try:
            for evt in replay:
                yield f"data: {json.dumps(evt)}\n\n"
            if job.get('status') in ('done', 'error', 'cancelled') and q.empty():
                return
            while True:
                evt = await q.get()
                yield f"data: {json.dumps(evt)}\n\n"
                if evt.get('type') in ('done', 'error'):
                    break
        except asyncio.CancelledError:
            pass
        finally:
            job['subscribers'].discard(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@app.post("/api/launcher/cancel/{job_id}")
async def api_launcher_cancel(job_id: str):
    """Cancels an ongoing ingestion pipeline job."""
    job = _launcher_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.get("status") == "running":
        job["cancelled"] = True
        job["status"] = "cancelled"
        proc = job.get("process")
        if proc:
            await terminate_pipeline_process(proc)
        # A pending spawn observes cancelled before performing any pipeline work.
        _broadcast_launcher_event(job, {
            "type": "log",
            "message": "Pipeline cancelled by user.",
            "level": "warn"
        })
        _broadcast_launcher_event(job, {
            "type": "error",
            "message": "Job cancelled by user."
        })
    return {"status": "cancelled", "job_id": job_id}


@app.get("/api/launcher/status/{job_id}")
async def api_launcher_status(job_id: str):
    """Returns the current status snapshot of an ingestion job."""
    job = _launcher_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "job_id": job_id,
        "course_name": job.get("course_name"),
        "mode": job.get("mode"),
        "status": job.get("status"),
        "active_step": job.get("active_step"),
        "created_at": job.get("created_at"),
        "total_events": len(job.get("events", []))
    }


# Mount frontend static directory
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def serve_index():
    """Serve the Single Page Application index."""
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        return HTMLResponse("<h1>Canvas App Frontend Initializing...</h1>")
    return FileResponse(str(index_file), headers={"Cache-Control": "no-cache, no-store, must-revalidate"})


if __name__ == "__main__":
    import uvicorn
    print("Starting Canvas Course Offline Web Server on http://127.0.0.1:8000 ...")
    uvicorn.run("server:app", host="127.0.0.1", port=8000, reload=False)
