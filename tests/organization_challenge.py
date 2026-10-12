"""[Codex] Fresh synthetic challenge authored after first benchmark tuning.

Labels are frozen before first evaluation. This is an independent agent's
fixture coverage, not a real-data estimate or a Gemini reference corpus.
"""
from tests.organization_benchmark import FOLDERS

ROWS = [
 ('lecture','a.pdf','','Lecture notes\nSolutions of differential equations.'),
 ('lecture','b.pdf','','Chapter 4\nChemical solution concentrations.'),
 ('lecture','c.pdf','','Reading: election policy and governance.'),
 ('lecture','d.pdf','','Lecture slides\nKey concepts in economics.'),
 ('lecture','e.pdf','','Lecture notes\nFinal causes in ancient philosophy.'),
 ('lecture','f.pdf','','Lecture 8\nThis lecture discusses the assignment rubric.'),
 ('lecture','g.pdf','','Chapter 9\nDiscussion of migration policy.'),
 ('lecture','h.pdf','','Reading\nPublic information and media systems.'),
 ('lecture','lecture_09.pdf','Assignment: Lecture 9 slides','Lecture 9 slides\nGeometric transforms.'),
 ('lecture','lecture_10.pdf','Assignment: weekly reading','Chapter 10\nEconometric inference.'),
 ('homework','i.pdf','','Homework assignment\nCompute the posterior distribution.'),
 ('homework','j.docx','','Essay assignment\nCompare two primary sources.'),
 ('homework','k.pdf','','Project assignment\nBuild a compiler and submit your code.'),
 ('homework','l.pdf','','Lab assignment\nSubmit a report of the experiment.'),
 ('homework','final_paper.pdf','','Final paper assignment\nSubmit a critical analysis.'),
 ('homework','hw12.pdf','','Homework 12\nConsult the practice exam before solving.'),
 ('homework','assignment04.pdf','','Assignment 4\nRead the lecture notes and complete exercises.'),
 ('homework','problem_set_6.pdf','','Problem set 6\nUse the key concepts introduced in lecture.'),
 ('solutions','m.pdf','','Homework solutions\nWorked derivations and explanations.'),
 ('solutions','n.pdf','','Assignment answer key\nReference responses.'),
 ('solutions','problem_set_5_marking_guide.pdf','','Homework 5 marking guide\nWorked solutions.'),
 ('solutions','hw13_solutions.pdf','','Homework 13 solutions\nQuestion 2 refers to the lecture slides.'),
 ('discussion','o.pdf','','Recitation worksheet\nComplete with your section.'),
 ('discussion','p.pdf','','Discussion worksheet\nAnswer the following questions.'),
 ('discussion','worksheet07.pdf','','Worksheet 7\nDiscuss final outcomes in small groups.'),
 ('discussion','recitation07.pdf','','Recitation worksheet\nUse the lecture slides to solve each exercise.'),
 ('discussion_solutions','q.pdf','','Recitation answer key\nWorked explanations.'),
 ('discussion_solutions','r.pdf','','Discussion worksheet solutions\nCorrect responses.'),
 ('discussion_slides','s.pdf','','Discussion slides\nCausal inference illustrations.'),
 ('discussion_slides','t.pptx','','Recitation presentation\nVector fields.'),
 ('practice','u.pdf','','Practice examination\nAnswer every question.'),
 ('practice','v.pdf','','Sample quiz\nShow your work.'),
 ('practice','w.pdf','','Past final exam\nTime limit: two hours.'),
 ('practice','old_midterm.pdf','','Previous midterm\nClosed book.'),
 ('practice_solutions','x.pdf','','Practice exam solutions\nWorked answers.'),
 ('practice_solutions','y.pdf','','Sample quiz answer key\nCorrect responses.'),
 ('exam','z.pdf','','Midterm examination\nNo notes allowed.'),
 ('exam','aa.pdf','','Quiz 10\nAnswer all questions.'),
 ('exam','ab.pdf','','Final examination\nTwo hours. Closed book.'),
 ('exam_solutions','ac.pdf','','Midterm answer key\nOfficial solutions.'),
 ('exam_solutions','ad.pdf','','Quiz solutions\nCorrect responses.'),
 ('admin','ae.pdf','','Course syllabus\nHomework and final exam weighting.'),
 ('admin','af.pdf','','Exam schedule\nDates, room numbers, and arrival times.'),
 ('admin','ag.pdf','','Office hours\nContact details and weekly availability.'),
 ('admin','announcement.txt','','Announcement\nPractice quiz deadline has changed.'),
 ('other','misc.pdf','','Campus shuttle routes and parking guide.'),
 ('other','musical_finale.wav','','Orchestra recording.'),
 ('other','policyholder.csv','','policyholder,claim,total'),
 ('other','palm_kernel.jpg','',''),
 ('lecture','neural_networks.pptx','','Neural networks and optimization.'),
]


def evaluate_challenge(classifier):
    failures = []
    for index, (role, filename, title, content) in enumerate(ROWS):
        actual = classifier(filename, title, '', content, {})
        if actual != FOLDERS[role]:
            failures.append({'id': index, 'filename': filename, 'expected': FOLDERS[role], 'actual': actual})
    return {'total': len(ROWS), 'correct': len(ROWS) - len(failures),
            'accuracy': (len(ROWS) - len(failures)) / len(ROWS), 'failures': failures}
