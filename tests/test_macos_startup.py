"""[Codex] Clean-folder startup, private runtime integrity, and upgrade contracts."""
import tests
import hashlib
import io
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from tools import build_release_package as builder
from tools.validate_release_assets import validate_package
from release_updater import _asset_path, _install_archive, maybe_update

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(os.name == 'posix', 'Mac shell checks need Unix')
class MacRuntimeTests(unittest.TestCase):
    def run_setup(self, root, architecture='arm64', corrupt=False, python_ok=True, download_fails=False):
        package = root / 'App Files'
        package.mkdir(exist_ok=True)
        commands = root / 'commands'
        commands.mkdir()
        archive = root / 'runtime.tar.gz'
        with tarfile.open(archive, 'w:gz') as output:
            payload = b'#!/bin/bash\nexit ' + (b'0' if python_ok else b'1') + b'\n'
            entry = tarfile.TarInfo('python/bin/python3.14')
            entry.mode = 0o755
            entry.size = len(payload)
            output.addfile(entry, io.BytesIO(payload))
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        # Fixture pin replaces the production pin; all hash/extract logic is real.
        source = (ROOT / 'bootstrap.sh').read_text().split('# Step 1: Detect')[0]
        for pin in ('709f419d175eb015f810b68aa54bdae1d776c9824cb362aa701c93b0a9f2a9e7',
                    'e09bce050cf075e777d1a802c4a11b6d43d54291b5f76911887173b28ad9c9fd'):
            source = source.replace(pin, '0' * 64 if corrupt else digest)
        (package / 'bootstrap.sh').write_text(source + '\ninstall_private_python\n')
        (commands / 'uname').write_text('#!/bin/bash\necho "$SYNTHETIC_ARCH"\n')
        (commands / 'curl').write_text(
            '#!/bin/bash\nwhile [ "$#" -gt 0 ]; do\n'
            'if [ "$1" = --output ]; then cp "$SYNTHETIC_ARCHIVE" "$2"; exit; fi\nshift\ndone\nexit 1\n')
        if download_fails:
            (commands / 'curl').write_text('#!/bin/bash\nexit 22\n')
        for command in commands.iterdir():
            command.chmod(0o755)
        return subprocess.run(['/bin/bash', str(package / 'bootstrap.sh')],
                              env={'PATH': str(commands) + ':/usr/bin:/bin', 'HOME': str(root),
                                   'SYNTHETIC_ARCH': architecture, 'SYNTHETIC_ARCHIVE': str(archive)},
                              capture_output=True, text=True, timeout=10)

    def test_both_mac_architectures_publish_verified_private_runtime(self):
        for architecture in ('arm64', 'x86_64'):
            with self.subTest(architecture=architecture), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                result = self.run_setup(root, architecture)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertTrue((root / 'App Files/.python/bin/python3.14').is_file())
                self.assertFalse((root / 'App Files/.python-install.lock').exists())
                self.assertFalse(list((root / 'App Files').glob('.python-download.*')))
                # Offline reuse cannot invoke our deliberately failing download command.
                (root / 'commands/curl').write_text('#!/bin/bash\nexit 99\n')
                reused = subprocess.run(['/bin/bash', str(root / 'App Files/bootstrap.sh')],
                                        env={'PATH': str(root / 'commands') + ':/usr/bin:/bin',
                                             'HOME': str(root)}, capture_output=True, timeout=10)
                self.assertEqual(reused.returncode, 0)

    def test_hash_failure_or_invalid_runtime_never_publishes_python(self):
        for options in ({'corrupt': True}, {'python_ok': False}, {'download_fails': True}):
            with self.subTest(options=options), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                result = self.run_setup(root, **options)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((root / 'App Files/.python').exists())
                self.assertFalse((root / 'App Files/.python-install.lock').exists())
                self.assertFalse(list((root / 'App Files').glob('.python-download.*')))

    def test_linked_runtime_cannot_write_outside_app(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package = root / 'App Files'
            package.mkdir()
            outside = root / 'outside'
            outside.mkdir()
            (outside / 'keep').write_text('sentinel')
            (package / '.python').symlink_to(outside, target_is_directory=True)
            result = self.run_setup(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual((outside / 'keep').read_text(), 'sentinel')
            self.assertEqual(list(outside.iterdir()), [outside / 'keep'])

    def test_double_click_launcher_handles_spaces_and_legacy_folder(self):
        for nested in (True, False):
            with self.subTest(nested=nested), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary) / 'My Canvas Folder'
                app = root / 'App Files' if nested else root
                app.mkdir(parents=True)
                launcher = root / 'Open Canvas Offline Archive.command'
                launcher.write_text((ROOT / launcher.name).read_text())
                (app / 'bootstrap.sh').write_text('#!/bin/bash\npwd > launched.txt\n')
                result = subprocess.run(['/bin/bash', str(launcher)], cwd=temporary,
                                        capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0)
                self.assertEqual((app / 'launched.txt').read_text().strip(), str(app))


class MacPackageTests(unittest.TestCase):
    def test_preview_package_cannot_replace_itself_with_public_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'release_info.json').write_text(json.dumps({'preview': True, 'tag': 'v-startup-check'}))
            with patch('release_updater.socket.create_connection', side_effect=OSError), \
                 patch('release_updater._request_json') as request:
                self.assertFalse(maybe_update(root, 'macos'))
                request.assert_not_called()

    def test_real_package_includes_install_guides_and_runtime_imports(self):
        # The isolated suite runs from a Git-free source export. Required files
        # must be included even when Git's tracked-file list contributes none.
        with patch.object(builder.subprocess, 'check_output', return_value=b''):
            files = dict(builder.package_files())
        self.assertEqual(files['INSTALL.md'], ROOT / 'INSTALL.md')
        self.assertEqual(files['WINDOWS_INSTALL.md'], ROOT / 'WINDOWS_INSTALL.md')
        for name in ('Canvas Module Downloader/keyword_classifier.py',
                     'Canvas Module Downloader/cloud_privacy.py'):
            self.assertIn(name, files)

    def test_tidy_zip_validates_and_upgrades_both_installed_layouts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            sources = root / 'sources'
            sources.mkdir()
            names = ['requirements.txt', 'release_updater.py', 'bootstrap.sh',
                     'canvas_app/run.py', 'canvas_app/static/index.html',
                     'Open Canvas Offline Archive.command', 'INSTALL.md']
            files = []
            for name in names:
                source = sources / name
                source.parent.mkdir(parents=True, exist_ok=True)
                source.write_text('synthetic app')
                files.append((name, source))
            archive = root / 'release.zip'
            with patch.object(builder, 'package_files', return_value=files), \
                 patch.object(sys, 'argv', ['build', str(archive), '--tag', 'v-test', '--preview']):
                self.assertEqual(builder.main(), 0)
            self.assertTrue(validate_package(archive, 'macos', 'v-test', allow_preview=True)['preview'])
            with self.assertRaisesRegex(ValueError, 'Preview packages'):
                validate_package(archive, 'macos', 'v-test')
            with zipfile.ZipFile(archive) as zipped:
                visible = {Path(name).parts[1] for name in zipped.namelist()}
                self.assertEqual(visible, {'Open Canvas Offline Archive.command', 'App Files'})
                launcher = zipped.getinfo('canvas-offline-archive/Open Canvas Offline Archive.command')
                self.assertTrue((launcher.external_attr >> 16) & 0o111)
            for nested in (False, True):
                install = root / ('tidy' if nested else 'legacy')
                app = install / 'App Files' if nested else install
                private = app / 'Canvas Module Downloader/config.json'
                private.parent.mkdir(parents=True)
                private.write_text('private synthetic settings')
                for directory in ('.venv', '.python'):
                    (app / directory).mkdir()
                    (app / directory / 'keep').write_text('preserve')
                _install_archive(app, archive, 'macos', 'v-test')
                self.assertEqual(private.read_text(), 'private synthetic settings')
                self.assertEqual((app / 'canvas_app/run.py').read_text(), 'synthetic app')
                for directory in ('.venv', '.python'):
                    self.assertEqual((app / directory / 'keep').read_text(), 'preserve')

    def test_nested_update_paths_still_reject_private_files_and_traversal(self):
        for relative in ('../private.txt', '.python/bin/python3.14', '.venv/keep',
                         'Canvas Module Downloader/config.json', 'App Files/bootstrap.sh'):
            with self.subTest(relative=relative), self.assertRaises(ValueError):
                _asset_path('canvas-offline-archive/App Files/' + relative)

    def test_tidy_mac_validation_rejects_loose_files_and_nonexecutable_launcher(self):
        for loose in ('README.md', 'INSTALL.md', 'bootstrap.sh', None):
            with self.subTest(loose=loose), tempfile.TemporaryDirectory() as temporary:
                archive = Path(temporary) / 'test.zip'
                prefix = 'canvas-offline-archive/'
                with zipfile.ZipFile(archive, 'w') as zipped:
                    for name in ('requirements.txt', 'release_updater.py', 'bootstrap.sh',
                                 'canvas_app/run.py', 'canvas_app/static/index.html'):
                        zipped.writestr(prefix + 'App Files/' + name, '')
                    zipped.writestr(prefix + 'App Files/release_info.json', json.dumps({
                        'repository': 'zayd-haque/canvas-offline-archive',
                        'platform': 'macos', 'tag': 'v-test'}))
                    launcher = zipfile.ZipInfo(prefix + 'Open Canvas Offline Archive.command')
                    launcher.external_attr = (0o644 if loose is None else 0o755) << 16
                    zipped.writestr(launcher, '#!/bin/bash\n')
                    if loose:
                        zipped.writestr(prefix + loose, 'unexpected loose file')
                with self.assertRaises(ValueError):
                    validate_package(archive, 'macos', 'v-test')
