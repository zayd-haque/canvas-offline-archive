"""Track authenticated browser tabs for a launcher-owned local server."""

import time


class BrowserLeases:
    def __init__(self, *, stale_after=120, close_grace=4, clock=time.monotonic):
        self._clock = clock
        self.stale_after = stale_after
        self.close_grace = close_grace
        self.tabs = {}
        self.ever_connected = False
        self.empty_since = None

    def touch(self, tab_id):
        now = self._clock()
        self.tabs[tab_id] = now
        self.ever_connected = True
        self.empty_since = None

    def release(self, tab_id):
        self.tabs.pop(tab_id, None)
        if self.ever_connected and not self.tabs and self.empty_since is None:
            self.empty_since = self._clock()

    def should_stop(self):
        now = self._clock()
        for tab_id, last_seen in list(self.tabs.items()):
            if now - last_seen >= self.stale_after:
                del self.tabs[tab_id]
        if self.ever_connected and not self.tabs:
            if self.empty_since is None:
                self.empty_since = now
            return now - self.empty_since >= self.close_grace
        self.empty_since = None
        return False
