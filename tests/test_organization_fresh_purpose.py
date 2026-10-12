"""[Codex] Purpose boundaries exposed by independently authored October 11 cases."""
import tests
import unittest
from tests.organization_benchmark import organizer, FOLDERS


class FreshPurposeBoundariesTests(unittest.TestCase):
    def test_delivery_wrapper_and_assessed_briefs_have_task_destinations(self):
        rows = [
            ('Studio brief', 'Assessed studio brief\nDesign a poster, annotate the choices, and upload your portfolio for marking.'),
            ('Weekly task', 'Announcement: this week submit a comparative essay discussing two arguments. Include references and upload a PDF.'),
        ]
        for title, text in rows:
            with self.subTest(title=title):
                self.assertEqual(organizer.classify_document('packet.pdf', title, '', text, {}), FOLDERS['homework'])
        self.assertEqual(organizer.classify_document('notice.md', 'Deadline announcement', '',
                         'Announcement: the essay deadline is extended. The assignment instructions remain in the original prompt.', {}), FOLDERS['admin'])

    def test_personal_financial_and_club_materials_do_not_borrow_academic_words(self):
        rows = [
            ('Club discussion minutes', 'Community gardening club minutes\nDiscussion of membership fees and annual meeting schedule. Not a course document.'),
            ('Workshop invoice', 'Garage workshop invoice\nRepair labor and replacement parts. Payment policy and tax totals.'),
            ('Course store receipt', 'Personal bookstore purchase receipt\nPaid for textbook and exam revision guide. Transaction total and return policy.'),
            ('Blank notes', ''),
        ]
        for title, text in rows:
            with self.subTest(title=title):
                self.assertEqual(organizer.classify_document('packet.pdf', title, '', text, {}), FOLDERS['other'])
        self.assertEqual(organizer.classify_document('sheet.pdf', 'Economics worksheet', '',
                         'Recitation worksheet\nAnalyze this fictional invoice and tax receipt. Write your answers in the blanks.', {}), FOLDERS['discussion'])

    def test_main_lecture_discussion_of_subject_is_not_section_slide_identity(self):
        text = 'Lecture slides\nDiscussion of migration theory and historical examples; an explanatory presentation for the main lecture.'
        self.assertEqual(organizer.classify_document('deck.pptx', 'Discussion of migration', '', text, {}), FOLDERS['lecture'])
        self.assertEqual(organizer.classify_document('deck.pptx', 'Discussion section presentation', '',
                         'Discussion slides\nTeaching diagrams for section groups.', {}), FOLDERS['discussion_slides'])

    def test_exam_submission_is_distinct_from_blank_paper_and_official_answers(self):
        config = {'disk_hierarchy': {'custom_folders': [
            {'name': 'Cabinet/Submitted', 'types': ['student_quizzes']},
            {'name': 'Cabinet/Questions', 'types': ['current_exams']},
            {'name': 'Cabinet/Reference', 'types': ['current_exam_solutions']},
            {'name': 'Cabinet/Misc', 'types': ['other']},
        ]}}
        rows = [
            ('Submitted', 'Returned examination responses', 'Student exam submission\nMy answers are written in blue. Returned feedback: Question 1 earns two points.'),
            ('Questions', 'Examination paper', 'Current exam\nWrite answers in the blank spaces. No supplied solutions.'),
            ('Reference', 'Official exam key', 'Official examination answer key\nInstructor supplied correct answers and worked derivations.'),
        ]
        for destination, title, text in rows:
            with self.subTest(title=title):
                self.assertEqual(organizer.classify_document('record.pdf', title, '', text, config), 'Cabinet/' + destination)
