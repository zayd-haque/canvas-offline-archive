"""[Codex] Independent, synthetic document-role labels; no Gemini ground truth.

Run: python3 -m tests.organization_benchmark [--legacy] [--split tune|heldout|all]
Labels encode published default folder descriptions, not model predictions. All
text is invented, across disciplines. This measures fixture accuracy only;
Gemini parity and real-world accuracy require a separately labeled corpus.
"""
import tests
import argparse
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'Canvas Module Downloader'))
import organizer

FOLDERS = {
 'admin': 'Syllabus And Admin', 'homework': 'Homework Assignments',
 'solutions': 'Homework Solutions', 'discussion': 'Discussion Worksheets',
 'discussion_solutions': 'Discussion Worksheets/Discussion Solutions',
 'lecture': 'Lecture Slides', 'discussion_slides': 'Discussion Slides',
 'practice': 'Exams And Quizzes/Practice Exams',
 'practice_solutions': 'Exams And Quizzes/Practice Exams/Practice Exam Solutions',
 'exam': 'Exams And Quizzes/Current Exams',
 'exam_solutions': 'Exams And Quizzes/Current Exams/Current Exam Solutions',
 'other': 'Other Materials',
}

# Each row: expected semantic role, filename, title, heading/body, module context.
TUNE_ROWS = [
 ('admin','course_syllabus.pdf','','Course syllabus: grading policy and office hours.',''),
 ('admin','exam_schedule.pdf','','Exam schedule: dates and rooms.',''),
 ('admin','announcement.txt','Homework deadline update','Please note the assignment deadline has changed.',''),
 ('homework','hw02.pdf','','Homework 2: solve the following questions.',''),
 ('homework','ProblemSet3.pdf','','Problem set 3. Show your work.',''),
 ('homework','essay_prompt.docx','','Essay assignment: submit your argument by Friday.',''),
 ('homework','lab_report_instructions.pdf','','Lab report assignment: submit your methods and results.',''),
 ('solutions','hw2_key.pdf','','Homework 2 answer key.',''),
 ('solutions','pset4_soln.pdf','','Problem set 4 solutions.',''),
 ('solutions','assignment_rubric.pdf','','Homework scoring rubric.',''),
 ('discussion','ws04.pdf','','Worksheet 4: complete during recitation.',''),
 ('discussion','discussion_2.pdf','','Discussion worksheet. Answer these questions.',''),
 ('discussion_solutions','recitation3_solutions.pdf','','Recitation 3 solutions.',''),
 ('discussion_solutions','ws4_key.pdf','','Worksheet 4 answer key.',''),
 ('lecture','lecture05.pdf','','Lecture 5: cell transport.',''),
 ('lecture','slides_week2.pptx','','Networks and graphs',''),
 ('lecture','chapter_8.pdf','','Chapter 8: industrialization.',''),
 ('lecture','reading.pdf','','Reading: migration and public policy.',''),
 ('discussion_slides','discussion2_slides.pdf','','Discussion 2 presentation.',''),
 ('discussion_slides','recitation_deck.pptx','','Recitation 4 slides.',''),
 ('practice','sample_midterm.pdf','','Sample midterm: closed book.',''),
 ('practice','past_final_2024.pdf','','Final examination.',''),
 ('practice_solutions','practice_quiz_key.pdf','','Practice quiz answer key.',''),
 ('practice_solutions','mock_exam_solutions.pdf','','Mock exam worked solutions.',''),
 ('exam','quiz3.pdf','','Quiz 3: answer all questions.',''),
 ('exam','midterm1.pdf','','Midterm 1. No notes allowed.',''),
 ('exam_solutions','final_exam_key.pdf','','Final exam answer key.',''),
 ('exam_solutions','quiz3_solutions.pdf','','Quiz 3 solutions.',''),
 ('other','campus_map.pdf','','Campus map and parking locations.',''),
 ('other','calm_music.mp3','','',''),
 ('lecture','lecture_quiz_review.pdf','','Lecture notes: review of quiz concepts.',''),
 ('lecture','policy_history_reading.pdf','','Chapter 3: public policy history.',''),
 ('homework','assignment01.pdf','','Assignment 1\nSolve questions about final outcomes.','Week 1 lecture'),
 ('discussion','handout.pdf','Discussion worksheet','Questions for recitation','Lecture 2'),
 ('lecture','scan001.pdf','','Lecture notes\nThe assignment and quiz will be posted later.',''),
 ('exam','assessment.pdf','Midterm 2','Closed book examination.','Lecture 7'),
]

HELDOUT_ROWS = [
 ('admin','course_outline.docx','','Course syllabus\nOffice hours and learning objectives.',''),
 ('admin','grading_policy.pdf','','Grading policy\nHomework is 20 percent; exams are 40 percent.',''),
 ('admin','office_hours.txt','','Office hours and contact details.',''),
 ('admin','quiz_notice.md','','Announcement: quiz room has changed.',''),
 ('homework','HW07.pdf','','Homework 7: analyze the dataset.',''),
 ('homework','pset_09.pdf','','Problem set 9: calculate the integral.',''),
 ('homework','project_assignment.docx','','Project assignment\nSubmit a design and implementation.',''),
 ('homework','paper_prompt.pdf','','Essay assignment\nWrite a comparative literary analysis.',''),
 ('homework','hw4.pdf','','Homework 4\nRead lecture notes before answering the questions.',''),
 ('homework','lab2_instructions.pdf','','Lab assignment 2\nSubmit an experimental report.',''),
 ('solutions','HW07Solutions.pdf','','Homework 7 worked solutions.',''),
 ('solutions','pset09_answers.pdf','','Problem set 9 answer key.',''),
 ('solutions','essay_rubric.pdf','','Assignment scoring rubric\nThesis, evidence, and structure.',''),
 ('solutions','homework4_solved.pdf','','Homework 4 solved problems.',''),
 ('discussion','recitation08.pdf','','Recitation worksheet\nComplete each derivation.',''),
 ('discussion','WS09.pdf','','Worksheet 9: complete the exercises.',''),
 ('discussion','section_handout.pdf','Discussion worksheet 5','Practice with causal diagrams.',''),
 ('discussion','worksheet.pdf','','Worksheet\nUse lecture slides to answer each question.',''),
 ('discussion_solutions','recitation08_key.pdf','','Recitation 8 answer key.',''),
 ('discussion_solutions','WS09Answers.pdf','','Worksheet 9 solutions.',''),
 ('discussion_solutions','discussion_worked.pdf','','Discussion worksheet worked solutions.',''),
 ('lecture','Lecture12.pdf','','Lecture 12: memory and learning.',''),
 ('lecture','notes_week7.pdf','','Lecture notes on tonal harmony.',''),
 ('lecture','ch11.pdf','','Chapter 11: statistical inference.',''),
 ('lecture','literature_reading.pdf','','Reading: modernist poetry.',''),
 ('lecture','presentation7.pptx','','Presentation: climate and oceans.',''),
 ('lecture','week8.pptx','','Thermodynamics',''),
 ('lecture','lecture_final_review.pdf','','Lecture slides: review of final exam topics.',''),
 ('lecture','lecture_grades.pdf','','Lecture notes: grades of metamorphic rocks.',''),
 ('lecture','lecture_key_concepts.pdf','','Lecture notes: key concepts in cognition.',''),
 ('lecture','download.pdf','','Lecture slides\nNext week: homework due and quiz scheduled.',''),
 ('discussion_slides','section4_slides.pptx','Discussion 4 slides','Discussion presentation on rhetorical analysis.',''),
 ('discussion_slides','recitation08_deck.pdf','','Recitation 8 presentation.',''),
 ('discussion_slides','discussion_presentation.pdf','','Discussion slides\nWorksheet exercises follow after class.',''),
 ('practice','mock_final.pdf','','Mock final examination.',''),
 ('practice','sample_quiz.pdf','','Sample quiz: genetics.',''),
 ('practice','previous_midterm.pdf','','Previous midterm examination.',''),
 ('practice','exam_spring_2023.pdf','','Midterm examination.',''),
 ('practice_solutions','sample_final_answers.pdf','','Sample final exam answer key.',''),
 ('practice_solutions','past_midterm_soln.pdf','','Past midterm solutions.',''),
 ('practice_solutions','mock_quiz_key.pdf','','Mock quiz answer key.',''),
 ('exam','midterm2.pdf','','Midterm 2\nAnswer all questions.',''),
 ('exam','final_assessment.pdf','','Final examination\nTime limit: 120 minutes.',''),
 ('exam','Quiz08.pdf','','Quiz 8\nShow calculations.',''),
 ('exam','assessment_download.pdf','Midterm 3','Midterm 3\nNo electronic devices.','Lecture 10'),
 ('exam_solutions','midterm2_answers.pdf','','Midterm 2 answer key.',''),
 ('exam_solutions','final_soln.pdf','','Final examination solutions.',''),
 ('exam_solutions','quiz08_key.pdf','','Quiz 8 answer key.',''),
 ('other','wellness_flyer.pdf','','Counseling resources and support contacts.',''),
 ('other','palm_tree.jpg','','',''),
 ('other','finale_recording.mp3','','Orchestra performance recording.',''),
 ('other','monkey_photo.png','','',''),
 ('other','policyholder_data.csv','','customer,policyholder,amount',''),
 ('lecture','resource.pdf','Lecture notes 6','Lecture notes\nEquilibrium and chemical potential.','Week 6'),
 ('homework','resource.docx','Homework 6','Homework 6\nSubmit your calculations.','Lecture 6'),
 ('discussion_solutions','resource.pdf','Recitation answer key','Recitation worksheet solutions\nWorked derivations.','Week 9'),
 ('admin','resource.pdf','Syllabus','Course syllabus\nThe final exam and homework weights are below.',''),
 ('practice','resource.pdf','Practice midterm','Practice midterm\nAnswer all questions.',''),
 ('exam','resource.pdf','Quiz 12','Quiz 12\nAnswer all questions.',''),
 ('other','resource.pdf','','Campus transportation guide.','Lecture 2'),
]


# Frozen predictions captured before replacement of the original rules engine.
# Failures map absolute corpus index to the original predicted semantic role.
LEGACY_FAILURES = {
 3:'other',4:'other',5:'other',6:'other',7:'other',9:'homework',10:'other',
 12:'solutions',13:'other',14:'other',18:'lecture',19:'lecture',22:'practice',
 26:'exam',29:'homework',30:'exam',31:'admin',34:'other',36:'other',38:'other',
 40:'other',43:'other',44:'other',45:'other',47:'homework',48:'admin',49:'homework',
 51:'other',54:'discussion',55:'other',56:'discussion',57:'other',62:'other',
 63:'exam',64:'admin',65:'other',66:'other',67:'lecture',68:'lecture',69:'lecture',
 73:'exam',74:'practice',76:'practice',81:'exam',83:'exam',85:'homework',86:'exam',
 88:'admin',91:'solutions',
}


def legacy_report(split='all'):
    rows = list(cases(split))
    offset = len(TUNE_ROWS) if split == 'heldout' else 0
    failures = []
    for index, row in enumerate(rows):
        if index + offset in LEGACY_FAILURES:
            failures.append({'id': row['id'], 'filename': row['filename'],
                             'expected': row['expected'], 'actual': FOLDERS[LEGACY_FAILURES[index + offset]]})
    return {'split': split, 'total': len(rows), 'correct': len(rows)-len(failures),
            'accuracy': (len(rows)-len(failures))/len(rows), 'failures': failures,
            'provenance': 'Frozen original filename/title-only predictions; synthetic Codex labels, not Gemini parity.'}


def cases(split='all'):
    rows = TUNE_ROWS if split == 'tune' else HELDOUT_ROWS if split == 'heldout' else TUNE_ROWS + HELDOUT_ROWS
    for number, (role, filename, title, content, module_name) in enumerate(rows):
        yield {'id': f'{split}-{number:03}', 'filename': filename, 'title': title,
               'module_name': module_name, 'content': content, 'config': {}, 'expected': FOLDERS[role]}


def evaluate(classifier, split='all'):
    failures = []
    rows = list(cases(split))
    for row in rows:
        actual = classifier(row['filename'], row['title'], row['module_name'], row['content'], row['config'])
        if actual != row['expected']:
            failures.append({'id': row['id'], 'filename': row['filename'], 'expected': row['expected'], 'actual': actual})
    return {'split': split, 'total': len(rows), 'correct': len(rows) - len(failures),
            'accuracy': (len(rows) - len(failures)) / len(rows), 'failures': failures,
            'provenance': 'Synthetic Codex-authored role labels; not Gemini parity or real archive accuracy.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--legacy', action='store_true')
    parser.add_argument('--split', choices=['tune', 'heldout', 'all'], default='all')
    args = parser.parse_args()
    report = legacy_report(args.split) if args.legacy else evaluate(organizer.classify_document, args.split)
    print(json.dumps(report, indent=2))
