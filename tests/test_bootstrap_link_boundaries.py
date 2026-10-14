"""[Codex] Bootstrap link boundaries using disposable synthetic directories."""

import contextlib
import io
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import tests


ROOT = Path(__file__).resolve().parents[1]


class ShellBootstrapLinkTests(unittest.TestCase):
    @unittest.skipUnless(os.name == 'posix', 'The shell launcher runs on Unix')
    def test_reinstall_refuses_linked_venv_without_deleting_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            package = base / 'package'
            package.mkdir()
            shutil.copyfile(ROOT / 'bootstrap.sh', package / 'bootstrap.sh')
            external = base / 'external-venv'
            external.mkdir()
            marker = external / 'keep.txt'
            marker.write_text('synthetic sentinel')
            (package / '.venv').symlink_to(external, target_is_directory=True)

            result = subprocess.run(['bash', str(package / 'bootstrap.sh'), '--reinstall', '--setup-only'],
                                    capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue((package / '.venv').is_symlink())
            self.assertEqual(marker.read_text(), 'synthetic sentinel')

    @unittest.skipUnless(os.name == 'posix', 'The shell launcher runs on Unix')
    def test_setup_refuses_linked_config_without_writing_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            package = base / 'package'
            downloader = package / 'Canvas Module Downloader'
            downloader.mkdir(parents=True)
            shutil.copyfile(ROOT / 'bootstrap.sh', package / 'bootstrap.sh')
            (downloader / 'config.example.json').write_text('{}')
            external = base / 'external-config.txt'
            external.write_text('synthetic sentinel')
            (downloader / 'config.json').symlink_to(external)

            result = subprocess.run(['bash', str(package / 'bootstrap.sh'), '--setup-only'],
                                    capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue((downloader / 'config.json').is_symlink())
            self.assertEqual(external.read_text(), 'synthetic sentinel')


class WindowsBootstrapLinkTests(unittest.TestCase):
    def test_rejects_symlinked_venv_and_config_before_setup(self):
        import bootstrap_windows

        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            package = base / 'package'
            downloader = package / 'Canvas Module Downloader'
            downloader.mkdir(parents=True)
            outside = base / 'outside'
            outside.mkdir()
            marker = outside / 'keep.txt'
            marker.write_text('synthetic sentinel')
            venv = package / '.venv'
            config = downloader / 'config.json'
            venv.symlink_to(outside, target_is_directory=True)
            config.symlink_to(marker)

            for linked in (venv, config):
                with self.subTest(linked=linked.name):
                    if linked == config:
                        venv.unlink()
                        venv.mkdir()
                    with mock.patch.object(bootstrap_windows, 'ROOT', package), \
                         mock.patch.object(bootstrap_windows, 'VENV', venv), \
                         mock.patch.object(bootstrap_windows, 'PYTHON', venv / 'Scripts' / 'python.exe'), \
                         mock.patch.object(bootstrap_windows.sys, 'platform', 'win32'), \
                         mock.patch.object(bootstrap_windows.sys, 'version_info', (3, 14, 0)), \
                         mock.patch.object(bootstrap_windows.venv, 'create') as create, \
                         mock.patch.object(bootstrap_windows.shutil, 'rmtree') as remove, \
                         mock.patch.object(bootstrap_windows, 'run') as run, \
                         mock.patch.object(sys, 'argv', ['bootstrap_windows.py', '--setup-only', '--reinstall']), \
                         contextlib.redirect_stderr(io.StringIO()):
                        with self.assertRaises(SystemExit):
                            bootstrap_windows.main()
                        create.assert_not_called()
                        remove.assert_not_called()
                        run.assert_not_called()
            self.assertEqual(marker.read_text(), 'synthetic sentinel')

    def test_reject_link_detects_windows_junction(self):
        import bootstrap_windows

        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'junction'
            path.mkdir()
            parser = mock.Mock()
            parser.error.side_effect = ValueError('linked path')
            with mock.patch.object(Path, 'is_junction', return_value=True, create=True):
                with self.assertRaisesRegex(ValueError, 'linked path'):
                    bootstrap_windows._reject_link(path, parser)
            parser.error.assert_called_once()


if __name__ == '__main__':
    unittest.main()
