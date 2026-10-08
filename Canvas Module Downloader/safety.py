"""[Codex] Shared containment and atomic publication for downloader mutations."""
import json
import os
from pathlib import Path
import tempfile
import shutil
import re


def validate_component(name):
    if not isinstance(name, str) or not name.strip() or name in {'.', '..'} or any(c in name for c in '/\\\x00'):
        raise ValueError('Expected a nonempty folder name without path components')
    if os.name == 'nt' and (re.search(r'[<>:"|?*\x00-\x1f]', name) or name.rstrip(' .') != name
                            or re.match(r'(?i)^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', name)):
        raise ValueError('Folder name is not valid on Windows')
    return name


def contained_path(root, *parts):
    root = Path(os.path.abspath(os.path.expanduser(str(root))))
    # macOS system aliases are trusted; user-controlled symlinks remain forbidden.
    for alias, canonical in (('/var', '/private/var'), ('/tmp', '/private/tmp')):
        if os.path.islink(alias) and os.path.realpath(alias) == canonical:
            try:
                root = Path(canonical) / root.relative_to(alias)
            except ValueError:
                pass
    candidate = root.joinpath(*map(str, parts))
    # Reject symlinks anywhere, including ancestors of the supplied root.
    for node in (candidate, *candidate.parents):
        if node.is_symlink() or (os.name == 'nt' and node.exists() and node.is_junction()):
            raise ValueError('Symbolic links are not permitted in course mutation paths')
    resolved = candidate.resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ValueError('Path escapes course root')
    return str(resolved)


def validate_hierarchy(config):
    hier = config.get('disk_hierarchy') or {}
    for key in ('lectures_folder', 'work_folder'):
        value = hier.get(key)
        if value and value != '.':
            validate_component(value)
    for rule in config.get('category_rules', []):
        value = rule.get('folder', '')
        for part in value.split('/'):
            validate_component(part)
    for group in ('main_folders', 'custom_folders'):
        for folder in hier.get(group, []):
            value = folder.get('name', '')
            if not isinstance(value, str) or value.startswith(('/', '\\')):
                raise ValueError('Invalid hierarchy folder')
            for part in value.split('/'):
                validate_component(part)


def resolve_course_root(output_dir, course_name):
    validate_component(course_name)
    path = Path(contained_path(output_dir))
    for candidate in (path, *path.parents):
        if candidate.name == course_name:
            return str(candidate)
    raise ValueError('Output must be inside the explicitly named course directory')


def unique_destination(path):
    path = Path(path)
    index = 1
    candidate = path
    while candidate.exists() or candidate.is_symlink():
        candidate = path.with_name(f'{path.stem} ({index}){path.suffix}')
        index += 1
    return str(candidate)


def move_unique(source, destination):
    """Publish without overwriting even if another writer races us."""
    source = Path(source)
    if source.is_symlink() or not source.is_file():
        raise ValueError('Only regular source files can be moved')
    destination = unique_destination(destination)
    contained_path(Path(destination).parent, Path(destination).name)
    fd, temporary = tempfile.mkstemp(prefix='.publish-', dir=Path(destination).parent)
    try:
        with os.fdopen(fd, 'wb') as out, source.open('rb') as inp:
            shutil.copyfileobj(inp, out)
            out.flush()
            os.fsync(out.fileno())
        while True:
            try:
                os.link(temporary, destination)
                break
            except FileExistsError:
                destination = unique_destination(destination)
        source.unlink()
    finally:
        os.unlink(temporary)
    return destination


def atomic_json(path, data):
    path = Path(path)
    contained_path(path.parent, path.name)
    previous = path.stat() if path.exists() else None
    fd, temporary = tempfile.mkstemp(prefix='.settings-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(data, handle, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        current = path.stat() if path.exists() else None
        if previous != current:
            raise RuntimeError('Configuration changed concurrently; retry')
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def validate_tree(root):
    contained_path(root)
    for directory, dirs, files in os.walk(root):
        for name in dirs + files:
            if Path(directory, name).is_symlink():
                raise ValueError('Course contains a symbolic link; refusing mutations')


def course_output(base, course_name, subfolder):
    validate_component(course_name)
    root = contained_path(base, course_name)
    if subfolder and subfolder != '.':
        validate_component(subfolder)
        root = contained_path(root, subfolder)
    return root


def bounded_pdf_text(path, max_pages=20, max_chars=8000):
    """[Codex] Isolate hostile PDF decompression/parser work with CPU/RAM/time limits."""
    import subprocess
    import sys
    worker = '''
import json, sys
try:
 import resource
 resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
 resource.setrlimit(resource.RLIMIT_AS, (768*1024*1024, 768*1024*1024))
except (ImportError, ValueError, OSError):
 pass
import pypdf
path, limit, chars = json.load(sys.stdin)
reader = pypdf.PdfReader(path)
count = len(reader.pages)
indices = list(range(min(count, limit)))
if count > limit and limit > 4:
 tail = min(5, limit//4)
 indices = list(range(limit-tail)) + list(range(count-tail, count))
text = ''
for index in indices:
 text += (reader.pages[index].extract_text() or '') + '\\n'
 if len(text) >= chars:
  break
sys.stdout.write(text[:chars])
'''
    try:
        result = subprocess.run([sys.executable, '-c', worker], input=json.dumps([str(path), max(0, min(max_pages, 20)), max(0, min(max_chars, 8000))]), capture_output=True, text=True, timeout=20)
        return result.stdout[:max_chars] if result.returncode == 0 else ''
    except (OSError, subprocess.TimeoutExpired):
        return ''
