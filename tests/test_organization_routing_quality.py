"""[Codex] Synthetic end-to-end organization preserves classifier purpose.

Uses disposable course roots and real blueprint persistence, with all model,
discovery, pacing and auxiliary provider work mocked. No personal archives.
"""
import tests
import json
from contextlib import ExitStack
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch

from tests.organization_benchmark import organizer, FOLDERS
from canvas_blueprint import CourseBlueprint


class OrganizationRoutingQualityTests(unittest.TestCase):
    def test_plain_text_extraction_preserves_sparse_scientific_prose(self):
        content = 'Research Article\nABSTRACT\nWe tested memory effects.\nMethods\nParticipants were randomly assigned to two conditions.\nResults\nPerformance improved.'
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / 'research.txt'
            filename.write_text(content, encoding='utf-8')
            self.assertEqual(organizer.extract_file_text(str(filename)), content)

    def test_docx_extraction_preserves_sparse_scientific_prose(self):
        content = 'Research Article ABSTRACT. We tested memory effects. Participants were randomly assigned. Performance improved.'
        xml = '<w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>' + content + '</w:t></w:r></w:p></w:body></w:document>'
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / 'research.docx'
            with zipfile.ZipFile(filename, 'w') as archive:
                archive.writestr('word/document.xml', xml)
            self.assertEqual(organizer.extract_file_text(str(filename)).strip(), content)

    def run_organization(self, provider, documents, category=None, custom_folders=None):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        course = 'SYNTHETIC 101'
        root = Path(temporary.name).resolve() / course
        output = root / (course + ' Lectures & Resources')
        staging = output / '.temp_downloads'
        staging.mkdir(parents=True)
        for filename, content in documents.items():
            (staging / filename).write_text(content, encoding='utf-8')
        blueprint = CourseBlueprint(course, '', str(output))
        blueprint.term = 'Spring 2031'
        blueprint.save(str(output), course_root=str(root))
        config = {'llm_provider': provider, 'ollama_model': 'synthetic-model'}
        if custom_folders is not None:
            config['disk_hierarchy'] = {'custom_folders': custom_folders}
        with ExitStack() as stack:
            stack.enter_context(patch.object(organizer, 'load_config', return_value=config))
            stack.enter_context(patch.object(organizer, 'build_comprehensive_course_knowledge'))
            stack.enter_context(patch.object(organizer, 'process_announcements_for_homework'))
            stack.enter_context(patch.object(organizer, 'sort_gigantic_folders'))
            stack.enter_context(patch.object(organizer, 'check_and_reset_ollama_ram'))
            stack.enter_context(patch.object(organizer.time, 'sleep'))
            stack.enter_context(patch('llm_client.get_system_hardware_profile', return_value={'is_fanless': False}))
            stack.enter_context(patch('llm_client.resolve_ollama_model', return_value='synthetic-model'))
            network = stack.enter_context(patch.object(organizer.requests, 'post'))
            model = stack.enter_context(patch.object(organizer, 'query_llm',
                                       return_value=json.dumps({'category': category})))
            organizer.organize(str(output), course, 'synthetic-config-path')
            calls = model.call_args_list
            if provider == 'rules':
                model.assert_not_called()
                network.assert_not_called()
        return root, output, course, calls

    def assert_document_destination(self, root, output, course, filename, folder):
        final = output / (course + ' ' + folder) / filename
        self.assertTrue(final.is_file(), str(final))
        self.assertEqual(len(list(root.rglob(filename))), 1)
        saved = CourseBlueprint.load(str(output / 'canvas_course.json'))
        self.assertEqual(saved.file_path_map[filename], final.relative_to(root).as_posix())

    def test_rules_current_term_survives_downstream_past_exam_guard(self):
        filename = 'midterm_Spring_2031.txt'
        root, output, course, _ = self.run_organization('rules', {filename: 'Midterm examination\nAnswer all questions.'})
        self.assert_document_destination(root, output, course, filename, FOLDERS['exam'])

    def test_ollama_current_term_survives_downstream_past_exam_guard(self):
        filename = 'midterm_Spring_2031.txt'
        category = next(number for number, folder in organizer.build_category_map(organizer.DEFAULT_FOLDERS).items()
                        if folder == FOLDERS['exam'])
        root, output, course, calls = self.run_organization('ollama', {filename: 'Midterm examination\nAnswer all questions.'}, category)
        self.assert_document_destination(root, output, course, filename, FOLDERS['exam'])
        self.assertEqual(len(calls), 1)
        self.assertIn('Spring 2031', calls[0].args[0])
        self.assertTrue(calls[0].kwargs['deterministic'])

    def test_online_homework_help_keeps_admin_and_activity_gets_subfolder(self):
        help_file = 'InQuizitive - How to Use.txt'
        activity_file = 'InQuizitive - Chapter 12.txt'
        root, output, course, _ = self.run_organization('rules', {
            help_file: 'How to use InQuizitive\nGetting started and account setup instructions.',
            activity_file: 'Load InQuizitive Chapter 12 in a new browser window.',
        })
        self.assert_document_destination(root, output, course, help_file, FOLDERS['admin'])
        self.assert_document_destination(root, output, course, activity_file,
                                         FOLDERS['homework'] + '/InQuizitive Online Homework')

    def test_custom_hierarchy_keeps_online_activity_in_configured_merged_folder(self):
        filename = 'InQuizitive - Chapter 12.txt'
        folders = [{'id': 'a', 'name': 'Shelf A/Bin 1', 'types': ['homework', 'worksheets']},
                   {'id': 'b', 'name': 'Shelf B', 'types': ['other']}]
        root, output, course, _ = self.run_organization('rules', {
            filename: 'Load InQuizitive Chapter 12 in a new browser window.',
        }, custom_folders=folders)
        self.assert_document_destination(root, output, course, filename, 'Shelf A/Bin 1')
        self.assertFalse(any(root.rglob('InQuizitive Online Homework')))

    def test_custom_hierarchy_keeps_action_item_article_in_configured_lecture_folder(self):
        filename = 'ACTION ITEM - Research Article.txt'
        folders = [{'id': 'a', 'name': 'Shelf A', 'types': ['homework']},
                   {'id': 'b', 'name': 'Shelf B/Bin 1', 'types': ['lectures']},
                   {'id': 'c', 'name': 'Shelf C', 'types': ['other']}]
        root, output, course, _ = self.run_organization('rules', {
            filename: 'Research Article\nABSTRACT\nWe tested memory effects.\nMethods\nParticipants were randomly assigned to two conditions.\nResults\nPerformance improved.',
        }, custom_folders=folders)
        self.assert_document_destination(root, output, course, filename, 'Shelf B/Bin 1')

    def test_custom_hierarchy_parent_routes_assignments_to_student_work(self):
        filename = 'homework12.txt'
        folders = [{'id': 'a', 'name': 'Shelf A/Bin 1', 'types': ['homework'], 'parent': 'student_work'},
                   {'id': 'b', 'name': 'Shelf B', 'types': ['other'], 'parent': 'study_materials'}]
        root, output, course, _ = self.run_organization('rules', {
            filename: 'Homework 12\nSubmit the assigned exercises.',
        }, custom_folders=folders)
        work = root / (course + ' Work')
        final = work / (course + ' Shelf A/Bin 1') / filename
        self.assertTrue(final.is_file())
        self.assertEqual(len(list(root.rglob(filename))), 1)
        saved = CourseBlueprint.load(str(output / 'canvas_course.json'))
        self.assertEqual(saved.file_path_map[filename], final.relative_to(root).as_posix())
