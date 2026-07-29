// Utazi Chukwuebuka John · 400-level ChemE, graduating 2027, CGPA 4.34
// after sliding from first class through recurring exam errors. Repeated
// scholarship rejections have bred discouragement and procrastination.
// Track: "The Comeback Path" - rebuild the exam system with evidence,
// ship a real data project (Nigeria Energy Pulse), and restart scholarship
// applications with a volume-over-fear strategy. Weekends carry the heavy
// blocks (his availability: Sat 5-8pm, Sun 2-5:30pm).
// Task tuple: [kind, minutes, title, detail, evidenceHint?]

export const UTAZI = {
  email: "utazichukuebuka@gmail.com",
  track: "The Comeback Path · First-Class Mind x Data",
  weeks: [
    {
      theme: "The honest audit",
      days: [
        { t: "Gather the evidence", tasks: [
          ["skill", 60, "Collect your exam evidence", "Gather past question papers and any returned scripts or self-recalled solutions from at least three courses where marks slipped. List each course and roughly where marks were lost. No judging today, only collecting. You cannot fix a pattern you have not seen.", "List the courses and papers you gathered."],
          ["career", 15, "Write what first class means", "Five sentences: what returning toward first class would mean for you, your family, and your scholarship chances. This is fuel, not pressure. Pin it."],
        ]},
        { t: "Error autopsy I", tasks: [
          ["skill", 60, "Error autopsy part one", "Go question by question through your gathered papers. Label every lost mark with one of five tags: knowledge gap, misread question, careless slip, time pressure, or presentation. Build the table. This turns 'I keep making one error or another' into a named, beatable list.", "Paste your error table (course, question, tag)."],
        ]},
        { t: "Error autopsy II", tasks: [
          ["skill", 30, "Find your top two enemies", "Tally the tags. Identify your top two error types; they likely cover most of the damage. Write one sentence each on what typically triggers them. From now on the fight is against these two, not against yourself."],
        ]},
        { t: "Study method audit", tasks: [
          ["skill", 30, "Audit how you actually study", "Write honestly how you prepared for your last exams: rereading notes, solving problems, group study, cramming timeline. Then read once about active recall versus rereading (search 'active recall Ali Abdaal' or any summary). Note the gap between what works and what you did."],
        ]},
        { t: "Active recall begins", tasks: [
          ["skill", 30, "Make your first ten flashcards", "Pick one current course. Make ten question-and-answer flashcards (Anki app or paper): definitions, formulas, and one 'why' question. Quiz yourself once. Retrieval is the workout; rereading is watching others exercise."],
        ]},
        { t: "Builder setup", tasks: [
          ["skill", 40, "Set up Python and GitHub", "Install Python 3 and VS Code, create a GitHub account, and run hello.py printing your name and the words 'comeback in progress'. Your data-career thread starts today alongside the academic one.", "Paste the output of 'python --version' and your GitHub profile link."],
        ]},
        { t: "Week 1 verdict", tasks: [
          ["checkpoint", 30, "The audit report", "Write your five-line audit report: top two error types, what triggers each, one change you will test for each, and one sentence on how it feels to finally see the pattern named. This report is the foundation of the whole comeback.", "Paste your five-line audit report."],
        ]},
      ],
    },
    {
      theme: "Design the protocol",
      days: [
        { t: "Protocol day", tasks: [
          ["skill", 60, "Write your Personal Exam Protocol v1", "Design your checklist to run in every exam: 1) read the whole paper twice before writing, 2) choose questions by marks-per-confidence, not order (you already got this advice; now it is systematic), 3) time budget per question written on the question paper, 4) two-line answer plan before each solution, 5) final 10-minute sweep hunting YOUR top two error types specifically. Write it as a numbered card.", "Paste your protocol card."],
          ["skill", 30, "Python: variables and strings", "Write about_me.py: variables for name, level, CGPA; print a formatted sentence with f-strings. Small, done, counted."],
        ]},
        { t: "First timed test", tasks: [
          ["skill", 90, "Timed practice paper #1", "Full past-question paper under real exam conditions, phone away, using Protocol v1. Then mark yourself against solutions or the marking scheme and count errors by tag. The score does not matter this week; the error count is the baseline.", "Paste your error count by tag."],
        ]},
        { t: "Review the tape", tasks: [
          ["skill", 30, "Review paper #1 like a coach", "For every lost mark, ask: which protocol step would have caught this if followed? Mark each as 'protocol skipped' or 'protocol gap'. Skipped means practise compliance; gap means improve the protocol. Champions review tape."],
        ]},
        { t: "Recall rep", tasks: [
          ["skill", 25, "Flashcards: add and review", "Ten new cards from the course you practised, then review all twenty. Rate each card easy/hard; hard ones come back sooner. Ten focused minutes beat two passive hours."],
        ]},
        { t: "Code your CGPA", tasks: [
          ["skill", 30, "Python: the CGPA calculator", "Write cgpa.py: input grades and units for five courses, compute the GPA. You are literally coding the number you are fighting for; make the tool yours."],
        ]},
        { t: "Protocol v2", tasks: [
          ["skill", 30, "Upgrade to Protocol v2", "Based on the paper #1 review, adjust the protocol: tighten a step, add a trigger-specific tripwire (e.g. 'circle every NOT and EXCEPT while reading'). Keep it to one card. Systems evolve with evidence."],
        ]},
        { t: "Week 2 verdict", tasks: [
          ["checkpoint", 25, "Explain your protocol from memory", "Closed book: write out your protocol and, for each step, one line on which error type it kills. If you cannot explain it, you will not run it under pressure.", "Paste your from-memory protocol with reasons."],
        ]},
      ],
    },
    {
      theme: "Test and refine",
      days: [
        { t: "Second timed test", tasks: [
          ["skill", 90, "Timed practice paper #2", "Second full paper, exam conditions, Protocol v2. Mark and count errors by tag. Compare against paper #1: the trend matters more than the score.", "Paste error counts: paper 1 vs paper 2."],
          ["skill", 30, "Python: if/else", "Write classify.py: input a score, print the grade class (first class, 2:1, 2:2...). Yes, the metaphor is intentional."],
        ]},
        { t: "Teach-back", tasks: [
          ["skill", 40, "Teach a concept out loud", "Pick a hard concept from your practice course. Record a voice note teaching it to an imaginary 200-level student: what it is, why it matters, one worked example. If you stumble, that is the gap; study it, re-record. Teaching is the sharpest test of knowing."],
        ]},
        { t: "Recall rep", tasks: [
          ["skill", 25, "Flashcard sprint", "Ten new cards, review the full deck. Note which cards keep coming back hard; those topics get priority in your next practice paper."],
        ]},
        { t: "Code the trend", tasks: [
          ["skill", 30, "Python: loops", "Write trend.py: a list of your semester GPAs, loop to print each with its semester number, then the average and the direction (rising or falling). Data starts telling your story back to you."],
        ]},
        { t: "Misread-proofing", tasks: [
          ["skill", 30, "Misread-proofing drill", "Take five past questions. Do NOT solve them. Only underline the command words (discuss, derive, calculate, compare) and list exactly what each question demands. Misreads die when reading becomes its own step."],
        ]},
        { t: "Time-budget drill", tasks: [
          ["skill", 30, "Plan a paper in ten minutes", "Take a full past paper and, in ten minutes, plan it without solving: which questions you would pick, in what order, minutes per question, marks per minute. Planning under time is a skill separate from solving; train it separately."],
        ]},
        { t: "Week 3 verdict", tasks: [
          ["checkpoint", 25, "Error trend checkpoint", "Build your trend table: papers 1 and 2, errors by tag. Write two lines: which enemy is retreating, which still stands, and the one adjustment for paper #3. Evidence, not vibes.", "Paste the trend table and your two lines."],
        ]},
      ],
    },
    {
      theme: "Lock it in",
      days: [
        { t: "Third timed test", tasks: [
          ["skill", 90, "Timed practice paper #3", "Third full paper, full protocol. Mark, tag, count. Three data points make a trend; let us see yours.", "Paste error counts across papers 1, 2, and 3."],
          ["skill", 30, "Python: functions", "Write grade_tools.py with grade_point(score) and cgpa(list_of_grades_and_units). Test both. Functions are reusable effort."],
        ]},
        { t: "The final card", tasks: [
          ["skill", 30, "Protocol final card", "Write the final one-page version of your Personal Exam Protocol. Save it on your phone and print or copy one for your wallet. This card walks into every future exam with you.", "Paste the final card."],
        ]},
        { t: "Semester system", tasks: [
          ["skill", 25, "Design the semester system", "Plan the study system for your next semester: flashcards per course per week, one timed past-question monthly per course, and weekly review slots that fit your timetable. Write it as a simple weekly schedule. The protocol wins exams; this system wins semesters."],
        ]},
        { t: "Code your courses", tasks: [
          ["skill", 30, "Python: dictionaries", "Write courses.py: a dict of your current courses mapping code to units and target grade; loop to print a target report and the CGPA if you hit all targets. Put the number you are chasing on the screen."],
        ]},
        { t: "Month 1 capstone", tasks: [
          ["checkpoint", 40, "Capstone: document the system", "Write the complete Comeback System in one page: the audit findings, the protocol card, the semester system, and your three-paper error trend. This document is evidence that the slide was a system problem, not a you problem, and the system is now fixed.", "Paste the one-page system document."],
        ]},
        { t: "Review prep", tasks: [
          ["career", 25, "Prepare your month 1 review", "Five bullets for Saturday's one-on-one: the error trend, the protocol, how the wins log feels, your streak, and what you want from month 2. Bring the trend table; your mentor loves receipts."],
        ]},
        { t: "Month 1 exam", tasks: [
          ["checkpoint", 30, "Month 1 self-assessment", "In writing: 1) Your top two error types and their kill-steps. 2) Why active recall beats rereading, in your own words. 3) Paste your three-paper trend. 4) One moment this month you almost skipped a day but did not. 5) Confidence about exams now versus week 1, honestly.", "Paste your five answers."],
        ]},
      ],
    },
    {
      theme: "Meet the data",
      days: [
        { t: "Pandas day", tasks: [
          ["skill", 75, "First contact with pandas", "pip install pandas. Download any small CSV (or make one of your GPA data), then in a script or notebook: read_csv, head(), describe(), shape. You just did in four lines what Excel does in forty clicks."],
          ["project", 30, "Meet Nigeria Energy Pulse", "Your capstone: a data story on Nigeria's energy reality. Write the three questions your project will answer, e.g.: How has crude production changed over 20 years? What is the gas flaring trend? How has electricity access grown? Your questions, your country, your portfolio."],
        ]},
        { t: "Get the data", tasks: [
          ["project", 60, "Download the datasets", "From World Bank Open Data (data.worldbank.org) and/or EIA, download Nigeria indicators as CSVs: crude oil production, gas flaring or natural gas data, electricity access percentage. Save them in a new GitHub repo under data/ with a sources.md noting where each came from.", "Paste your repo link with the data folder."],
        ]},
        { t: "Select and filter", tasks: [
          ["skill", 30, "Pandas: selection", "On your energy data: select columns, filter rows by year range (say 2000 onward), and sort by value. Print the five highest-production years. Questions in, answers out."],
        ]},
        { t: "Clean it", tasks: [
          ["skill", 30, "Pandas: cleaning", "Handle the mess: rename awkward columns, deal with missing values (decide: drop or fill, and note why), and convert types. Real data is dirty; cleaning it is the actual job."],
        ]},
        { t: "Group it", tasks: [
          ["skill", 30, "Pandas: groupby", "Compute per-decade averages of production with groupby, and year-over-year change with diff() or pct_change(). Two lines of pandas, decades of history."],
        ]},
        { t: "First findings", tasks: [
          ["project", 30, "Write three facts", "From your exploration, write three facts with numbers (e.g. 'Crude production peaked in 20XX at Y and has fallen Z percent since'). Check each against the data twice. Numbers you can defend are the currency of data work."],
        ]},
        { t: "Week 5 verdict", tasks: [
          ["checkpoint", 25, "Data loaded checkpoint", "Paste the output of df.head() and df.describe() for your main dataset plus your three facts. Five weeks ago you had never written Python; look at what you are holding now.", "Paste head(), describe(), and your three facts."],
        ]},
      ],
    },
    {
      theme: "Analysis",
      days: [
        { t: "Trend analysis", tasks: [
          ["project", 90, "Analyze the production story", "Deep-dive question 1: crude production over 20+ years. Compute the trend, biggest single-year drop, and recovery periods. Note likely causes you can cite (militancy years, OPEC cuts, the pandemic). Data plus context equals insight."],
        ]},
        { t: "Join the stories", tasks: [
          ["project", 60, "Merge a second dataset", "Bring in dataset two (flaring or electricity access) and merge with production by year. Explore: do any patterns move together? Correlation is not causation, but it is a great conversation starter."],
        ]},
        { t: "First chart", tasks: [
          ["skill", 30, "Matplotlib: the line chart", "Plot production over time: title, axis labels, readable dates. Save as PNG into the repo. One honest chart beats ten paragraphs."],
        ]},
        { t: "Second chart", tasks: [
          ["skill", 30, "Matplotlib: comparisons", "A bar chart of per-decade averages, and a second line overlaying your merged indicator. Label everything; charts that need explaining are not finished."],
        ]},
        { t: "Insight hunting", tasks: [
          ["project", 30, "Write five insights", "Five numbered insights with figures, each one sentence, each defensible from your data. These become the spine of your notebook narrative."],
        ]},
        { t: "Narrative skeleton", tasks: [
          ["skill", 30, "Notebook narrative structure", "Restructure your notebook with markdown: title, intro (your three questions), a section per question, conclusion. A notebook someone can read top to bottom without you is the deliverable."],
        ]},
        { t: "Week 6 verdict", tasks: [
          ["checkpoint", 25, "Mini-report checkpoint", "Paste your five insights and confirm both charts are saved in the repo. Which insight surprised you most? That one leads your write-up.", "Paste the five insights and the surprising one."],
        ]},
      ],
    },
    {
      theme: "Visual story",
      days: [
        { t: "Chart pack", tasks: [
          ["project", 90, "Build the chart pack", "Produce four polished charts answering your three questions plus one bonus: consistent style, titles that state the finding ('Production fell 30 percent since 2005'), sources noted. Titles that state findings separate analysts from chart-makers."],
        ]},
        { t: "Tell it straight", tasks: [
          ["project", 60, "Write the narrative", "Fill the notebook sections: for each question, the chart, two paragraphs of what the data shows, and one of context. Write like you are explaining to a smart friend, because you are."],
        ]},
        { t: "Style pass", tasks: [
          ["skill", 30, "Annotations and polish", "Add annotations to key moments on your charts (peak year, biggest drop), tune figure sizes, check every label. Small polish, big credibility."],
        ]},
        { t: "Peer review", tasks: [
          ["project", 30, "Get it reviewed", "Have a coursemate read the notebook top to bottom while you stay silent. Note every place they pause or ask a question; each one is a fix. Feedback is data about your communication."],
        ]},
        { t: "Fix round", tasks: [
          ["project", 30, "Apply the fixes", "Fix everything from the review: clarify, relabel, reorder. Commit with a message describing what changed. Iteration is the work."],
        ]},
        { t: "AI toolkit", tasks: [
          ["career", 15, "Claim your AI toolkit", "Open the AI Toolkit tab and request your Claude API key with a note on your plan: AI-generated plain-language summaries for your data story. Your mentor provisions it from there."],
        ]},
        { t: "Week 7 verdict", tasks: [
          ["checkpoint", 25, "Notebook v1 checkpoint", "Push everything and paste the repo link. Rate the notebook 1-5 on 'could a stranger follow it?' and note the one weakest section for next week.", "Paste the repo link and your rating."],
        ]},
      ],
    },
    {
      theme: "The AI layer",
      days: [
        { t: "First AI call", tasks: [
          ["skill", 75, "Your first Claude API call", "Using your granted key and the AI Toolkit quickstart, write summarize.py: send your five insights to Claude and ask for a 100-word executive summary a policymaker could read. Print it. You just chained data analysis into AI: that is the exact 'data and digital' profile you wrote in your signup.", "Paste the generated summary."],
        ]},
        { t: "AI in the notebook", tasks: [
          ["project", 60, "Auto-summaries in the notebook", "Add a final notebook section: code that sends each section's findings to Claude for a plain-English summary, displayed under the charts. Label it clearly as AI-assisted. Honest use of AI is a skill employers actively hunt for."],
        ]},
        { t: "README", tasks: [
          ["skill", 30, "Write the README", "Repo front page: the three questions, key findings with one chart image, data sources, how to run, and what you would explore next. Two minutes to understand, one click to dig deeper."],
        ]},
        { t: "Repo polish", tasks: [
          ["project", 30, "Repository housekeeping", "Clean structure: data/, notebooks/, charts/, README, sources.md. Delete dead cells and test a fresh top-to-bottom run of the notebook. A tidy repo says a tidy mind."],
        ]},
        { t: "Stretch: dashboard", tasks: [
          ["project", 45, "Stretch: one-page Streamlit dashboard", "pip install streamlit. One page: title, year-range slider, your production chart responding to it. If this feels heavy, simplify to displaying two static charts; shipping something beats polishing nothing."],
        ]},
        { t: "Final checks", tasks: [
          ["project", 30, "Pre-ship checklist", "Fresh clone test: does the notebook run? README accurate? Charts render on GitHub? Sources credited? Fix what fails. Tomorrow you ship."],
        ]},
        { t: "Ship day", tasks: [
          ["checkpoint", 25, "Ship it", "Final push. Paste the repo link. Say it plainly in your evidence: 'I built and shipped a data analysis project.' Eight weeks ago this sentence was not available to you. It is now yours permanently.", "Paste the repo link and that sentence."],
        ]},
      ],
    },
    {
      theme: "Tell the story",
      days: [
        { t: "Write it public", tasks: [
          ["career", 60, "The LinkedIn write-up", "Write the project story: why Nigeria's energy data, two charts, three findings, what you learned, repo link. End with where you are heading (data plus energy). Post it. Your name plus proof-of-work, in public, for the first time.", "Paste the post link."],
        ]},
        { t: "CV upgrade", tasks: [
          ["career", 45, "Put the project on your CV", "Add a Projects section: Nigeria Energy Pulse with three quantified bullets (datasets analyzed, 20-year trends, AI summaries). Add Python and pandas to skills, honestly leveled. Your CV just gained its first proof-of-work."],
        ]},
        { t: "Review prep", tasks: [
          ["career", 30, "Prepare your month 2 review", "Five bullets for Saturday: the shipped repo, the hardest moment, the LinkedIn response, the streak, and month 3 asks (essay review, referee advice). Bring the notebook; walk your mentor through one chart."],
        ]},
        { t: "Teach it", tasks: [
          ["career", 30, "Walk someone through it", "Take a coursemate through the notebook in 15 minutes: questions, method, findings. Their questions will show you what to sharpen before interviews do."],
        ]},
        { t: "Stretch rep", tasks: [
          ["skill", 30, "One more chart or a banner", "Either add one bonus chart (a question a reader asked) or generate a repo banner with fal.ai (request the key in your toolkit if you want it). Play is allowed; play is how range grows."],
        ]},
        { t: "Join the rooms", tasks: [
          ["career", 20, "Join two data communities", "Join Kaggle and one African data community (e.g. DataFest Africa, Data Science Nigeria). Post one short introduction with your project link in one of them. Rooms you are not in cannot open doors for you."],
        ]},
        { t: "Month 2 exam", tasks: [
          ["checkpoint", 30, "Month 2 self-assessment", "In writing: 1) Describe your data pipeline end to end from memory. 2) One insight you can defend with numbers, stated aloud-ready. 3) What did peer review change? 4) groupby explained in one sentence. 5) Confidence rating now versus week 5, and why.", "Paste your five answers."],
        ]},
      ],
    },
    {
      theme: "The scholarship map",
      days: [
        { t: "Research sprint", tasks: [
          ["career", 90, "Build the scholarship tracker", "This is the return match, with a system this time. Build a tracker of 10 funded routes for a 2027 graduate. Include options that do not require NYSC completion and note which do: Erasmus Mundus (many programmes, application windows Oct-Jan), DAAD Germany, Commonwealth Shared UK, Mastercard Foundation, KAUST, MBZUAI, university assistantships (US), and Nigerian options (PTDF, NNPC/SNEPCo). Columns: name, deadline, eligibility, documents, essays, referees, NYSC needed?", "Paste your tracker: ten rows with deadlines."],
        ]},
        { t: "Shortlist four", tasks: [
          ["career", 60, "Shortlist and checklist", "Pick the four best-fit routes by eligibility and timing. For each, write the complete requirements checklist and note what you can prepare now versus at graduation. Rejections in the past were partly a targeting problem; this shortlist is the fix."],
        ]},
        { t: "Documents inventory", tasks: [
          ["career", 30, "Inventory your documents", "List what you have versus need: transcript (request procedure and cost at UNILAG), passport validity, English test needs per programme, CV done, essays pending. Put dates on anything that takes weeks to obtain. Paperwork delays kill more applications than rejections do."],
        ]},
        { t: "Referee strategy", tasks: [
          ["career", 30, "Choose and draft the referee asks", "Pick two lecturers who know your work (the one you consulted about exams counts). Draft the ask: your goals, the specific scholarships, deadlines, plus a one-paragraph summary of your semester (the comeback system, the data project) so praising you is easy."],
        ]},
        { t: "Send the asks", tasks: [
          ["career", 20, "Send both referee requests", "Send both messages today. Nervousness is normal; send anyway. Lecturers say yes to prepared students far more often than you fear.", "Confirm both are sent."],
        ]},
        { t: "Scholarship CV", tasks: [
          ["career", 40, "Build the scholarship CV version", "Adapt your CV for scholarships: academics up top with your CGPA framed honestly and trending (mention the rebuilt study system's results when they land), leadership, the data project, and community. One page, dense with evidence."],
        ]},
        { t: "Week 10 verdict", tasks: [
          ["checkpoint", 25, "Tracker checkpoint", "Paste the tracker status: 10 researched, 4 shortlisted, documents dated, referees asked. The difference between this cycle and past cycles is the system behind it. Say which part of the system past-you needed most.", "Paste the status summary and your reflection line."],
        ]},
      ],
    },
    {
      theme: "The essays",
      days: [
        { t: "Statement day", tasks: [
          ["career", 75, "Outline and open the personal statement", "Outline the comeback arc: the slide and what it taught you, the audit and the system you engineered, the data project as proof of the new operating mode, why this field, the five-year vision. Then write the first 300 words. Open with a moment, not a biography. Committees read thousands of essays; yours has something rare: an honest engineering of a turnaround."],
        ]},
        { t: "Finish draft one", tasks: [
          ["career", 60, "Complete draft one", "Finish the full draft, 700-900 words. Do not polish while drafting; bad first drafts are required. The only failed essay is the unwritten one.", "Paste the first and last paragraphs."],
        ]},
        { t: "AI critique", tasks: [
          ["career", 30, "AI critique, your rewrite", "Ask Claude to critique the draft as a scholarship committee member: clarity, evidence, motivation, and whether the comeback reads as strength. Apply what rings true, in your own voice. The story must stay yours."],
        ]},
        { t: "Human review", tasks: [
          ["career", 30, "Get a human read", "Send the draft to your mentor via the portal and to one senior or lecturer you trust. Ask for the two weakest paragraphs, not general feedback. Specific asks get useful answers."],
        ]},
        { t: "Draft two", tasks: [
          ["career", 40, "Write draft two", "Merge the feedback into draft two. Read it out loud once and fix every stumble. Out-loud reading catches what eyes forgive."],
        ]},
        { t: "Forms day", tasks: [
          ["career", 40, "Fill application one's forms", "Open your top shortlisted application and complete every form field you can today: personal data, education history, uploads. Forms are boring, which is exactly why finishing them early is an advantage."],
        ]},
        { t: "Week 11 verdict", tasks: [
          ["checkpoint", 25, "Essay checkpoint", "Paste your final paragraph and rate the essay 1-5 on 'does this sound like me at my best?'. Note the single sentence you are proudest of.", "Paste the final paragraph, rating, and proudest sentence."],
        ]},
      ],
    },
    {
      theme: "Submit",
      days: [
        { t: "Submission one", tasks: [
          ["career", 75, "Complete and submit application one", "Finish application one end to end. If its window is open, SUBMIT today and screenshot the confirmation. If it opens later, complete every element and calendar the submission date. Either way, application one is done. Remember the rule: submission itself is the win; the outcome is not yours to control.", "Paste the confirmation or the completed-and-scheduled status."],
        ]},
        { t: "Assemble two", tasks: [
          ["career", 60, "Assemble application two", "Tailor the essay and CV for route two and fill its forms. Reuse aggressively; personalise the parts that matter (programme names, faculty, fit)."],
        ]},
        { t: "Submission two", tasks: [
          ["career", 40, "Submit or queue application two", "Same drill: submit if open, otherwise complete and calendar it. Two systematic applications now exist where discouragement used to live.", "Paste the status of application two."],
        ]},
        { t: "Mock interview", tasks: [
          ["career", 40, "AI scholarship interview", "Have Claude interview you as a scholarship panel: 8 questions including 'walk us through your academic record'. Practise the comeback answer out loud: the dip, the system, the evidence it works. That answer, delivered calmly, is your superpower, not your weakness."],
        ]},
        { t: "Alumni intel", tasks: [
          ["career", 30, "Message three scholarship alumni", "Find three past winners of your target scholarships (LinkedIn search works) and send each a four-line message asking one specific question about what made their application work. Winners usually reply to serious askers."],
        ]},
        { t: "Next semester plan", tasks: [
          ["career", 40, "Write the first-class push plan", "Plan next semester precisely: course list, target grade per course, the CGPA math of the climb, flashcard and past-question schedule per course, protocol taped into every exam. The grades push and the scholarship push are the same campaign now."],
        ]},
        { t: "Week 12 verdict", tasks: [
          ["checkpoint", 25, "Submission scoreboard", "Count and paste: applications completed, submitted, queued with dates, alumni messaged, referee status. Read the numbers slowly. This is what the 24-hour rule and a system produce.", "Paste the scoreboard."],
        ]},
      ],
    },
    {
      theme: "Launch and legacy",
      days: [
        { t: "The roadmap", tasks: [
          ["career", 60, "Write your 12-month roadmap", "One page: final-year grades campaign (with the CGPA math), application calendar with every deadline, data skill plan (next: SQL or a second project), and the NYSC-contingency path you already designed. The programme ends Friday; the system is yours forever.", "Paste your roadmap."],
        ]},
        { t: "Prove the protocol", tasks: [
          ["skill", 60, "The dress-rehearsal paper", "One final timed practice paper with the full protocol. Compare the error count against week 2's baseline. Whatever the number says, you now own a measurable, improvable exam system, which is what first class is actually made of.", "Paste the final error count versus the week 2 baseline."],
        ]},
        { t: "Portfolio front door", tasks: [
          ["project", 40, "GitHub profile README", "Create your profile README: who you are, Nigeria Energy Pulse pinned with a chart image, your direction (data plus energy), and contact. Admissions officers and recruiters click profiles; make yours land."],
        ]},
        { t: "Showcase prep", tasks: [
          ["career", 30, "Build your showcase talk", "Five minutes for Saturday's showcase: the honest starting point, the audit, the error trend chart, the data project, the applications scoreboard. Your talk has an actual character arc; use it."],
        ]},
        { t: "Rehearse", tasks: [
          ["career", 20, "Dress rehearsal", "Run the talk once, timed, out loud. Cut what does not fit. You have presented in church and class; this stage is already yours."],
        ]},
        { t: "Pay it forward", tasks: [
          ["career", 20, "Advice for the next cohort", "Write half a page to a future mentee who is watching their CGPA slide: what to audit first, why systems beat self-blame, the one habit that mattered most. You are now evidence for someone else."],
        ]},
        { t: "Graduation", tasks: [
          ["checkpoint", 35, "Final self-assessment", "The last test: 1) Week-1 you versus today, three differences. 2) The error trend across all papers, and the lesson. 3) The proudest artifact. 4) Applications count and what is queued. 5) Finish this sentence honestly: 'The slide did not define me; ___.' See you at the showcase.", "Paste your five answers. Welcome back, first-class mind."],
        ]},
      ],
    },
  ],
};
