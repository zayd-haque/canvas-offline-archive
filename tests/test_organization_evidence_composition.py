"""[Codex] Composed evidence, descriptor semantics and weak empty identities."""
import tests
import itertools
import unittest
from tests.organization_benchmark import organizer, FOLDERS
from keyword_classifier import folder_for_role


class EvidenceCompositionTests(unittest.TestCase):
    def test_worksheet_key_identity_survives_program_heading_and_question_text(self):
        body = ('Academic Support Program\nRepresentation and interpretation\n'
                '1. Draw the relationship. The supplied diagram follows.\n'
                '2. Explain the result. Worked explanation and completed responses follow.')
        self.assertEqual(organizer.classify_document('worksheet9_key.pdf', 'Representation reference', '', body, {}), FOLDERS['discussion_solutions'])
        self.assertEqual(organizer.classify_document('homework9_key.pdf', 'Representation reference', '', body, {}), FOLDERS['solutions'])

    def test_assessed_product_requires_action_and_delivery_not_product_name(self):
        self.assertEqual(organizer.classify_document('task.pdf', 'Assessed choreography commentary', '',
                         'Assessed choreography commentary\nAnalyze your design decisions and upload the commentary for marking.', {}), FOLDERS['homework'])
        self.assertEqual(organizer.classify_document('reading.pdf', 'Lecture notes', '',
                         'Lecture notes\nAn assessed choreography commentary is examined as an example in this teaching text. No new work is requested.', {}), FOLDERS['lecture'])

    def test_navigation_help_is_distinct_from_delivered_intellectual_task(self):
        self.assertEqual(organizer.classify_document('help.md', 'Feedback panel guide', '',
                         'Course feedback navigation help\nOpen the comments panel to read instructor feedback on existing work. Navigation only; no new exercise.', {}), FOLDERS['admin'])
        self.assertEqual(organizer.classify_document('task.pdf', 'Feedback analysis assignment', '',
                         'Homework assignment\nCompare feedback themes and upload your analysis of the evidence.', {}), FOLDERS['homework'])

    def test_protocol_reference_is_distinct_from_requested_experimental_report(self):
        self.assertEqual(organizer.classify_document('protocol.pdf', 'Sensor setup protocol', '',
                         'Laboratory reference protocol\nSetup steps, calibration equations and operating instructions. No assessed student report is requested.', {}), FOLDERS['lecture'])
        self.assertEqual(organizer.classify_document('task.pdf', 'Sensor report assignment', '',
                         'Laboratory report assignment\nPerform the experiment and submit a report interpreting your calibration results.', {}), FOLDERS['homework'])

    def test_blank_student_response_spaces_describe_worksheet_not_submission(self):
        folders = [
            {'name': 'Suite/Blue', 'description': 'Discussion worksheets with blank student response spaces.'},
            {'name': 'Suite/Gold', 'description': 'Student submitted quiz and exam work.'},
            {'name': 'Suite/Green', 'description': 'Discussion section teaching slides.'},
            {'name': 'Suite/Gray', 'description': 'Other unrelated personal files.'},
        ]
        for ordering in itertools.permutations(folders):
            with self.subTest(order=tuple(f['name'] for f in ordering)):
                self.assertEqual(folder_for_role('discussion', ordering), 'Suite/Blue')
                self.assertEqual(folder_for_role('student_quiz', ordering), 'Suite/Gold')
                config = {'disk_hierarchy': {'custom_folders': list(ordering)}}
                self.assertEqual(organizer.classify_document('worksheet.pdf', 'Seminar evidence worksheet', '',
                                 'Discussion worksheet\nEnter examples in the blank evidence matrix with your group. No supplied answer key.', config), 'Suite/Blue')

    def test_empty_weak_note_is_other_but_explicit_low_text_lecture_retains_purpose(self):
        self.assertEqual(organizer.classify_document('scratch.txt', 'Untouched scratch note', '', '', {}), FOLDERS['other'])
        self.assertEqual(organizer.classify_document('lecture12.pdf', 'Lecture 12', '', '', {}), FOLDERS['lecture'])
