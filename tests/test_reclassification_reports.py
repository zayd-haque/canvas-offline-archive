"""[Codex] Generated reports remain intact and out of organizer staging."""
import tests
import ast
import json
import os
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tests.organization_benchmark import organizer
import safety


def reclassification_functions():
    source = Path(__file__).resolve().parents[1] / 'Canvas Module Downloader' / 'main.py'
    tree = ast.parse(source.read_text(encoding='utf-8'))
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                 and node.name in {'run_local_reclassify', 'is_generated_reclassification_report'}]
    namespace = {'os': os, 're': re, 'CONFIG_PATH': 'unused-synthetic-config'}
    for name in ('resolve_course_root', 'validate_tree', 'contained_path', 'unique_destination',
                 'atomic_json', 'move_unique', 'validate_component'):
        namespace[name] = getattr(safety, name)
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), 'exec'), namespace)
    return namespace


class ReclassificationReportTests(unittest.TestCase):
    def test_staging_omits_reports_and_preserves_originals_on_cancellation(self):
        functions = reclassification_functions()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve() / 'DEMO 101'
            materials = root / 'Resources'
            work = root / 'DEMO 101 Work'
            materials.mkdir(parents=True)
            work.mkdir()
            (root / 'canvas_course.json').write_text('{}', encoding='utf-8')
            reports = [root / 'DEMO 101 Assignments_and_Milestones_Timeline.md',
                       materials / 'Assignments_and_Milestones_Timeline (1) (2).md',
                       work / 'DEMO 101 Announcements_Assigned_Homework (1) (2).md',
                       work / 'Announcements_Assigned_Homework.md']
            originals = {}
            for index, path in enumerate(reports):
                originals[path] = ('Preserved synthetic report %d\n' % index).encode()
                path.write_bytes(originals[path])
            attachment = materials / 'lecture.txt'
            announcement = materials / '2031-04-05 - 123456 - Homework Notice.md'
            attachment.write_bytes(b'Actual instructional document')
            announcement.write_bytes(b'# Announcement\nA homework deadline changed.')
            captured = {}
            def interrupted(out, *args):
                staging = Path(out) / '.temp_downloads'
                captured['names'] = {path.name for path in staging.iterdir() if not path.name.startswith('.')}
                captured['sources'] = json.loads((staging / '.reclassify_manifest.json').read_text())['sources']
                raise KeyboardInterrupt('Synthetic cancellation')
            with patch.object(organizer, 'organize', side_effect=interrupted):
                with self.assertRaises(KeyboardInterrupt):
                    functions['run_local_reclassify'](str(materials), 'DEMO 101')
            self.assertEqual(captured['names'], {attachment.name, announcement.name})
            self.assertEqual(set(captured['sources']), {str(attachment), str(announcement)})
            for path, content in originals.items():
                self.assertEqual(path.read_bytes(), content)
            self.assertEqual(attachment.read_bytes(), b'Actual instructional document')
            self.assertTrue(announcement.is_file())

    def test_report_matching_is_exact_and_course_prefix_is_escaped(self):
        match = reclassification_functions()['is_generated_reclassification_report']
        self.assertTrue(match('DEMO+101 Announcements_Assigned_Homework (1) (2).MD', 'DEMO+101'))
        for filename in ('DEMOO101 Announcements_Assigned_Homework.md',
                         'Assignments_and_Milestones_Timeline_notes.md',
                         'Announcements_Assigned_Homework.pdf',
                         'Other Course Announcements_Assigned_Homework.md',
                         '2031-04-05 - 123456 - Announcements_Assigned_Homework.md',
                         'Announcements_Assigned_Homework (draft).md'):
            with self.subTest(filename=filename):
                self.assertFalse(match(filename, 'DEMO+101'))

    def test_invalid_course_names_are_rejected_before_report_matching(self):
        match = reclassification_functions()['is_generated_reclassification_report']
        for course in ('..', '../escape', '/absolute', 'a/b', ''):
            with self.subTest(course=course), self.assertRaises(ValueError):
                match('Announcements_Assigned_Homework.md', course)
