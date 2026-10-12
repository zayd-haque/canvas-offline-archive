"""[Codex] Arbitrary nested destination descriptions and tag precedence."""
import tests
import itertools
import unittest
from unittest.mock import patch
from tests.organization_benchmark import organizer
from keyword_classifier import folder_for_role


class OrganizationHierarchyQualityTests(unittest.TestCase):
    def test_misleading_ancestor_does_not_override_destination_description(self):
        folders = [
            {'name': 'Exams/Cabinet Q', 'description': 'Official homework answer keys and worked assignment solutions.'},
            {'name': 'Exams/Cabinet R', 'description': 'Main lecture slides and readings.'},
            {'name': 'Exams/Cabinet S', 'description': 'Blank discussion worksheets without supplied answers.'},
            {'name': 'Exams/Cabinet T', 'description': 'Current exam question papers without supplied solutions.'},
            {'name': 'Exams/Cabinet U', 'description': 'Unrelated personal files and miscellaneous materials.'},
        ]
        expected = {'homework_solution': 'Exams/Cabinet Q', 'lecture': 'Exams/Cabinet R',
                    'discussion': 'Exams/Cabinet S', 'current_exam': 'Exams/Cabinet T', 'other': 'Exams/Cabinet U'}
        for ordering in itertools.permutations(folders):
            for category, destination in expected.items():
                with self.subTest(order=tuple(f['name'] for f in ordering), category=category):
                    self.assertEqual(folder_for_role(category, ordering), destination)

    def test_explicit_semantic_tags_outrank_contradictory_names_and_descriptions(self):
        folders = [
            {'name': 'Exams/Syllabus', 'types': ['homework'], 'description': 'Current exam papers.'},
            {'name': 'Homework/Keys', 'types': ['current_exams'], 'description': 'Assignment prompts.'},
            {'name': 'Other', 'types': ['other']},
        ]
        for ordering in itertools.permutations(folders):
            self.assertEqual(folder_for_role('homework', ordering), 'Exams/Syllabus')
            self.assertEqual(folder_for_role('current_exam', ordering), 'Homework/Keys')

    def test_tagged_opaque_paths_route_complete_classifier(self):
        config = {'disk_hierarchy': {'custom_folders': [
            {'name': 'Rho/Copper', 'types': ['current_exams']},
            {'name': 'Tau/Moss', 'types': ['homework', 'assignments']},
            {'name': 'Sigma/Glass', 'types': ['other']},
        ]}}
        self.assertEqual(organizer.classify_document('HW07.pdf', '', '', '', config), 'Tau/Moss')
        self.assertEqual(organizer.classify_document('quiz09.pdf', '', '', '', config), 'Rho/Copper')
        self.assertEqual(organizer.classify_document('campus_map.jpg', '', '', '', config), 'Sigma/Glass')

    def test_mixed_purpose_and_junk_additions_use_document_purpose(self):
        from tests.organization_benchmark import FOLDERS
        cases = [
            ('homework', 'Final design project', 'Final project assignment\nBuild a small compiler. Submit source and a report.'),
            ('solutions', 'Homework marking guide', 'Homework marking guide\nOfficial worked answers and point allocations.'),
            ('solutions', 'Assignment answer key', 'Assignment answer key\nOfficial reference solutions, not student submissions.'),
            ('discussion', 'Section handout', 'Recitation worksheet\nBlank questions for class. Fill in your responses.'),
            ('practice_solutions', 'Practice test answers', 'Mock final examination answer key\nOfficial completed solutions.'),
            ('admin', 'Examination instructions', 'Exam instructions and policies\nBring photo identification. Room location and arrival time.'),
            ('other', 'Household recipes', 'Kitchen notes\nShopping list, sourdough ingredients, and cooking schedule.'),
            ('other', 'Family discussion notes', 'Family discussion\nKitchen repairs and chore schedule, unrelated to any course.'),
            ('other', 'Empty note', ''),
        ]
        for expected, title, content in cases:
            with self.subTest(title=title):
                self.assertEqual(organizer.classify_document('download.txt', title, '', content, {}), FOLDERS[expected])

    def test_student_quiz_submission_has_dedicated_tagged_destination(self):
        folders = [{'name': 'Room/Alpha', 'types': ['current_exams']},
                   {'name': 'Room/Beta', 'types': ['student_quizzes']},
                   {'name': 'Room/Gamma', 'types': ['current_exam_solutions']},
                   {'name': 'Room/Delta', 'types': ['other']}]
        config = {'disk_hierarchy': {'custom_folders': folders}}
        self.assertEqual(organizer.classify_document('download.txt', 'My quiz submission', '',
                         'Student quiz submission\nThese are my submitted responses and score: 8/10.', config), 'Room/Beta')

    def test_ollama_prompt_routes_opaque_names_using_role_tags(self):
        config = {'llm_provider': 'ollama', 'ollama_model': 'synthetic-model',
                  'disk_hierarchy': {'custom_folders': [
                      {'name': 'Kappa/Blue', 'types': ['other'], 'description': 'Unrelated personal materials.'},
                      {'name': 'Beta/Gold', 'types': ['slides', 'lectures'], 'description': 'Instructional lecture slides.'},
                      {'name': 'Iota/Green', 'types': ['homework'], 'description': 'Assigned task prompts.'},
                  ]}}
        with patch.object(organizer, 'query_llm', return_value='{"category":1}') as model, \
             patch.object(organizer, 'check_and_reset_ollama_ram'), \
             patch('llm_client.resolve_ollama_model', return_value='synthetic-model'):
            self.assertEqual(organizer.categorize_with_ai('/nonexistent/campus_map.txt', 'Campus map', '/nonexistent',
                             config, 'SYNTHETIC 101', [], extracted_content='Shuttle routes and parking.'), 'Kappa/Blue')
        prompt = model.call_args.args[0]
        self.assertIn('other -> category 1', prompt)
        self.assertIn('lecture -> category 2', prompt)
        self.assertIn('homework -> category 3', prompt)
        self.assertIn('miscellaneous fallback', prompt)
        self.assertIn('campus_map.txt', prompt)
        self.assertIn('Shuttle routes and parking.', prompt)
        schema = model.call_args.kwargs['json_schema']
        self.assertEqual(schema['properties']['category']['enum'], [1, 2, 3])
        self.assertTrue(model.call_args.kwargs['deterministic'])
        self.assertEqual(model.call_args.args[1]['llm_provider'], 'ollama')

    def test_role_evidence_regressions(self):
        from tests.organization_benchmark import FOLDERS
        cases = [
            ('homework', 'homework9.pdf', 'Homework 9', 'Homework 9\nAnswer the questions. No supplied solutions.'),
            ('discussion', 'recitation9.pdf', 'Recitation worksheet', 'Recitation worksheet\nBlank exercises without an answer key.'),
            ('discussion_slides', 'section4.key', 'Discussion section 4', 'Discussion presentation\nInstructional diagrams.'),
            ('lecture', 'lecture_scores.pdf', 'Lecture: standardized scores', 'Lecture notes\nUnderstanding standardized scores and z statistics.'),
            ('homework', 'report_prompt.pdf', 'Lab report assignment', 'Lab report assignment\nSubmit a report describing your experiment.'),
            ('other', 'family_meeting.txt', 'Family meeting notes', 'Family meeting notes\nDiscuss vacation plans and household repairs. No academic content.'),
        ]
        for expected, filename, title, content in cases:
            with self.subTest(filename=filename):
                self.assertEqual(organizer.classify_document(filename, title, '', content, {}), FOLDERS[expected])
