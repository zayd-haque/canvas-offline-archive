"""[Codex] Per-launch local browser authentication, never stored on disk."""
import hmac
import secrets
import threading

COOKIE_NAME = 'canvas_local_session'


class LocalAccess:
    def __init__(self):
        self.bootstrap_token = secrets.token_urlsafe(32)
        self._session = secrets.token_urlsafe(32)
        self._lock = threading.Lock()

    def authenticate(self, cookie):
        return (isinstance(cookie, str) and cookie.isascii() and
                len(cookie) == len(self._session) and hmac.compare_digest(cookie, self._session))

    def exchange(self, token):
        if not isinstance(token, str) or not token.isascii() or len(token) > 128:
            return None
        with self._lock:
            if not self.bootstrap_token or not hmac.compare_digest(token, self.bootstrap_token):
                return None
            self.bootstrap_token = None
            return self._session
