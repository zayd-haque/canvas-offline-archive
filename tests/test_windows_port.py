"""[Codex] Windows branches exercised without a Windows host or user archive."""

import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'Canvas Module Downloader'))
import tests

import canvas_blueprint
from canvas_app import native, native_windows


class WindowsPortTests(unittest.TestCase):
    def test_windows_native_open_and_reveal(self):
        with tempfile.TemporaryDirectory() as temporary:
            file = Path(temporary) / 'notes.pdf'
            file.write_bytes(b'example')
            with mock.patch.object(native.sys, 'platform', 'win32'), \
                 mock.patch.object(native_windows.os, 'startfile', create=True) as start, \
                 mock.patch.object(native_windows.subprocess, 'run') as run:
                native.open_path(file, 'open')
                start.assert_called_once_with(str(file))
                native.open_path(file, 'reveal')
                run.assert_called_once_with(['explorer.exe', '/select,', str(file)], check=True, timeout=10)

    def test_windows_blueprint_publication(self):
        with tempfile.TemporaryDirectory() as temporary:
            course = Path(temporary) / 'TEST 101'
            course.mkdir()
            blueprint = canvas_blueprint.CourseBlueprint('TEST 101', '', str(course))
            windows_os = types.SimpleNamespace(**os.__dict__)
            windows_os.name = 'nt'
            with mock.patch.object(canvas_blueprint, 'os', windows_os), \
                 mock.patch.object(blueprint, 'hydrate_from_canvas_api'), \
                 mock.patch.object(blueprint, 'link_module_items_to_files'), \
                 mock.patch.object(blueprint, 'compile_timeline'):
                blueprint.save(str(course))
            self.assertTrue((course / 'canvas_course.json').is_file())
            self.assertTrue((course / 'TEST 101 Assignments_and_Milestones_Timeline.md').is_file())
            self.assertFalse(list(course.glob('.blueprint-*')))


if __name__ == '__main__':
    unittest.main()
