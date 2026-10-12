"""[Codex] Course navigation, consent, empty files and described student work."""
import tests
import itertools
import unittest
from tests.organization_benchmark import organizer, FOLDERS
from keyword_classifier import folder_for_role


class CourseNavigationBoundaryTests(unittest.TestCase):
    def test_feedback_navigation_is_admin_and_feedback_analysis_task_is_homework(self):
        self.assertEqual(organizer.classify_document('guide.pdf', 'Viewing feedback instructions', '',
                         'Course website instructions\nOpen the feedback tab to view returned comments and marks. No new academic exercise is requested.', {}), FOLDERS['admin'])
        self.assertEqual(organizer.classify_document('assignment.pdf', 'Feedback analysis assignment', '',
                         'Homework assignment\nAnalyze the feedback dataset and submit a written report explaining patterns.', {}), FOLDERS['homework'])

    def test_educational_visit_consent_is_admin_and_personal_travel_is_other(self):
        self.assertEqual(organizer.classify_document('consent.pdf', 'Research visit permission', '',
                         'Course field visit consent form\nPermission to attend the educational research-site visit. Signature and emergency contact fields.', {}), FOLDERS['admin'])
        self.assertEqual(organizer.classify_document('permission.pdf', 'Personal travel consent', '',
                         'Personal family travel permission\nConsent for a holiday outing and transport arrangements, unrelated to a course.', {}), FOLDERS['other'])

    def test_unfilled_generic_note_is_other_but_blank_guided_worksheet_has_purpose(self):
        self.assertEqual(organizer.classify_document('note.txt', 'Unfilled note', '', '', {}), FOLDERS['other'])
        self.assertEqual(organizer.classify_document('sheet.pdf', 'Blank discussion worksheet', '',
                         'Discussion worksheet\nComplete each blank response with your group during section.', {}), FOLDERS['discussion'])

    def test_described_submitted_quiz_exam_work_has_dedicated_destination(self):
        folders = [
            {'name': 'Cabinet/Opal', 'description': 'Student submitted quiz and exam work.'},
            {'name': 'Cabinet/Pearl', 'description': 'Current exam question papers without official answers.'},
            {'name': 'Cabinet/Quartz', 'description': 'Official current exam answer keys.'},
            {'name': 'Cabinet/Ruby', 'description': 'Other unrelated personal documents.'},
        ]
        for ordering in itertools.permutations(folders):
            with self.subTest(order=tuple(f['name'] for f in ordering)):
                self.assertEqual(folder_for_role('student_quiz', ordering), 'Cabinet/Opal')
                self.assertEqual(folder_for_role('current_exam', ordering), 'Cabinet/Pearl')
                config = {'disk_hierarchy': {'custom_folders': list(ordering)}}
                self.assertEqual(organizer.classify_document('returned.pdf', 'My returned examination', '',
                                 'Student exam submission\nMy answers and calculations, with awarded points and returned examiner feedback.', config), 'Cabinet/Opal')
                self.assertEqual(organizer.classify_document('key.pdf', 'Official current examination key', '',
                                 'Official current exam answer key\nInstructor correct answers and marking notes.', config), 'Cabinet/Quartz')
