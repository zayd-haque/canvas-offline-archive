#!/usr/bin/env python3
"""
Canvas Course Offline Web App - Local Launcher
Starts the local server and automatically opens your web browser.
"""

import os
import sys
import time
import webbrowser
import threading
import socket
import urllib.request
from pathlib import Path

# Add current directory to path
current_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(current_dir))

import uvicorn


def open_browser(bootstrap_token):
    """Wait for the server to start, then open the browser."""
    for _ in range(100):
        try:
            with urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=0.5) as response:
                if response.status == 200:
                    break
        except OSError:
            time.sleep(0.1)
    else:
        print('Server did not become ready. Check the terminal for startup errors.')
        return
    url = "http://127.0.0.1:8000/?launch=" + str(time.time_ns()) + "#bootstrap=" + bootstrap_token
    print("\n🚀 Opening Canvas Course Archive in your browser.\n")
    try:
        webbrowser.open(url)
    except Exception as e:
        print("Notice: Could not open the browser. Restart the launcher after setting a default browser.")


def main():
    print("=" * 60)
    print("  CANVAS COURSE OFFLINE ARCHIVE WEB APP")
    print("  100% Offline Local LMS Replica & Desktop File Explorer")
    print("=" * 60)
    
    # Ensure modular assets are compiled
    try:
        from bundle import build_all
        build_all()
    except Exception as e:
        print(f"Notice: Asset bundling skipped: {e}")

    # [Codex] Own the port before opening a browser; an existing service must
    # never receive this launch's bootstrap attempt.
    import server
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            listener.bind(("127.0.0.1", 8000))
        except OSError:
            print("Port 8000 is already in use. Close the existing server before restarting this launcher.")
            return
        threading.Thread(target=open_browser, args=(server.LOCAL_ACCESS.bootstrap_token,), daemon=True).start()
        config = uvicorn.Config(server.app, host="127.0.0.1", port=8000, reload=False, log_level="info")
        instance = uvicorn.Server(config)
        server.app.state.stop_when_tabs_close = True
        server.app.state.request_shutdown = lambda: setattr(instance, 'should_exit', True)
        try:
            instance.run(sockets=[listener])
        finally:
            # A stopped server must not retain non-daemon OCR/index workers.
            from search_engine import _STOP_INDEXING, _INDEX_POOL
            _STOP_INDEXING.set()
            _INDEX_POOL.shutdown(wait=True, cancel_futures=True)



if __name__ == "__main__":
    main()
