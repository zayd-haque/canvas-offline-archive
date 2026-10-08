# downloader.py
# [Codex] HTTPS downloader with in-memory scoped cookies and atomic publication.
# Reads the module map; never persists authentication in course folders.

import os
import re
import json
import time
from urllib.parse import urlparse
import requests
from sleep_helper import wait_for_network_resume, check_internet_connection
from capturer import sanitize_filename


class BrowserCookieSession(requests.Session):
    """[Codex] Apply host-only scope to the jar actually preparing each request."""

    def prepare_request(self, request):
        from http.cookiejar import DefaultCookiePolicy
        prepared = super().prepare_request(request)
        prepared._cookies.set_policy(DefaultCookiePolicy(
            strict_ns_domain=DefaultCookiePolicy.DomainStrictNonDomain))
        prepared.headers.pop("Cookie", None)
        prepared.prepare_cookies(prepared._cookies)
        return prepared


def create_session(cookies_path=None, cookies=None):
    """[Codex] Preserve browser cookie security; persistent cookie exports are unsupported."""
    if cookies_path is not None:
        raise ValueError("Cookie files are no longer accepted; authenticate through the launcher")
    session = BrowserCookieSession()
    from http.cookiejar import DefaultCookiePolicy
    session.cookies.set_policy(DefaultCookiePolicy(strict_ns_domain=DefaultCookiePolicy.DomainStrictNonDomain))
    for cookie in cookies or []:
        if not cookie.get("domain"):
            continue
        expiry = cookie.get("expires")
        session.cookies.set(cookie["name"], cookie["value"],
            domain=cookie.get("domain", ""), path=cookie.get("path", "/"),
            secure=bool(cookie.get("secure", True)),
            expires=int(expiry) if expiry is not None and expiry > 0 else None)
    for stored in session.cookies:
        if not stored.domain.startswith('.'):
            stored.domain_specified = False
    return session


def _https_response(session, url):
    from urllib.parse import urljoin
    for _ in range(6):
        parsed = urlparse(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Downloads require HTTPS URLs without credentials")
        response = session.get(url, stream=True, allow_redirects=False, timeout=25)
        if response.status_code in (301, 302, 303, 307, 308):
            location = response.headers.get("Location", "")
            response.close()
            if not location:
                raise ValueError("Missing redirect destination")
            url = urljoin(url, location)
            continue
        return response
    raise ValueError("Too many download redirects")


def download_file(session, url, title, temp_dir):
    """[Codex] Atomic bounded downloads; stable URL identity prevents basename collisions."""
    import hashlib
    import tempfile
    from safety import contained_path, unique_destination
    response = None
    partial = None
    for attempt in range(3):
        try:
            response = _https_response(session, url)
            if response.status_code != 200:
                raise ValueError("Download request rejected")
            cd = response.headers.get("Content-Disposition", "")
            match = re.search(r'filename\*?=(?:UTF-8\'\')?["\']?([^"\';]+)', cd)
            filename = match.group(1) if match else os.path.basename(urlparse(response.url).path)
            if not filename or "." not in filename:
                filename = f"{title}.pdf"
            clean = sanitize_filename(filename)
            stem, ext = os.path.splitext(clean)
            identity = hashlib.sha256(url.encode()).hexdigest()[:12]
            clean = f"{stem[:140]}-{identity}{ext[:20]}"
            target = contained_path(temp_dir, clean)
            limit = 512 * 1024 * 1024
            expected = int(response.headers.get("Content-Length", "0") or 0)
            if expected > limit:
                raise ValueError("Download exceeds size limit")
            fd, partial = tempfile.mkstemp(prefix=".download-", dir=temp_dir)
            count = 0
            with os.fdopen(fd, "wb") as out:
                for chunk in response.iter_content(chunk_size=65536):
                    count += len(chunk)
                    if count > limit:
                        raise ValueError("Download exceeds size limit")
                    out.write(chunk)
                out.flush()
                os.fsync(out.fileno())
            if not count or (expected and not response.headers.get("Content-Encoding") and expected != count):
                raise ValueError("Incomplete download")
            if os.path.exists(target):
                def digest(path):
                    h = hashlib.sha256()
                    with open(path, "rb") as handle:
                        for block in iter(lambda: handle.read(65536), b""):
                            h.update(block)
                    return h.digest()
                if digest(target) == digest(partial):
                    return os.path.basename(target)
                target = unique_destination(target)
            from safety import move_unique
            published = move_unique(partial, target)
            partial = None
            return os.path.basename(published)
        except (requests.RequestException, OSError, ValueError):
            print(f"   Download attempt {attempt + 1}/3 failed; no partial file published.")
        finally:
            if response is not None:
                response.close()
                response = None
            if partial and os.path.exists(partial):
                os.unlink(partial)
            partial = None
    return ""


def download_all(output_dir: str, cookies=None) -> int:
    """Download the module map using launcher-supplied in-memory authentication."""
    from safety import contained_path, validate_tree, atomic_json
    validate_tree(output_dir)
    modules_map_path = contained_path(output_dir, ".modules_map.json")
    temp_dir = contained_path(output_dir, ".temp_downloads")

    if not os.path.exists(modules_map_path):
        print("❌ No modules map found. Run the launcher first.")
        return 0

    os.makedirs(temp_dir, exist_ok=True)

    # Load session
    session = create_session(cookies=cookies)

    try:
        # Load modules map
        with open(modules_map_path, "r", encoding="utf-8") as f:
            modules_data = json.load(f)

        downloadable_items = modules_data.get("downloadable_items", [])
        print(f"\n📥 Starting download of {len(downloadable_items)} files...")

        file_metadata = {}
        downloaded_count = 0
        for index, item in enumerate(downloadable_items, start=1):
            title = item.get("title", "Unknown")
            url = item.get("url", "")
            mod_name = item.get("module_name", "")
            page_title = item.get("page_title", title)
            local_file = item.get("local_file")

            if local_file:
                file_metadata[local_file] = {
                    "title": title,
                    "page_title": page_title,
                    "module_name": mod_name
                }
                continue

            print(f"[{index}/{len(downloadable_items)}] Downloading: '{title}'")

            downloaded_name = download_file(session, url, title, temp_dir)
            if downloaded_name:
                downloaded_count += 1
                file_metadata[downloaded_name] = {
                    "title": title,
                    "page_title": page_title,
                    "module_name": mod_name
                }

        # Save file metadata map
        meta_path = contained_path(output_dir, ".file_metadata.json")
        atomic_json(meta_path, file_metadata)
        print(f"📋 File metadata map saved ({len(file_metadata)} items mapped).")

        print(f"\n✅ Download complete! {downloaded_count}/{len(downloadable_items)} files saved to .temp_downloads/")
    finally:
        session.close()
        if cookies is not None:
            cookies.clear()
    return downloaded_count


if __name__ == "__main__":
    out = input("Output directory: ").strip()
    download_all(out)
