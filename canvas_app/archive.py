"""Local archive discovery and containment rules shared by backend services."""
import collections
from datetime import datetime
import copy
import hashlib
import html
import json
import os
import re
import threading
import time
from pathlib import Path

MAX_BLUEPRINT_BYTES = 32 * 1024 * 1024
_CONFIG_PATH = Path(__file__).resolve().parent.parent / "Canvas Module Downloader" / "config.json"

try:
    import sys
    _cmd_dir = str(Path(__file__).resolve().parent.parent / "Canvas Module Downloader")
    if _cmd_dir not in sys.path:
        sys.path.insert(0, _cmd_dir)
    from canvas_blueprint import synthesize_course_blueprint, infer_course_name_from_folder
except Exception:
    synthesize_course_blueprint = None
    infer_course_name_from_folder = None


def _get_active_config_path() -> Path:
    try:
        import sys
        srv = sys.modules.get("canvas_app.server")
        if srv and hasattr(srv, "_GEMINI_CONFIG_PATH"):
            return Path(srv._GEMINI_CONFIG_PATH)
    except Exception:
        pass
    return _CONFIG_PATH


def _hierarchy_snapshot():
    """[Codex] Read a single configuration snapshot per discovery pass."""
    try:
        with _get_active_config_path().open(encoding='utf-8') as stream:
            data = json.load(stream)
        hierarchy = data.get('disk_hierarchy', {}) if isinstance(data, dict) else {}
        return hierarchy if isinstance(hierarchy, dict) else {}
    except (OSError, ValueError):
        return {}


def _get_hierarchy_lectures_template(snapshot=None):
    data = _hierarchy_snapshot() if snapshot is None else snapshot
    return str(data.get('lectures_folder') or '{course} Lectures & Resources').strip()


def _get_hierarchy_custom_folders(snapshot=None):
    data = _hierarchy_snapshot() if snapshot is None else snapshot
    return [str(f['name']).strip() for f in (data.get('custom_folders') or [])
            if isinstance(f, dict) and f.get('name')]


def _get_hierarchy_main_folders(snapshot=None):
    data = _hierarchy_snapshot() if snapshot is None else snapshot
    return [str(f['name']).strip() for f in (data.get('main_folders') or [])
            if isinstance(f, dict) and f.get('name')]



def signature(path):
    stat = Path(path).stat()
    return stat.st_mtime_ns, stat.st_ctime_ns, stat.st_size, stat.st_ino


def safe_path(base, relative, *, directory=False):
    base = Path(base).resolve()
    if not isinstance(relative, str) or not relative or '\x00' in relative:
        raise ValueError('Invalid file path')
    raw_relative = relative
    unescaped_relative = html.unescape(relative)
    path = Path(unescaped_relative)
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('Path must be relative to the course')
    try:
        target = (base / path).resolve()
    except RuntimeError as exc:
        raise ValueError('Symlink loop') from exc
    target.relative_to(base)
    if target.exists() and (directory or target.is_file()):
        return target

    if raw_relative != unescaped_relative:
        raw_path = Path(raw_relative)
        if not raw_path.is_absolute() and '..' not in raw_path.parts:
            try:
                raw_target = (base / raw_path).resolve()
                raw_target.relative_to(base)
                if raw_target.exists() and (directory or raw_target.is_file()):
                    return raw_target
            except (ValueError, RuntimeError):
                pass

    raise FileNotFoundError(relative)


def walk_files(base):
    """Deterministic inventory; never follow archive symlinks or hidden trees."""
    base = Path(base).resolve()
    for root, dirs, files in os.walk(base):
        dirs[:] = sorted(d for d in dirs if not d.startswith('.') and not (Path(root) / d).is_symlink())
        for name in sorted(files):
            path = Path(root) / name
            if name.startswith('.') or path.is_symlink():
                continue
            try:
                if path.is_file():
                    yield path, path.relative_to(base).as_posix(), signature(path)
            except OSError:
                continue


def load_blueprint(path):
    if Path(path).stat().st_size > MAX_BLUEPRINT_BYTES:
        raise ValueError('Blueprint exceeds 32 MiB')
    with open(path, encoding='utf-8') as source:
        content = source.read(MAX_BLUEPRINT_BYTES + 1)
    if len(content.encode('utf-8')) > MAX_BLUEPRINT_BYTES:
        raise ValueError('Blueprint exceeds 32 MiB')
    data = json.loads(content)
    if not isinstance(data, dict):
        raise ValueError('Blueprint must be an object')
    for key in ('tabs', 'modules', 'timeline', 'assignments', 'announcements'):
        if not isinstance(data.get(key, []), list):
            raise ValueError(f'{key} must be an array')
    if not isinstance(data.get('file_path_map', {}), dict):
        raise ValueError('file_path_map must be an object')
    return data


TERM_PATTERN_1 = re.compile(
    r'\b(Winter|Spring|Summer|Fall|Autumn)(?:\s+(?:Quarter|Semester|Term|Session(?:\s+[A-Za-z0-9]+)?))?\s+(\d{4})\b',
    re.IGNORECASE
)
TERM_PATTERN_2 = re.compile(
    r'\b(\d{4})\s+(?:(?:Quarter|Semester|Term|Session(?:\s+[A-Za-z0-9]+)?)\s+)?(Winter|Spring|Summer|Fall|Autumn)\b',
    re.IGNORECASE
)


def match_term_pattern(text):
    """Zero-hardcoding regex extraction of academic quarter/term (e.g. 'Summer 2026')."""
    if not text or not isinstance(text, str):
        return None
    m = TERM_PATTERN_1.search(text)
    if m:
        t, y = m.group(1).capitalize(), m.group(2)
        if t.lower() == 'autumn':
            t = 'Fall'
        return f"{t} {y}"
    m = TERM_PATTERN_2.search(text)
    if m:
        y, t = m.group(1), m.group(2).capitalize()
        if t.lower() == 'autumn':
            t = 'Fall'
        return f"{t} {y}"
    return None


def extract_course_term(data, folder=None):
    """
    Extract course academic quarter / term (e.g. 'Summer 2026', 'Spring 2026', 'Winter 2026', 'Fall 2025').
    Extraction strategy:
      1. Use explicit term fields, then blueprint filenames, titles and syllabus text.
      2. Inspect timeline titles, then physical syllabus filenames only if unresolved.
      3. Cluster timeline dates by season.
      4. Fallback to scraped_at timestamp season or return None.
    """
    if not isinstance(data, dict):
        data = {}

    # [Codex] Authoritative metadata is cheap and wins over archived filename guesses.
    for field in ("term", "quarter"):
        term = match_term_pattern(data.get(field))
        if term:
            return term

    # Strategy 1a: Inspect syllabus file names in blueprint
    syl = data.get("syllabus")
    if isinstance(syl, dict):
        for field in ("pdf_path", "pdf_file", "snapshot_path", "snapshot_pdf", "title", "url"):
            term = match_term_pattern(syl.get(field))
            if term:
                return term

    # Strategy 1b: Inspect file_path_map for any syllabus file names
    file_map = data.get("file_path_map")
    if isinstance(file_map, dict):
        for display_name, rel_path in file_map.items():
            name_str = str(display_name)
            path_str = str(rel_path)
            if "syllabus" in name_str.lower() or "syllabus" in path_str.lower():
                term = match_term_pattern(Path(path_str).name) or match_term_pattern(name_str)
                if term:
                    return term

    # Strategy 2a: Inspect explicit term field or course title
    for field in ("course_name", "title", "course_code"):
        term = match_term_pattern(data.get(field))
        if term:
            return term
    if folder:
        folder_p = Path(folder)
        term = match_term_pattern(folder_p.name) or match_term_pattern(folder_p.parent.name)
        if term:
            return term

    # Strategy 2b: Inspect syllabus body text (first 10,000 chars)
    if isinstance(syl, dict) and isinstance(syl.get("body"), str):
        term = match_term_pattern(syl["body"][:10000])
        if term:
            return term

    # Strategy 3a: Inspect timeline item titles for explicit term mentions
    timeline = data.get("timeline")
    if isinstance(timeline, list):
        for item in timeline:
            if isinstance(item, dict):
                term = match_term_pattern(item.get("title"))
                if term:
                    return term

    # Strategy 1c: Inspect disk files in folder for syllabus files
    if folder:
        try:
            folder_path = Path(folder)
            if folder_path.is_dir():
                for file_path, rel_path, _ in walk_files(folder_path):
                    if "syllabus" in file_path.name.lower():
                        term = match_term_pattern(file_path.name)
                        if term:
                            return term
        except Exception:
            pass

    # Strategy 3b: Timeline date clustering
    def month_to_quarter(month):
        if 1 <= month <= 3:
            return "Winter"
        elif 4 <= month <= 6:
            return "Spring"
        elif 7 <= month <= 9:
            return "Summer"
        else:
            return "Fall"

    if isinstance(timeline, list) and timeline:
        term_counts = collections.Counter()
        date_pattern = re.compile(r'(\d{4})-(\d{2})-(\d{2})')
        for item in timeline:
            if not isinstance(item, dict):
                continue
            for date_key in ("date_due", "due_at", "date_assigned", "unlock_at", "lock_at", "created_at", "date", "submission_date"):
                date_str = str(item.get(date_key) or "")
                m = date_pattern.search(date_str)
                if m:
                    year = int(m.group(1))
                    month = int(m.group(2))
                    try:
                        datetime(year, month, int(m.group(3)))
                    except ValueError:
                        continue
                    if 2000 <= year <= 2099:
                        term_counts[(month_to_quarter(month), year)] += 1
                        # One event contributes one vote, independent of metadata density.
                        break
        if term_counts:
            (top_q, top_yr), count = term_counts.most_common(1)[0]
            if count >= 2 or len(timeline) <= 3:
                return f"{top_q} {top_yr}"

    # Strategy 4: Fallback to scraped_at timestamp season
    scraped_at = data.get("scraped_at")
    if isinstance(scraped_at, str):
        m = re.search(r'(\d{4})-(\d{2})-(\d{2})', scraped_at)
        if m:
            year = int(m.group(1))
            month = int(m.group(2))
            if 2000 <= year <= 2099 and 1 <= month <= 12:
                return f"{month_to_quarter(month)} {year}"

    return None


IGNORED_DIR_NAMES = {
    'node_modules', 'venv', '.venv', 'env', '__pycache__',
    'library', 'applications', 'system', 'build', 'dist',
    '.trash', '.git', '.cache', '.local', '.vscode', '.idea'
}


def _find_course_blueprint_in_folder(folder: Path, template=None, custom_folders=None, main_folders=None):
    """Check if `folder` is a course directory, returning the Path to canvas_course.json if found."""
    # 1. Direct canvas_course.json (unified layout)
    bp = folder / 'canvas_course.json'
    if bp.is_file() and not bp.is_symlink():
        return bp

    # 2. Known candidate subfolders (dual-folder, compact, custom templates, arbitrary main folders)
    candidates = []
    custom_sub = None
    if template:
        custom_sub = template.replace("{course}", folder.name).strip()
        if custom_sub and custom_sub != ".":
            candidates.append(folder / custom_sub / 'canvas_course.json')
    candidates.append(folder / f"{folder.name} Lectures & Resources" / 'canvas_course.json')
    candidates.append(folder / 'Lectures' / 'canvas_course.json')
    if main_folders:
        for mf in main_folders:
            if mf:
                resolved_mf = mf.replace("{course}", folder.name).strip()
                if resolved_mf and resolved_mf != ".":
                    candidates.append(folder / resolved_mf / 'canvas_course.json')
                    if custom_folders:
                        for cf in custom_folders:
                            if cf:
                                candidates.append(folder / resolved_mf / cf / 'canvas_course.json')
    if custom_folders:
        for cf in custom_folders:
            if cf:
                candidates.append(folder / cf / 'canvas_course.json')
                if custom_sub and custom_sub != ".":
                    candidates.append(folder / custom_sub / cf / 'canvas_course.json')
    for cand in candidates:
        if cand.is_file() and not cand.is_symlink():
            return cand

    # 3. Check immediate subfolders that look like study materials / lectures subfolder
    try:
        for sub in folder.iterdir():
            if sub.is_dir() and not sub.is_symlink():
                sub_name_lower = sub.name.lower()
                if sub.name.startswith('.') or sub_name_lower in IGNORED_DIR_NAMES:
                    continue
                is_materials_sub = (
                    folder.name.lower() in sub_name_lower
                    or "lecture" in sub_name_lower
                    or "resource" in sub_name_lower
                    or "material" in sub_name_lower
                    or "study" in sub_name_lower
                    or "content" in sub_name_lower
                    or (custom_folders and any(cf.lower() in sub_name_lower for cf in custom_folders))
                    or (main_folders and any(mf.replace("{course}", "").strip().lower() in sub_name_lower for mf in main_folders if mf.replace("{course}", "").strip()))
                )
                sub_bp = sub / 'canvas_course.json'
                if sub_bp.is_file() and not sub_bp.is_symlink():
                    if is_materials_sub:
                        return sub_bp
                    try:
                        data = load_blueprint(sub_bp)
                        bp_cname = str(data.get('course_name') or '').strip().lower()
                        if bp_cname and bp_cname == folder.name.lower():
                            return sub_bp
                    except Exception:
                        pass
                try:
                    for sub2 in sub.iterdir():
                        if sub2.is_dir() and not sub2.is_symlink():
                            if sub2.name.startswith('.') or sub2.name.lower() in IGNORED_DIR_NAMES:
                                continue
                            sub2_bp = sub2 / 'canvas_course.json'
                            if sub2_bp.is_file() and not sub2_bp.is_symlink():
                                if is_materials_sub:
                                    return sub2_bp
                                try:
                                    data = load_blueprint(sub2_bp)
                                    bp_cname = str(data.get('course_name') or '').strip().lower()
                                    if bp_cname and bp_cname == folder.name.lower():
                                        return sub2_bp
                                except Exception:
                                    pass
                except OSError:
                    pass
    except OSError:
        pass

    return None


COURSE_CODE_PATTERN = re.compile(
    r'\b([A-Za-z\s&]{2,12}\s*(\d{1,4}[A-Za-z]{0,3}|[IVXLCDM]+))\b'
)

NON_COURSE_FILES = {
    "package.json", "cargo.toml", "go.mod", "pom.xml", "build.gradle",
    "cmake_install.cmake", "cmakelists.txt"
}


def _is_legacy_course_candidate(folder: Path) -> bool:
    """
    Evaluates whether an unindexed directory (lacking canvas_course.json) represents
    a legacy or externally backed-up academic course folder.
    
    Zero-hardcoding heuristics:
    1. Folder name matches course code pattern (e.g. 'CHEM 14D', 'CS 32', 'ECON 101')
       or contains academic keywords ('Course', 'Class', 'Quarter').
    2. Excludes software/build projects containing package.json, Cargo.toml, go.mod.
    3. Contains at least 2 course documents (.pdf, .pptx, .docx, .key, .ipynb, .md, .txt)
       or academic subfolders ('Lectures', 'Homework', 'Assignments', 'Exams', 'Syllabus', 'Labs', 'Slides').
    """
    try:
        if not folder.is_dir() or folder.is_symlink():
            return False
        f_name = folder.name
        f_name_lower = f_name.lower()
        if f_name.startswith('.') or f_name_lower in IGNORED_DIR_NAMES:
            return False

        # Exclude software development repositories unless clearly a course
        for ncf in NON_COURSE_FILES:
            if (folder / ncf).is_file():
                return False

        # Check folder name signals
        has_code_name = bool(COURSE_CODE_PATTERN.search(f_name))
        has_academic_name = any(kw in f_name_lower for kw in ("course", "class", "lecture", "seminar", "quarter", "semester", "fall 20", "winter 20", "spring 20", "summer 20"))

        # Check children
        academic_subfolders = {
            "lectures", "homework", "assignments", "exams", "syllabus", "labs",
            "discussions", "readings", "slides", "notes", "quizzes", "problem sets",
            "psets", "work", "resources", "materials",
            "projects", "project", "solutions", "handouts", "review"
        }
        course_file_exts = {
            ".pdf", ".pptx", ".ppt", ".docx", ".doc", ".key", ".ipynb", ".epub",
            ".md", ".txt", ".cpp", ".py"
        }

        has_academic_subfolder = False
        course_file_count = 0
        has_syllabus = False

        for item in folder.iterdir():
            if item.name.startswith('.'):
                continue
            item_name_lower = item.name.lower()
            if item.is_dir() and not item.is_symlink():
                if any(sub_kw in item_name_lower for sub_kw in academic_subfolders):
                    has_academic_subfolder = True
            elif item.is_file():
                if item.suffix.lower() in course_file_exts:
                    course_file_count += 1
                if "syllabus" in item_name_lower:
                    has_syllabus = True

        # Qualification rules:
        # Rule 1: Has a syllabus file and at least 1 document -> Course!
        if has_syllabus and (course_file_count >= 1 or has_academic_subfolder):
            return True

        # Rule 2: Course code in name + (academic subfolder OR at least 2 course files)
        if has_code_name and (has_academic_subfolder or course_file_count >= 2):
            return True

        # Rule 3: Academic keyword in name + (academic subfolder OR at least 2 course files)
        if has_academic_name and (has_academic_subfolder or course_file_count >= 2):
            return True

        # Rule 4: Has academic subfolder + at least 2 course files
        if has_academic_subfolder and course_file_count >= 2:
            return True

        return False
    except OSError:
        return False


class ArchiveCatalog:
    """Bounded discovery cadence with stat-keyed blueprint reuse."""
    def __init__(self, ttl=30):
        self.ttl = ttl
        self.lock = threading.RLock()
        self.scan_lock = threading.Lock()
        self.expires = 0
        self.roots = ()
        self.courses = {}
        self.blueprints = {}

    def discover(self, roots):
        roots = tuple(map(Path, roots))
        with self.lock:
            if roots == self.roots and time.monotonic() < self.expires:
                return copy.deepcopy(self.courses)
            previous = dict(self.blueprints)
        # [Codex] A slow filesystem scan must not hold the blueprint-reader lock.
        if not self.scan_lock.acquire(blocking=False):
            with self.lock:
                if roots == self.roots:
                    return copy.deepcopy(self.courses)
            self.scan_lock.acquire()
        try:
            return self._scan(roots, previous)
        finally:
            self.scan_lock.release()

    def _record_course(self, folder, bp, found, cached, previous, recorded_paths=None):
        try:
            if bp.is_symlink() or not bp.is_file():
                return
            folder_resolved = str(folder.resolve())
            if recorded_paths is not None:
                if folder_resolved in recorded_paths:
                    return
            elif any(c.get('path') == folder_resolved for c in found.values()):
                return

            sig = signature(bp)
            old = previous.get(str(bp))
            data = old[1] if old and old[0] == sig else load_blueprint(bp)
            cached[str(bp)] = (sig, data)
            name = data.get('course_name') or folder.name
            if not isinstance(name, str) or not name.strip():
                return
            key = name
            if key in found:
                if found[key].get('path') == folder_resolved:
                    return
                key = name + ' [' + hashlib.sha256(str(folder).encode()).hexdigest()[:10] + ']'
            found[key] = dict(
                name=key,
                folder_name=folder.name,
                path=folder_resolved,
                blueprint_path=str(bp),
                scraped_at=data.get('scraped_at'),
                stats={k: len(data.get(k, [])) for k in ('tabs', 'modules', 'timeline', 'assignments', 'announcements')},
                term=extract_course_term(data, folder)
            )
            found[key]['stats']['files'] = len(data.get('file_path_map', {}))
            if recorded_paths is not None:
                recorded_paths.add(folder_resolved)
        except (OSError, ValueError, TypeError):
            pass

    def _scan(self, roots, previous):
        found, cached = {}, {}
        recorded_paths = {c['path'] for c in found.values() if isinstance(c, dict) and 'path' in c}
        config = _hierarchy_snapshot()
        template = _get_hierarchy_lectures_template(config)
        custom_folders = _get_hierarchy_custom_folders(config)
        main_folders = _get_hierarchy_main_folders(config)
        max_depth = 5

        # Single global visited set across all roots so overlapping/child trees are never scanned twice
        visited = set()

        for root in roots:
            try:
                if not root.exists() or not root.is_dir() or root.is_symlink():
                    continue
            except OSError:
                continue

            root_resolved = root.resolve()
            if root_resolved in visited:
                continue
            visited.add(root_resolved)

            queue = collections.deque([(root, 0)])

            while queue:
                curr_dir, depth = queue.popleft()

                if curr_dir != root:
                    curr_resolved = curr_dir.resolve()
                    if str(curr_resolved) in recorded_paths:
                        continue
                    bp = _find_course_blueprint_in_folder(curr_dir, template, custom_folders, main_folders)
                    if bp:
                        self._record_course(curr_dir, bp, found, cached, previous, recorded_paths)
                        # Do not traverse further into an identified course directory
                        continue
                    # [Codex] Discovery is read-only. Import/synthesize endpoints
                    # explicitly enroll legacy candidates before they are indexed.

                if depth < max_depth:
                    try:
                        children = sorted(curr_dir.iterdir(), key=lambda p: p.name.lower())
                    except OSError:
                        continue
                    for child in children:
                        try:
                            if not child.is_dir() or child.is_symlink():
                                continue
                            if child.name.startswith('.') or child.name.lower() in IGNORED_DIR_NAMES:
                                continue
                            child_res = child.resolve()
                            if child_res in visited:
                                continue
                            visited.add(child_res)
                            queue.append((child, depth + 1))
                        except OSError:
                            continue

        with self.lock:
            self.roots, self.courses, self.blueprints = roots, found, cached
            self.expires = time.monotonic() + self.ttl
            return copy.deepcopy(found)

    def blueprint(self, info, fields=None):
        with self.lock:
            path = info['blueprint_path']
            sig = signature(path)
            old = self.blueprints.get(path)
            data = old[1] if old and old[0] == sig else load_blueprint(path)
            self.blueprints[path] = (sig, data)
            return copy.deepcopy(data if fields is None else {key: data[key] for key in fields if key in data})
