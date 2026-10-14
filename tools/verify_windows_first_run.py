"""[Codex] Real Windows one-click setup using disposable data and no Python on PATH.

Run on Windows after building the source checkout. Downloads only the pinned
runtime/dependencies/Chromium; never uses Canvas, cloud AI, or personal profiles.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

BROWSER_CHECK = r'''
import json, os, sys, time
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
root = Path(os.environ['CANVAS_FIXTURE_ROOT'])
report = {'passed': False, 'javascript_errors': [], 'external_hosts': []}
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page()
            page.on('pageerror', lambda error: report['javascript_errors'].append(str(error)))
            page.on('request', lambda req: report['external_hosts'].append(urlparse(req.url).hostname)
                    if urlparse(req.url).hostname not in ('127.0.0.1', None) else None)
            page.goto(sys.argv[1], wait_until='domcontentloaded')
            page.locator('#onboarding-overlay').wait_for(state='visible', timeout=30000)
            page.locator('#onboarding-skip').click()
            assert page.request.get('http://127.0.0.1:8000/api/courses').json() == {'courses': []}
            page.locator('#nav-btn-settings').click()
            page.locator('#settings-modal').wait_for(state='visible')
            page.locator('#btn-close-settings').click()
            page.locator('#settings-modal').wait_for(state='hidden')
            page.locator('#nav-btn-launcher').click()
            page.locator('#view-launcher').wait_for(state='visible')
            assert not report['javascript_errors']
            assert not report['external_hosts']
            report['passed'] = True
            # A real navigation delivers pagehide/beacon before browser teardown.
            page.goto('about:blank')
            page.wait_for_timeout(1000)
        finally:
            browser.close()
except BaseException as exc:
    report['failure_type'] = type(exc).__name__
finally:
    (root / 'browser-report.json').write_text(json.dumps(report), encoding='utf-8')
# Always handle the launch URL so a fixture failure cannot open a personal browser.
sys.exit(0)
'''


def main() -> int:
    if sys.platform != 'win32':
        raise SystemExit('Run this fixture on native Windows.')
    source = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix='canvas-first-run-') as temporary:
        root = Path(temporary)
        archive = root / 'windows.zip'
        subprocess.run([sys.executable, str(source / 'tools/build_release_package.py'),
                        str(archive), '--platform', 'windows', '--tag', 'v-startup-check', '--preview'],
                       check=True, cwd=source)
        with zipfile.ZipFile(archive) as zipped:
            zipped.extractall(root / 'Install With Spaces')
        folder = root / 'Install With Spaces/canvas-offline-archive'
        app = folder / 'App Files'
        launcher = folder / 'Open Canvas Offline Archive Windows.cmd'
        assert sorted(p.name for p in folder.iterdir()) == ['App Files', launcher.name]
        home = root / 'Home'
        home.mkdir()
        env = os.environ.copy()
        for key in ('GEMINI_API_KEY', 'GOOGLE_API_KEY', 'PYTHONPATH', 'PYTHONHOME',
                    'CANVAS_CACHE_DIR', 'PLAYWRIGHT_BROWSERS_PATH', 'CANVAS_OFFLINE_NO_UPDATE',
                    'OLLAMA_HOST'):
            env.pop(key, None)
        for name in ('AppData', 'LocalAppData', 'Temp'):
            (home / name).mkdir()
        system = Path(env['SYSTEMROOT']) / 'System32'
        env.update(HOME=str(home), USERPROFILE=str(home),
                   APPDATA=str(home / 'AppData'), LOCALAPPDATA=str(home / 'LocalAppData'),
                   TEMP=str(home / 'Temp'), TMP=str(home / 'Temp'),
                   PATH=str(system), PYTHONIOENCODING='utf-8', CANVAS_FIXTURE_ROOT=str(root))
        browser = root / 'browser-check.py'
        browser.write_text(BROWSER_CHECK, encoding='utf-8')
        python = app / '.venv/Scripts/python.exe'
        env['BROWSER'] = f'"{python}" "{browser}" %s'
        command = [str(system / 'cmd.exe'), '/d', '/c', str(launcher)]
        log = root / 'startup.log'
        with log.open('wb') as output:
            process = subprocess.Popen(command, cwd=folder, env=env, stdin=subprocess.DEVNULL,
                                       stdout=output, stderr=subprocess.STDOUT)
            try:
                status = process.wait(timeout=900)
            finally:
                if process.poll() is None:
                    subprocess.run([str(system / 'taskkill.exe'), '/PID', str(process.pid), '/T', '/F'],
                                   check=True, stdout=subprocess.DEVNULL, timeout=30)
                    process.wait(timeout=30)
        if status != 0:
            print(log.read_text(encoding='utf-8', errors='replace')[-12000:])
        assert status == 0, 'Default Windows launcher failed; inspect fixture startup output.'
        report = json.loads((root / 'browser-report.json').read_text(encoding='utf-8'))
        assert report['passed'], report
        assert (app / '.python/python.exe').is_file()
        assert python.is_file()
        assert sorted(p.name for p in folder.iterdir()) == ['App Files', launcher.name]
        # Reuse the installation without a runtime download or Python on PATH.
        subprocess.run(command + ['--setup-only'], cwd=folder, env=env, check=True,
                       stdin=subprocess.DEVNULL, timeout=180)
        print('WINDOWS_ONE_CLICK_PRIVATE_PYTHON_AUTHENTICATED_UI_AND_CLEAN_FOLDER_PASS')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
