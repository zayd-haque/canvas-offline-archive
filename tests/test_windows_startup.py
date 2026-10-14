"""[Codex] Windows folder layout, upgrade preservation, and native shell syntax."""
import tests
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from tools import build_release_package as builder
from tools.validate_release_assets import validate_package
from release_updater import _asset_path, _install_archive

ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = 'Open Canvas Offline Archive Windows.cmd'


class WindowsFolderStartupTests(unittest.TestCase):
    def build(self, root):
        sources = root / 'sources'
        sources.mkdir()
        names = ['requirements.txt', 'release_updater.py', 'bootstrap_windows.py',
                 'bootstrap_windows.ps1', 'canvas_app/run.py', 'canvas_app/static/index.html',
                 LAUNCHER, 'WINDOWS_INSTALL.md']
        files = []
        for name in names:
            source = sources / name
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_text('synthetic source')
            files.append((name, source))
        archive = root / 'windows.zip'
        with patch.object(builder, 'package_files', return_value=files), \
             patch.object(sys, 'argv', ['build', str(archive), '--platform', 'windows',
                                       '--tag', 'v-test', '--preview']):
            self.assertEqual(builder.main(), 0)
        return archive

    def test_tidy_package_has_one_loose_command_and_all_setup_files_inside(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = self.build(Path(temporary))
            metadata = validate_package(archive, 'windows', 'v-test', allow_preview=True)
            self.assertTrue(metadata['preview'])
            with zipfile.ZipFile(archive) as zipped:
                loose = [name for name in zipped.namelist() if len(Path(name).parts) == 2]
                self.assertEqual(loose, ['canvas-offline-archive/' + LAUNCHER])
                self.assertIn('canvas-offline-archive/App Files/bootstrap_windows.ps1', zipped.namelist())
                self.assertIn('canvas-offline-archive/App Files/WINDOWS_INSTALL.md', zipped.namelist())

    def test_tidy_updates_preserve_settings_archives_and_both_environments(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = self.build(root)
            for nested in (False, True):
                app = root / ('tidy' if nested else 'legacy')
                if nested:
                    app /= 'App Files'
                config = app / 'Canvas Module Downloader/config.json'
                config.parent.mkdir(parents=True)
                config.write_text('private synthetic settings')
                sentinels = [config, app / '.python/python.exe',
                             app / '.venv/Scripts/python.exe', app / 'Archives/course/notes.txt']
                for sentinel in sentinels[1:]:
                    sentinel.parent.mkdir(parents=True, exist_ok=True)
                    sentinel.write_text('keep')
                before = {path: path.read_bytes() for path in sentinels}
                _install_archive(app, archive, 'windows', 'v-test')
                self.assertTrue((app / 'bootstrap_windows.ps1').is_file())
                for path, expected in before.items():
                    self.assertEqual(path.read_bytes(), expected)

    def test_validation_rejects_loose_docs_or_missing_automatic_setup(self):
        for bad in ('README.md', 'bootstrap_windows.py', 'missing-powershell'):
            with self.subTest(bad=bad), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                archive = self.build(root)
                invalid = root / 'invalid.zip'
                with zipfile.ZipFile(archive) as source, zipfile.ZipFile(invalid, 'w') as target:
                    for item in source.infolist():
                        if bad == 'missing-powershell' and item.filename.endswith('/bootstrap_windows.ps1'):
                            continue
                        target.writestr(item, source.read(item))
                    if bad != 'missing-powershell':
                        target.writestr('canvas-offline-archive/' + bad, 'loose file')
                with self.assertRaises(ValueError):
                    validate_package(invalid, 'windows', 'v-test', allow_preview=True)

    def test_updater_cannot_write_runtime_or_unexpected_powershell_scripts(self):
        self.assertEqual(_asset_path('canvas-offline-archive/App Files/bootstrap_windows.ps1'),
                         'bootstrap_windows.ps1')
        for name in ('.python/python.exe', '.venv/Scripts/python.exe', 'extra.ps1',
                     'Canvas Module Downloader/config.json'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                _asset_path('canvas-offline-archive/App Files/' + name)

    @unittest.skipUnless(sys.platform == 'win32', 'Requires native Windows PowerShell')
    def test_windows_powershell_parser_and_help_work_without_python(self):
        shell = Path(os.environ['SystemRoot']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
        script = ROOT / 'bootstrap_windows.ps1'
        # PowerShell's actual parser validates the entire file, including functions.
        with tempfile.TemporaryDirectory() as temporary:
            parser = Path(temporary) / 'parse.ps1'
            parser.write_text("$errors=$null; $tokens=$null; [System.Management.Automation.Language.Parser]::ParseFile($args[0],[ref]$tokens,[ref]$errors) | Out-Null; if($errors.Count){exit 1}")
            result = subprocess.run([str(shell), '-NoProfile', '-ExecutionPolicy', 'Bypass',
                                     '-File', str(parser), str(script)],
                                    capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr)
            copied = Path(temporary) / 'bootstrap_windows.ps1'
            copied.write_text(script.read_text())
            result = subprocess.run([str(shell), '-NoProfile', '-ExecutionPolicy', 'Bypass',
                                     '-File', str(copied), '--help'],
                                    capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((copied.parent / '.python').exists())
