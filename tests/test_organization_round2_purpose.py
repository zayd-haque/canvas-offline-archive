"""[Codex] General purpose and hierarchy boundaries from independent broad tests."""
import tests
import itertools
import unittest
from tests.organization_benchmark import organizer, FOLDERS
from keyword_classifier import folder_for_role


class BroadPurposeBoundariesTests(unittest.TestCase):
    def test_confirming_existing_upload_is_admin_but_substantive_task_is_homework(self):
        self.assertEqual(organizer.classify_document('help.md', 'Upload confirmation steps', '',
                         'Course assignment upload instructions\nLocate the submission button and check its confirmation receipt. No academic exercise here.', {}), FOLDERS['admin'])
        self.assertEqual(organizer.classify_document('task.pdf', 'Critical analysis assignment', '',
                         'Assignment: critical analysis\nCompare the two arguments and upload your written analysis. Check the confirmation receipt afterward.', {}), FOLDERS['homework'])

    def test_assessed_analysis_deliverable_outranks_grading_word(self):
        self.assertEqual(organizer.classify_document('analysis.pdf', 'Comparative performance analysis', '',
                         'Assessed performance analysis\nWatch two recordings, compare their interpretation, and upload a written analysis for grading.', {}), FOLDERS['homework'])
        self.assertEqual(organizer.classify_document('notice.md', 'Analysis grade announcement', '',
                         'Course announcement\nThe performance analysis grades are available. Contact the instructor with marking questions.', {}), FOLDERS['admin'])

    def test_association_minutes_are_other_but_reading_about_them_is_instructional(self):
        self.assertEqual(organizer.classify_document('minutes.docx', 'Neighborhood planning notes', '',
                         'Nonacademic neighborhood association minutes\nDiscussion of parking, membership fees, and meeting times.', {}), FOLDERS['other'])
        self.assertEqual(organizer.classify_document('reader.pdf', 'Lecture reading', '',
                         'Lecture notes\nThis assigned reading analyzes neighborhood association minutes as evidence about civic participation.', {}), FOLDERS['lecture'])

    def test_leading_exam_answer_heading_retains_exam_and_practice_identity(self):
        cases = [
            ('practice_solutions', 'Rehearsal paper solutions', 'Mock examination official answer key\nWorked answers for the revision paper, not a homework exercise.', ''),
            ('exam_solutions', 'Scheduled marking answers', 'Official current midterm answer key\nCorrect answers and point allocations for the scheduled paper.', ''),
            ('practice_solutions', 'Midterm answers', 'Midterm examination answer key\nOfficial correct answers.', 'Practice examinations'),
            ('solutions', 'Homework answers', 'Official homework answer key\nWorked solutions for the assigned exercise.', ''),
        ]
        for role, title, content, module in cases:
            with self.subTest(title=title, module=module):
                self.assertEqual(organizer.classify_document('reference.pdf', title, module, content, {}), FOLDERS[role])

    def test_standalone_marking_criteria_are_distinct_from_rubric_in_task_brief(self):
        self.assertEqual(organizer.classify_document('criteria.pdf', 'Translation grading criteria', '',
                         'Official assignment marking rubric\nAccuracy, fluency, and justification criteria with instructor exemplars.', {}), FOLDERS['solutions'])
        self.assertEqual(organizer.classify_document('brief.pdf', 'Essay assignment', '',
                         'Essay assignment\nWrite and submit a comparative argument. The attached rubric explains grading criteria.', {}), FOLDERS['homework'])

    def test_assessed_proposal_requires_deliverable_evidence(self):
        self.assertEqual(organizer.classify_document('folio.docx', 'Curatorial proposal', '',
                         'Assessed curatorial proposal\nSelect three artworks, explain their relationship, and upload a proposal for marking.', {}), FOLDERS['homework'])
        self.assertEqual(organizer.classify_document('reader.pdf', 'Lecture notes', '',
                         'Lecture notes\nA completed curatorial proposal illustrates the concepts. Read the explanatory comparison; no work is requested.', {}), FOLDERS['lecture'])

    def test_business_invoice_reading_does_not_become_personal_financial_material(self):
        self.assertEqual(organizer.classify_document('reader.pdf', 'Business transactions reading', '',
                         'Textbook chapter\nInvoices and receipts illustrate accrual accounting. This instructional reading is not a personal transaction.', {}), FOLDERS['lecture'])
        self.assertEqual(organizer.classify_document('invoice.pdf', 'Dentist billing statement', '',
                         'Personal dental invoice\nTreatment charges, insurer contribution, and remaining balance.', {}), FOLDERS['other'])

    def test_portal_help_is_distinct_from_actual_new_deliverable(self):
        self.assertEqual(organizer.classify_document('help.md', 'Portal troubleshooting', '',
                         'Course submission portal instructions\nUse the upload tab to attach an existing assignment. No learning exercise is assigned.', {}), FOLDERS['admin'])
        self.assertEqual(organizer.classify_document('task.md', 'Literary analysis assignment', '',
                         'Essay assignment\nWrite an original analysis and upload your essay through the submission portal.', {}), FOLDERS['homework'])

    def test_described_student_and_current_exam_destinations_survive_folder_shuffling(self):
        folders = [
            {'name': 'Assessment Room/Copper', 'description': 'Student quiz and exam submissions.'},
            {'name': 'Assessment Room/Glass', 'description': 'Current examination question papers without answers.'},
            {'name': 'Assessment Room/Moss', 'description': 'Practice examination question papers without solutions.'},
            {'name': 'Assessment Room/Slate', 'description': 'Unrelated personal materials.'},
        ]
        for ordering in itertools.permutations(folders):
            with self.subTest(order=tuple(f['name'] for f in ordering)):
                self.assertEqual(folder_for_role('student_quiz', ordering), 'Assessment Room/Copper')
                self.assertEqual(folder_for_role('current_exam', ordering), 'Assessment Room/Glass')
                config = {'disk_hierarchy': {'custom_folders': list(ordering)}}
                self.assertEqual(organizer.classify_document('returned.pdf', 'My examination record', '',
                                 'Student exam submission\nMy written responses and returned instructor comments.', config), 'Assessment Room/Copper')
                self.assertEqual(organizer.classify_document('paper.pdf', 'Scheduled assessment paper', '',
                                 'Current midterm examination\nAnswer all questions during the scheduled sitting.', config), 'Assessment Room/Glass')
