"""[Codex] Leading document purpose beats incidental topic and generic titles."""
import tests
import unittest
from tests.organization_benchmark import organizer, FOLDERS


class LeadingPurposeBoundaryTests(unittest.TestCase):
    def test_assignment_about_policy_is_a_task_but_policy_notice_is_admin(self):
        self.assertEqual(organizer.classify_document('paper.pdf', 'Policy position piece', '',
                         'Assignment: position paper\nDefend a recommendation about municipal transport using cited evidence. Submit a paper.', {}), FOLDERS['homework'])
        self.assertEqual(organizer.classify_document('notice.pdf', 'Course assignment policy', '',
                         'Course policy\nLate homework receives a penalty. Submission deadlines are listed in the schedule.', {}), FOLDERS['admin'])

    def test_lecture_discussing_topic_is_distinct_from_section_worksheet(self):
        self.assertEqual(organizer.classify_document('notes.pdf', 'Historical discussion', '',
                         'Lecture notes\nDiscussion of historical memory through explanatory examples in the main class.', {}), FOLDERS['lecture'])
        self.assertEqual(organizer.classify_document('activity.pdf', 'Historical discussion worksheet', '',
                         'Discussion worksheet\nWrite your interpretation in each blank and compare responses in section.', {}), FOLDERS['discussion'])

    def test_leading_practice_identity_and_negated_assessed_status_survive_generic_title(self):
        self.assertEqual(organizer.classify_document('quiz.pdf', 'Rehearsal quiz questions', '',
                         'Practice quiz\nRevision questions for preparation. This is not the scheduled assessed quiz.', {}), FOLDERS['practice'])
        self.assertEqual(organizer.classify_document('quiz.pdf', 'Scheduled quiz questions', '',
                         'Current quiz paper\nComplete these questions during the assessed sitting.', {}), FOLDERS['exam'])

    def test_navigation_confirmation_is_admin_but_substantive_upload_remains_task(self):
        self.assertEqual(organizer.classify_document('help.md', 'Upload receipt help', '',
                         'Course upload help\nCheck the confirmation message after submitting an existing file. This page describes website navigation only.', {}), FOLDERS['admin'])
        self.assertEqual(organizer.classify_document('task.md', 'Argument analysis assignment', '',
                         'Assignment: argument analysis\nWrite a critical comparison of the readings and upload your analysis. Verify the confirmation message afterward.', {}), FOLDERS['homework'])
