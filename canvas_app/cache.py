"""[Codex] Bounded, thread-safe derived-data cache with same-key work sharing."""
import copy
import json
import threading
import time
from collections import OrderedDict
from concurrent.futures import Future, TimeoutError


class CacheBusy(RuntimeError):
    pass


class DerivedCache:
    def __init__(self, max_bytes=32 * 1024 * 1024, max_items=64, max_pending=8):
        self.max_bytes, self.max_items, self.max_pending = max_bytes, max_items, max_pending
        self._lock = threading.Lock()
        self._entries = OrderedDict()
        self._pending = {}
        self._bytes = 0

    def get(self, key, build, ttl=300):
        now = time.monotonic()
        with self._lock:
            entry = self._entries.get(key)
            if entry and entry[0] > now:
                self._entries.move_to_end(key)
                value = entry[2]
                future = None
                owner = False
            else:
                if entry:
                    self._bytes -= self._entries.pop(key)[1]
                future = self._pending.get(key)
                owner = future is None
                if owner:
                    if len(self._pending) >= self.max_pending:
                        raise CacheBusy('Too many documents are being prepared')
                    future = self._pending[key] = Future()
        if future is None:
            return copy.deepcopy(value)
        if not owner:
            try:
                return copy.deepcopy(future.result(timeout=30))
            except TimeoutError as exc:
                raise CacheBusy('Document preparation is still running') from exc
        try:
            value = build()
            weight = len(json.dumps(value, ensure_ascii=False).encode('utf-8'))
            with self._lock:
                if weight <= self.max_bytes:
                    while self._entries and (self._bytes + weight > self.max_bytes or len(self._entries) >= self.max_items):
                        _, old = self._entries.popitem(last=False)
                        self._bytes -= old[1]
                    self._entries[key] = (time.monotonic() + ttl, weight, value)
                    self._bytes += weight
                self._pending.pop(key, None)
                future.set_result(value)
            return copy.deepcopy(value)
        except BaseException as exc:
            with self._lock:
                self._pending.pop(key, None)
                if not future.done():
                    future.set_exception(exc)
            raise

    def clear(self):
        with self._lock:
            self._entries.clear()
            self._pending.clear()
            self._bytes = 0


def ensure_private_directory(path):
    """[Codex] Existing cache directories must also be owned and private."""
    import os
    import stat
    from pathlib import Path
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.name == 'nt':
        # Windows has no O_DIRECTORY/O_NOFOLLOW, uid, or fchmod. Keep cache
        # roots out of junctions and symlinks; the user's profile ACL governs
        # access to newly created directories.
        for component in (path, *path.parents):
            if component.is_symlink() or (component.exists() and component.is_junction()):
                raise PermissionError('Cache directory must not use a link or junction')
        if not path.is_dir():
            raise PermissionError('Cache path must be a directory')
        return path
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if info.st_uid != os.getuid() or not stat.S_ISDIR(info.st_mode):
            raise PermissionError('Cache directory must belong to the current user')
        os.fchmod(fd, 0o700)
    finally:
        os.close(fd)
    return path
