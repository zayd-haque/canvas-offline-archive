"""[Codex] Legacy synthesis dispatches portable, contained atomic writes."""
import tests
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from canvas_app import server
import canvas_blueprint


class WindowsSynthesisTests(unittest.TestCase):
    def windows_api(self):
        return SimpleNamespace(**{key: getattr(os, key) for key in dir(os) if key != "name"}, name="nt")

    def test_windows_synthesis_publishes_root_and_nested_blueprints(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "History Archive"
            nested = root / "Lecture Resources"
            nested.mkdir(parents=True)
            (nested / "Lecture 1.pdf").write_text("synthetic document")
            with patch.object(canvas_blueprint, "os", self.windows_api()), patch.object(canvas_blueprint, "_open_blueprint_directory", side_effect=AssertionError("POSIX directory API must not run")):
                bp = canvas_blueprint.synthesize_course_blueprint(root, course_name="History 101", save=True)
            self.assertEqual(bp.course_name, "History 101")
            self.assertTrue((root / "canvas_course.json").is_file())
            self.assertTrue((nested / "canvas_course.json").is_file())
            self.assertTrue((root / "History 101 Assignments_and_Milestones_Timeline.md").is_file())

    def test_windows_synthesis_preflights_all_destinations(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td) / "History Archive"
            root.mkdir()
            (root / "Lecture 1.pdf").write_text("synthetic document")
            (root / "History 101 Assignments_and_Milestones_Timeline.md").mkdir()
            with patch.object(canvas_blueprint, "os", self.windows_api()), patch.object(canvas_blueprint, "_atomic_blueprint_write_windows") as writer:
                with self.assertRaisesRegex(ValueError, "regular files"):
                    canvas_blueprint.synthesize_course_blueprint(root, course_name="History 101", save=True)
            writer.assert_not_called()
            self.assertFalse((root / "canvas_course.json").exists())
