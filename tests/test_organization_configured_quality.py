"""[Codex] Frozen generic role regressions for deployed configuration paths.

These synthetic labels exercise published folder semantics, not Gemini parity.
No personal archives or provider services are accessed.
"""
import tests
import copy
import json
from pathlib import Path
import unittest

from tests.organization_benchmark import organizer, FOLDERS


TEMPLATE_PATH = Path(__file__).resolve().parents[1] / 'Canvas Module Downloader' / 'config.example.json'

# Freeze identities and roles before tuning. The solution title and first
# content line are deliberately independent of generic filename/module cues.
DEFAULT_RULE_ROWS = [
    ('lecture', 'lecture_solution_chemistry.pdf', '', 'Lecture notes\nSolution chemistry and concentration.'),
    ('lecture', 'lecture_key_concepts.pdf', '', 'Lecture notes\nKey concepts in language.'),
    ('lecture', 'lecture_public_policy.pdf', '', 'Lecture notes\nPublic policy institutions.'),
    ('lecture', 'download.pdf', 'Assignment: Reading chapter 4', 'Reading chapter 4\nPopulation migration.'),
    ('solutions', 'hw2.pdf', '', 'Homework 2 answer key\nWorked derivations.'),
    ('discussion_solutions', 'discussion3.pdf', '', 'Discussion 3 solutions\nCorrect responses.'),
    ('exam_solutions', 'midterm1solutions.pdf', '', 'Midterm 1 solutions\nOfficial answer key.'),
    ('exam_solutions', 'exam2.pdf', '', 'Exam 2 answer key\nOfficial solutions.'),
    ('practice_solutions', 'practice_exam_solutions.pdf', '', 'Practice exam solutions\nWorked derivations.'),
    ('discussion_slides', 'discussion_slides_week5.pdf', '', 'Discussion slides\nReview of causal inference.'),
    ('admin', 'homework_schedule.pdf', '', 'Homework schedule\nDue dates and extensions.'),
    ('admin', 'exam_announcement.pdf', '', 'Announcement\nExam room has changed.'),
]


class ConfiguredOrganizationQualityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.template = json.loads(TEMPLATE_PATH.read_text(encoding='utf-8'))

    def test_template_keyword_rules_preserve_specific_document_identity(self):
        config = {'category_rules': copy.deepcopy(self.template['category_rules'])}
        for expected, filename, title, body in DEFAULT_RULE_ROWS:
            with self.subTest(filename=filename):
                self.assertEqual(organizer.classify_document(filename, title, '', body, config), FOLDERS[expected])

    def test_full_template_uses_collapsed_semantic_destinations(self):
        rows = [
            ('Lecture Slides', 'lecture_solution_chemistry.pdf', 'Lecture notes\nSolution chemistry.'),
            ('Lecture Slides', 'discussion_slides.pdf', 'Discussion slides\nReview of graph theory.'),
            ('Discussion Worksheets', 'discussion03_solutions.pdf', 'Discussion 3 answer key'),
            ('Homework Solutions', 'hw3_solutions.pdf', 'Homework 3 solutions'),
            ('Exams & Quizzes', 'midterm1solutions.pdf', 'Midterm 1 answer key'),
            ('Exams & Quizzes', 'practice_exam_solutions.pdf', 'Practice exam solutions'),
            ('Other Materials', 'transportation.pdf', 'Campus transportation guide.'),
        ]
        for expected, filename, body in rows:
            with self.subTest(filename=filename):
                self.assertEqual(organizer.classify_document(filename, '', '', body, self.template), expected)

    def test_custom_override_remains_authoritative_and_token_bounded(self):
        config = {'disk_hierarchy': {'custom_folders': [
            {'id': 'lab', 'name': 'Laboratory Archive', 'types': ['homework']},
            {'id': 'talks', 'name': 'Talk Archive', 'types': ['slides']},
            {'id': 'other', 'name': 'Unsorted', 'types': ['other']},
        ]}, 'category_rules': [{'folder': 'Laboratory Archive', 'keywords': ['lab']}]}
        self.assertEqual(organizer.classify_document('lab_lecture.pdf', '', '', 'Lecture notes', config), 'Laboratory Archive')
        self.assertEqual(organizer.classify_document('syllabus.pdf', '', '', 'Course syllabus', config), 'Unsorted')

    def test_specialized_custom_tags_outrank_generic_solution_folders(self):
        config = {'disk_hierarchy': {'custom_folders': [
            {'id': 'generic', 'name': 'General Keys', 'types': ['solutions']},
            {'id': 'specific', 'name': 'Recitation Keys', 'types': ['discussion_solutions']},
            {'id': 'exam', 'name': 'Assessment Keys', 'types': ['exam_solutions']},
            {'id': 'other', 'name': 'Unsorted', 'types': ['other']},
        ]}}
        self.assertEqual(organizer.classify_document('discussion_8_key.pdf', '', '', '', config), 'Recitation Keys')
        self.assertEqual(organizer.classify_document('quiz8_key.pdf', '', '', '', config), 'Assessment Keys')

    def test_generic_course_overviews_and_announcements_are_administration(self):
        rows = [
            ('Week 8 Overview.pdf', 'Welcome to week 8\nThis overview lists the required course activities.'),
            ('2026-02-14 - Weekly Follow-up.md', '# Weekly Follow-up\nThe homework deadline is extended.'),
            ('Exam 4 Format Forum.pdf', 'Exam 4 Format Forum\nInstructions for taking the exam; ask logistical questions here.'),
        ]
        for filename, content in rows:
            with self.subTest(filename=filename):
                self.assertEqual(organizer.classify_document(filename, '', '', content, {}), FOLDERS['admin'])

    def test_generic_action_item_activity_is_assignment(self):
        self.assertEqual(organizer.classify_document('ACTION ITEM - Experiment Activity - Graphing Tool.xlsx',
                         '', '', '', {}), FOLDERS['homework'])

    def test_mixed_discussion_keys_module_never_implies_solutions(self):
        module = 'Discussion Work and Keys'
        self.assertEqual(organizer.classify_document('topic_assignment.pdf', '', module,
                         'Worksheet 7\nComplete these blank exercise questions.', {}), FOLDERS['discussion'])
        self.assertEqual(organizer.classify_document('quiz7.pdf', '', module,
                         'Quiz 7\nAnswer the following questions.', {}), FOLDERS['exam'])

    def test_review_module_preserves_exam_role_and_solution_subtype(self):
        for filename, content, expected in [
            ('exam7.pdf', 'Exam 7\nAnswer all questions.', 'practice'),
            ('exam7_key.pdf', 'Exam 7 answer key\nWorked responses.', 'practice_solutions'),
        ]:
            with self.subTest(filename=filename):
                self.assertEqual(organizer.classify_document(filename, '', 'Examination review', content, {}), FOLDERS[expected])

    def test_syllabus_term_requires_unambiguous_explicit_academic_term(self):
        from keyword_classifier import syllabus_term
        self.assertEqual(syllabus_term({'pdf_file': 'Syllabus_Fall_2031.pdf',
                                      'body': '<h1>Autumn semester 2031</h1>'}), 'Fall 2031')
        self.assertEqual(syllabus_term({'body': '<h1>Spring quarter 2032</h1>'}), 'Spring 2032')
        for syllabus in [None, [], {}, {'body': 'Published March 5, 2032'},
                         {'pdf_file': 'syllabus_Fall_2031.pdf', 'body': 'Spring 2032'},
                         {'body': 'x' * 600 + ' Summer 2032'}]:
            with self.subTest(syllabus=syllabus):
                self.assertEqual(syllabus_term(syllabus), '')

    def test_historical_exam_does_not_guess_active_term_from_machine_date(self):
        self.assertEqual(organizer.classify_document('midterm_Spring_2001.pdf', '', '',
                         'Midterm examination', {}), FOLDERS['exam'])
        self.assertEqual(organizer.classify_document('midterm_Spring_2001.pdf', '', '',
                         'Midterm examination', {'course_term': 'Spring 2001'}), FOLDERS['exam'])
        self.assertEqual(organizer.classify_document('midterm_Spring_2001.pdf', '', '',
                         'Midterm examination', {'course_term': 'Fall 2001'}), FOLDERS['practice'])

    def test_platform_camelcase_names_preserve_online_homework_role(self):
        for filename in ['InQuizitive_Chapter12.pdf', 'inquizitive_chapter12.pdf',
                         'WebAssign_Chapter12.pdf', 'webassign_chapter12.pdf']:
            with self.subTest(filename=filename):
                self.assertEqual(organizer.classify_document(filename, '', '',
                                 'Load this activity in a new browser window.', {}), FOLDERS['homework'])

    def test_iso_dates_without_announcement_source_preserve_material_role(self):
        for filename, content, expected in [
            ('2031-04-05 - Lecture 12.pdf', 'Lecture notes\nExamples of probability.', 'lecture'),
            ('2031-04-05 - Homework 12.pdf', 'Homework 12\nComplete all problems.', 'homework'),
        ]:
            with self.subTest(filename=filename):
                self.assertEqual(organizer.classify_document(filename, '', '', content, {}), FOLDERS[expected])

    def test_canonical_keyword_override_flag_is_explicit(self):
        rule = {'folder': FOLDERS['homework'], 'keywords': ['studio exercise']}
        arguments = ('studio_exercise_lecture.pdf', '', '', 'Lecture notes\nStudio exercise examples.')
        self.assertEqual(organizer.classify_document(*arguments, {'category_rules': [rule]}), FOLDERS['lecture'])
        self.assertEqual(organizer.classify_document(*arguments, {'category_rules': [dict(rule, override=True)]}), FOLDERS['homework'])

    def test_custom_folder_description_supports_renamed_untagged_destination(self):
        config = {'disk_hierarchy': {'custom_folders': [
            {'id': 'a', 'name': 'Shelf A', 'description': 'Main lecture slides and textbook readings.'},
            {'id': 'b', 'name': 'Shelf B', 'description': 'Official homework answer keys and solutions.'},
            {'id': 'c', 'name': 'Shelf C', 'types': ['other']},
        ]}}
        self.assertEqual(organizer.classify_document('lecture12.pdf', '', '', '', config), 'Shelf A')
        self.assertEqual(organizer.classify_document('hw12_key.pdf', '', '', '', config), 'Shelf B')

    def test_forum_ui_identifies_admin_despite_lecture_topic(self):
        self.assertEqual(organizer.classify_document('Lecture Questions.pdf', '', '',
                         'Lecture Questions\nView Split Screen\nSearch entries or author...\nReply\nAsk the teaching team your questions here.', {}), FOLDERS['admin'])

    def test_extra_credit_assignment_differs_from_opportunity_notice(self):
        self.assertEqual(organizer.classify_document('Extra Credit.pdf', '', '',
                         'Extra Credit Assignment\nEarn six points by completing this assignment. Submit your analysis by Friday.', {}), FOLDERS['homework'])
        self.assertEqual(organizer.classify_document('Extra Credit Opportunities.pdf', '', '',
                         'Extra Credit Opportunities\nSee the schedule for upcoming opportunities and registration instructions.', {}), FOLDERS['admin'])

    def test_ebook_is_instructional_reading(self):
        self.assertEqual(organizer.classify_document('Methods - Ebook.pdf', '', '',
                         'Research Methods\nContents\nChapter 1: Asking empirical questions\nChapter 2: Experimental designs', {}), FOLDERS['lecture'])

    def test_research_article_beats_action_item_container_label(self):
        self.assertEqual(organizer.classify_document('ACTION ITEM - Research Article.pdf', '', '',
                         'Research Article\nABSTRACT\nWe tested whether visual feedback changes learning.\nMethods\nParticipants were randomly assigned to experimental groups.\nResults\nFeedback improved performance.', {}), FOLDERS['lecture'])

    def test_guided_notes_with_answer_fields_are_blank_worksheets(self):
        self.assertEqual(organizer.classify_document('Lesson Guided Notes.docx', '', '',
                         'Lesson Guided Notes\nIdentify the independent variable.\n[Type answer here]\nExplain the design.\n[Type answer here]', {}), FOLDERS['discussion'])

    def test_review_walkthrough_presentation_is_teaching_material(self):
        self.assertEqual(organizer.classify_document('Critical Evaluation - Activity Review.pdf', '', '',
                         'Activity Review & Walkthrough\nScenario 1\nWe will walk through this example together.\nThe independent variable has two levels.', {}), FOLDERS['lecture'])

    def test_discussion_module_assignment_keys_are_discussion_solutions(self):
        for filename, content in [
            ('Experiment Assignment Key.pdf', 'Experiment exercise answers\n1. The experimental group receives treatment.'),
            ('Exercise Key.pdf', 'Worked solutions\n1. Compare the conditions.'),
        ]:
            with self.subTest(filename=filename):
                self.assertEqual(organizer.classify_document(filename, '', 'Discussion Work and Keys', content, {}), FOLDERS['discussion_solutions'])

    def test_expository_scientific_document_is_not_an_answer_key(self):
        self.assertEqual(organizer.classify_document('Experimental Design.pdf', '', '',
                         'Experimental Design\nScientific explanations depend on empirical evidence. The key principle is random assignment.\nDifferent methodological solutions address different confounds.\nA controlled comparison permits causal inference.', {}), FOLDERS['lecture'])

    def test_campus_support_and_research_opportunities_are_other(self):
        for filename, content in [
            ('Research Opportunities.pdf', 'Research Opportunities\nA campus research project is accepting volunteers. Contact the coordinator to learn about participation.'),
            ('Care Package.pdf', 'Care Package\nCampus support resources for student wellbeing. Find food assistance and counseling appointments.'),
        ]:
            with self.subTest(filename=filename):
                self.assertEqual(organizer.classify_document(filename, '', '', content, {}), FOLDERS['other'])

    def test_generic_class_and_session_material_needs_teaching_evidence(self):
        rows = [
            ('class3.pdf', 'Class 3\nLearning objectives: understand the concept.\nOpen the iClicker app!', 'lecture'),
            ('session2_annotated.pdf', 'Session 2\nWorked example: simplify the expression.\nGroup work', 'lecture'),
            ('class3_roster.pdf', 'Class 3 roster\nStudent attendance list', 'other'),
            ('class3_rules.pdf', 'Class 3 classroom policy\nOpen the iClicker app', 'admin'),
            ('class3.pdf', 'Database class definition\nCREATE TABLE records (record_id INTEGER);', 'other'),
        ]
        opaque = [{'id': 'a', 'name': 'Shelf A', 'types': ['lectures']},
                  {'id': 'b', 'name': 'Shelf B', 'types': ['admin']},
                  {'id': 'c', 'name': 'Shelf C', 'types': ['other']}]
        mapped = {'lecture': 'Shelf A', 'admin': 'Shelf B', 'other': 'Shelf C'}
        for config in ({}, {'disk_hierarchy': {'custom_folders': opaque}}):
            for filename, content, expected in rows:
                with self.subTest(filename=filename, expected=expected, custom=bool(config)):
                    destination = mapped[expected] if config else FOLDERS[expected]
                    self.assertEqual(organizer.classify_document(filename, '', '', content, config), destination)

    def test_homework_tasks_with_format_instructions_remain_assignments(self):
        format_instructions = ('Homework instructions\nWrite your name at the top of each page.\n'
                               'Show your work and upload your file in PDF format.\n'
                               'Submit your work before the deadline.')
        opaque = [{'id': 'a', 'name': 'Shelf A', 'types': ['homework']},
                  {'id': 'b', 'name': 'Shelf B', 'types': ['admin']},
                  {'id': 'c', 'name': 'Shelf C', 'types': ['other']}]
        for config in ({}, {'disk_hierarchy': {'custom_folders': opaque}}):
            for task in ('1. Calculate the determinant.', 'Solve exercise 3.', 'Write a report.',
                         'Write an essay comparing two research designs.'):
                with self.subTest(task=task, custom=bool(config)):
                    self.assertEqual(organizer.classify_document('homework_instructions.pdf', '', '',
                                     format_instructions + '\n' + task, config), 'Shelf A' if config else FOLDERS['homework'])
