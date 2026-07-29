// Arafat Alabi · 500-level ChemE, NSChE UNILAG President, graduating 2026.
// Track: "The Builder's Path" - bridge process safety into AI and automation,
// ship a real AI project (SafeOps AI), and launch funded-master's and
// graduate applications. Built from his signup story: consistency with
// technical learning is the stated weakness, so weekdays are short reps;
// weekends (his stated availability) carry the heavy build blocks.
// Task tuple: [kind, minutes, title, detail, evidenceHint?]

export const ARAFAT = {
  email: "alabiara2332@gmail.com",
  track: "The Builder's Path · ChemE x AI",
  weeks: [
    {
      theme: "Foundation and focus",
      days: [
        { t: "Toolchain day", tasks: [
          ["skill", 60, "Set up your builder toolchain", "Install Python 3 and VS Code, create a GitHub account, and run your first script: hello.py that prints your name and mission. From today, everything you build has a home.", "Paste the output of 'python --version' and the link to your new GitHub profile."],
          ["career", 15, "Write your Why", "Five sentences: why you are moving into AI and automation, what your ChemE background adds, and what changes for your family when this works. Pin it somewhere visible.", "Paste your five-sentence Why."],
        ]},
        { t: "Choose your lane", tasks: [
          ["career", 40, "Choose your primary track", "You listed AI/automation, networking, and full-stack. Spreading across all three guarantees mastering none. Commit to AI and automation as primary; write three target roles that fit it (e.g. AI/automation engineer in energy, ML engineer, process-data engineer) and one line on why each fits YOUR story.", "Paste your chosen track and three target roles."],
          ["skill", 30, "Your first real script", "Write mybio.py: ask for name, level, and dream role with input(), then print a three-line introduction. Run it, break it, fix it. You now write software."],
        ]},
        { t: "Numbers and strings", tasks: [
          ["skill", 30, "Python: numbers and strings", "Build unit_converter.py: convert bar to psi (x14.5038) and Celsius to Kelvin. Take input, print results formatted to two decimal places with f-strings. Chemical engineers who code start exactly here."],
        ]},
        { t: "Decisions", tasks: [
          ["skill", 30, "Python: if/elif/else", "Build safety_alarm.py: input a reactor pressure; below 40 bar print NORMAL, 40 to 55 print WARNING, above 55 print SHUTDOWN. Add one more condition of your own. This is process safety logic in code."],
        ]},
        { t: "Loops", tasks: [
          ["skill", 30, "Python: loops", "Build flow_check.py: loop over a list of 10 hourly flow rates, print each with its hour number, then the average, minimum, and maximum. for-loops are the workhorse of every automation you will ever write."],
        ]},
        { t: "Scout the programmes", tasks: [
          ["career", 40, "Scout five funded master's routes", "List five fully funded options with deadlines: e.g. KAUST (Saudi, full funding), MBZUAI (UAE, AI-focused, full funding), Erasmus Mundus (Europe), DAAD (Germany), and one UK/US option. Note deadline, English test needs, and documents for each.", "Paste your five programmes with deadlines."],
        ]},
        { t: "Week 1 test", tasks: [
          ["checkpoint", 40, "Self-test: build from memory", "Closed book, no references: write pressure_watch.py that asks for a pressure reading, uses if/elif to classify it, and loops to accept 5 readings then prints how many were abnormal. If you get stuck, note where, review, and retry once. Struggling IS the studying.", "Paste your code and its output, plus one line on where you got stuck."],
        ]},
      ],
    },
    {
      theme: "The consistency engine",
      days: [
        { t: "Functions", tasks: [
          ["skill", 60, "Python: functions", "Write three functions in cheme_tools.py: c_to_k(temp), reynolds(density, velocity, diameter, viscosity), and grade_of(score). Call each with test values. Functions are how builders stop repeating themselves."],
          ["career", 30, "Direction note v1", "One page: your chosen track, three target roles, the skills gap between you and them, and this programme's plan to close it. This document steers your next 12 weeks.", "Paste your direction note."],
        ]},
        { t: "Lists", tasks: [
          ["skill", 45, "Python: lists", "Build equipment.py: a list of 8 plant equipment names; print them numbered, add one, remove one, sort them, and search for one with 'in'. Then slice the first three. Lists hold the real world."],
        ]},
        { t: "Daily rep: list drills", tasks: [
          ["skill", 25, "20-minute rep: list problems", "Three drills, no references: sum a list of numbers, find the largest, and build a new list of only values above a threshold. Consistency was your stated struggle; this rep system is the fix. Show up for 20 minutes, that is the whole assignment."],
        ]},
        { t: "Dictionaries", tasks: [
          ["skill", 30, "Python: dictionaries", "Build members.py: a dict of 5 NSChE members mapping name to level. Print all pairs, add a member, update one, and look one up safely with .get(). Dicts are the shape of nearly all real data."],
        ]},
        { t: "Combine it", tasks: [
          ["skill", 35, "Mini-build: cylinder inventory", "Combine functions, lists, and dicts: store gas cylinders as dicts (id, gas, pressure) in a list; write functions to add one, list all, and flag any above a pressure limit. This is a real tiny system."],
        ]},
        { t: "Open the master's door", tasks: [
          ["career", 30, "Send your direction note + one ask", "Message your mentor the direction note through the portal. Then message one lecturer or senior who studied abroad: three lines asking for 15 minutes of advice on funded master's applications.", "Confirm both messages are sent and to whom."],
        ]},
        { t: "Week 2 test", tasks: [
          ["checkpoint", 40, "Self-test: functions and data", "Closed book: write a function classify(readings) that takes a list of pressures and returns a dict with counts of NORMAL, WARNING, and SHUTDOWN. Test it on two lists. Then write one sentence explaining when you would use a dict versus a list.", "Paste code, output, and your dict-vs-list sentence."],
        ]},
      ],
    },
    {
      theme: "Files and real data",
      days: [
        { t: "Files", tasks: [
          ["skill", 60, "Read and write files", "Create members.txt with 10 names (one per line). Write roster.py: read it, print each name numbered, then write formatted output to roster_out.txt. Files are where scripts meet the real world."],
          ["skill", 30, "CSV basics", "Make attendance.csv (name, meetings_attended) for 10 people. Read it with the csv module and print each row. This unlocks every spreadsheet you will ever automate."],
        ]},
        { t: "Automation #1 begins", tasks: [
          ["project", 60, "NSChE attendance cleaner: spec and start", "Your first real automation, from your own presidency: a script that reads attendance.csv, computes attendance percentage per member, flags anyone below 60 percent, and writes a clean summary CSV. Write the 5-line spec, then build the reading and computing part."],
        ]},
        { t: "Ship automation #1", tasks: [
          ["project", 35, "Finish and push the attendance cleaner", "Complete the flagging and summary output, then push to GitHub with a README: what it does, how to run it, sample output. Your first public repo. Done beats perfect.", "Paste the GitHub repo link."],
        ]},
        { t: "Bulletproofing", tasks: [
          ["skill", 30, "Error handling", "Add try/except to your cleaner: handle a missing file and a malformed row without crashing, printing a friendly message instead. Software that survives bad input is what separates scripts from tools."],
        ]},
        { t: "Reports", tasks: [
          ["skill", 30, "Formatted reports", "Extend the cleaner to also write summary.txt: a neat report with a title, date, totals, and the flagged list, using f-strings with alignment. Automation that produces readable output gets used."],
        ]},
        { t: "Narrow the list", tasks: [
          ["career", 40, "Master's shortlist: five to three", "Deep-dive your five programmes and cut to three best-fit. For each: exact deadline, required tests, referee count, and SOP topic. Put the deadlines in your phone calendar now.", "Paste your final three with deadlines."],
        ]},
        { t: "Week 3 test", tasks: [
          ["checkpoint", 40, "Self-test: CSV from memory", "Closed book: write a script that reads any CSV of name,score rows and prints the count, average, and every name scoring above average. Run it on attendance.csv reshaped or a new file.", "Paste code and output."],
        ]},
      ],
    },
    {
      theme: "APIs and your first AI call",
      days: [
        { t: "The internet in Python", tasks: [
          ["skill", 60, "HTTP and JSON", "pip install requests. Call the free Open-Meteo API for Lagos weather, parse the JSON, and print tomorrow's temperature nicely. Every AI service you will ever use speaks exactly this language."],
          ["career", 10, "Claim your AI toolkit", "Open the AI Toolkit tab in this portal and request your Claude API key with a note on what you plan to build. Your mentor provisions it from there."],
        ]},
        { t: "First AI call", tasks: [
          ["skill", 60, "Your first Claude API call", "Using your granted key and the quickstart in the AI Toolkit tab, write ask_ai.py: send a prompt asking Claude to explain HAZOP guidewords to a 200-level student, and print the reply. Read the response twice: you just orchestrated AI with code you wrote.", "Paste your script's output (first 10 lines are fine)."],
        ]},
        { t: "Prompting drills", tasks: [
          ["skill", 30, "Prompt like an engineer", "Same question, three prompts: bare, with a role ('You are a process safety lecturer...'), and with format instructions ('Answer as 5 bullet points...'). Compare outputs and write two lines on what changed. Prompting is a skill with reps like any other."],
        ]},
        { t: "AI meets your data", tasks: [
          ["skill", 35, "Feed your CSV to the AI", "Extend your attendance cleaner: after computing the summary, send it to Claude asking for three observations and one recommendation for the president (you). Print the AI section into summary.txt. Data plus AI is your whole career thesis in one script."],
        ]},
        { t: "Month 1 capstone", tasks: [
          ["checkpoint", 45, "Capstone check: data-to-AI CLI", "Build ask_my_data.py from scratch: load any CSV, print its stats, then loop asking the user questions about it, answering via Claude with the data included in the prompt. Type 'quit' to exit. This combines the entire month: files, loops, functions, APIs, AI.", "Paste the repo link or the code plus one example question and answer."],
        ]},
        { t: "Review prep", tasks: [
          ["career", 30, "Prepare your month 1 review", "Five bullets for Saturday's one-on-one with your mentor: biggest win, hardest struggle, the track decision you made, your streak and points, and one thing you want from month 2. Reviews reward the prepared."],
        ]},
        { t: "Month 1 exam", tasks: [
          ["checkpoint", 35, "Month 1 self-assessment", "Answer honestly in writing, no references: 1) When do you use a dict vs a list? 2) What does try/except do? 3) Write the skeleton of an API call from memory. 4) What are your three target roles? 5) Rate your consistency this month 1-10 and name the day you almost quit but did not.", "Paste your five answers."],
        ]},
      ],
    },
    {
      theme: "Capstone spec: SafeOps AI",
      days: [
        { t: "Define the build", tasks: [
          ["project", 75, "Define SafeOps AI", "Your capstone: an AI incident analyzer for process safety. Input: a plant incident narrative. Output: probable causes, relevant HAZOP guidewords, a severity rating, and lessons learned. Write a one-page spec: who it is for, inputs, outputs, and what 'working' means. This bridges your degree and your new track in one artifact.", "Paste your one-page spec."],
        ]},
        { t: "Collect the fuel", tasks: [
          ["project", 45, "Collect 10 incident narratives", "Gather 10 short real incident summaries from the US CSB website (csb.gov) and similar public sources. Save each as a text file in your repo under incidents/. Real inputs keep the project honest."],
        ]},
        { t: "Design the output", tasks: [
          ["project", 30, "Design the JSON output schema", "Decide the exact fields SafeOps returns: causes (list), guidewords (list), severity (1-5 with label), lessons (list), summary (string). Write one hand-crafted example JSON for one of your incidents. Schema first, prompts second."],
        ]},
        { t: "Prompt v1", tasks: [
          ["project", 30, "Draft the analysis prompt", "Write the prompt that turns a narrative into your JSON schema: role, instructions, the schema itself, and 'respond with JSON only'. Test it on one incident and compare against your hand-crafted example."],
        ]},
        { t: "Prompt v2", tasks: [
          ["project", 30, "Evaluate and iterate", "Run the prompt on three different incidents. Note every failure: wrong severity, vague causes, broken JSON. Fix the prompt and rerun. Keep a prompts.md log of versions; this discipline is what AI engineering actually is."],
        ]},
        { t: "Reliable JSON", tasks: [
          ["skill", 30, "Parse AI output reliably", "Write parse_result(text): extract and json.loads the model's JSON, and on failure retry the API call once before raising a clear error. Production AI code assumes the model will occasionally misbehave."],
        ]},
        { t: "Spec freeze", tasks: [
          ["checkpoint", 30, "Spec freeze checkpoint", "Freeze scope: paste your final spec, final prompt, and one perfect end-to-end example (narrative in, JSON out). From Monday you build; no new features allowed until it ships. Scope creep kills more projects than bugs do.", "Paste the final spec plus one example input/output pair."],
        ]},
      ],
    },
    {
      theme: "Build the core",
      days: [
        { t: "Pipeline day", tasks: [
          ["project", 90, "CLI pipeline v1", "Build safeops.py: read one incident file, call Claude with your frozen prompt, parse the JSON, and print a clean formatted analysis. One file in, one analysis out, no crashes. Commit when it works."],
        ]},
        { t: "Batch mode", tasks: [
          ["project", 60, "Analyze all ten", "Loop over incidents/, analyze each, and save results as JSON files in results/. Print a one-line summary per incident (severity + top cause). Ten real analyses in one command: feel that."],
        ]},
        { t: "Survive failure", tasks: [
          ["project", 30, "Error handling and retries", "Make the batch run survive: API errors retry twice with a pause, bad JSON gets logged and skipped, and a final line reports analyzed/failed counts. Tools earn trust by failing gracefully."],
        ]},
        { t: "Severity logic", tasks: [
          ["project", 30, "Sanity-check the severity", "Add a rules layer: if the narrative mentions fatalities or explosion, severity cannot be below 4; log any case where your rules overrode the model. Hybrid rules-plus-AI is how real safety systems are built, and this makes a great interview story."],
        ]},
        { t: "Model comparison", tasks: [
          ["project", 30, "Compare two models", "Run two incidents through both Claude and OpenAI (request the OpenAI key in your toolkit if you want it) or two Claude model tiers. Write three lines in prompts.md on the differences. Engineers evaluate; fans assume."],
        ]},
        { t: "Git discipline", tasks: [
          ["skill", 20, "Commit hygiene", "Review your repo: tidy file layout, meaningful commit messages, add a .gitignore for results/ if noisy, and write tomorrow's demo plan as a TODO in the README. A clean repo is a CV page."],
        ]},
        { t: "Demo the CLI", tasks: [
          ["checkpoint", 30, "Working CLI demo", "Fresh terminal, run the full batch end to end. Record the moment: paste the console output of a complete run into your evidence. Week's verdict: does it work without you babysitting it?", "Paste the console output of a full batch run."],
        ]},
      ],
    },
    {
      theme: "Give it a face",
      days: [
        { t: "Streamlit day", tasks: [
          ["skill", 90, "Streamlit crash-build", "pip install streamlit. Build app.py: title, a text area, a button, and st.write output. Run 'streamlit run app.py' and see your code in a browser. Then skim the docs' input widgets page. UIs turn scripts into products people can touch."],
        ]},
        { t: "SafeOps gets a face", tasks: [
          ["project", 60, "SafeOps UI v1", "Wire your pipeline into Streamlit: paste an incident narrative, click Analyze, see causes, guidewords, severity, and lessons rendered clearly. Ugly is fine today; working is mandatory."],
        ]},
        { t: "Make it readable", tasks: [
          ["project", 30, "Polish the results view", "Structure the output: severity as a colored metric (green to red), causes and lessons as bullet lists, guidewords as tags. A reader should grasp the analysis in ten seconds."],
        ]},
        { t: "Export", tasks: [
          ["project", 30, "Download button", "Add st.download_button so users can save the analysis as a JSON or text report. Small feature, big signal: you think about what users do AFTER the magic."],
        ]},
        { t: "User test", tasks: [
          ["project", 30, "Test with three humans", "Put SafeOps in front of three coursemates with a sample narrative. Watch silently; note every confusion and every 'ohhh'. Write the top three fixes. Feedback is the cheapest way to get better."],
        ]},
        { t: "Fix round", tasks: [
          ["project", 30, "Fix the top three", "Implement the three fixes from yesterday's testing. Commit each separately. Shipping is iterating in public."],
        ]},
        { t: "UI demo", tasks: [
          ["checkpoint", 25, "UI checkpoint", "Run through the full flow once and capture a screenshot. Paste evidence and rate your own UI 1-5 with one line on what would make it a 5.", "Paste a screenshot link or describe the working flow plus your rating."],
        ]},
      ],
    },
    {
      theme: "Polish and publish",
      days: [
        { t: "Docs and deploy", tasks: [
          ["project", 60, "README that sells", "Write the real README: one-line pitch, the problem, screenshots, how to run, tech used, limitations, and what is next. Someone who never met you should understand and trust the project in two minutes."],
          ["project", 45, "Deploy to the internet", "Deploy on Streamlit Community Cloud (free) with your API key in secrets, not in code. Get the public URL. Your work now has an address on the internet.", "Paste the live URL."],
        ]},
        { t: "Harden it", tasks: [
          ["project", 45, "Edge cases and cleanup", "Try to break your live app: empty input, a 3-word narrative, a 2,000-word one, gibberish. Handle each gracefully with a helpful message. Then delete dead code. Ship quality, not just function."],
        ]},
        { t: "Write the story", tasks: [
          ["career", 30, "Draft the LinkedIn post", "Draft the build story: the problem, why a ChemE student built an AI tool, one screenshot, the live link, and what you learned. Write like you talk. Do not post yet; tomorrow's video joins it."],
        ]},
        { t: "Record the demo", tasks: [
          ["project", 30, "Two-minute demo video", "Screen-record: 15 seconds of problem, 90 seconds of live demo, 15 seconds of what is next. One take is enough; authentic beats polished."],
        ]},
        { t: "Publish day", tasks: [
          ["career", 20, "Post it everywhere it matters", "Publish the LinkedIn post with the video, share the link in your NSChE channels, and send it directly to two people you respect with a one-line personal note. Visibility is a skill you are training, not vanity.", "Paste the LinkedIn post link."],
        ]},
        { t: "Gather signal", tasks: [
          ["career", 20, "Collect feedback and stars", "Ask five people to try the live app and star the repo. Reply to every comment on your post. Note the best piece of feedback in your README's what-is-next section."],
        ]},
        { t: "Ship confirmation", tasks: [
          ["checkpoint", 25, "Shipped checkpoint", "Confirm the full package: live URL, repo link, post link, video. You conceived, built, and shipped an AI product in five weeks. Write one sentence to the you of week 1 about it.", "Paste all links plus your one-sentence message to week-1 you."],
        ]},
      ],
    },
    {
      theme: "Tell the story",
      days: [
        { t: "Case study", tasks: [
          ["career", 60, "Write the project case study", "500 words for reuse in SOPs and interviews: context, problem, approach, technical decisions (rules layer, JSON parsing, retries), result, and what you would do differently. This document will be quarried for years."],
        ]},
        { t: "CV upgrade", tasks: [
          ["career", 45, "Put SafeOps on your CV", "Add a Projects section: SafeOps AI with three quantified bullets (10 incidents analyzed, deployed live, users tested). Rewrite your NSChE presidency bullets to show scale: members led, events run, money handled."],
        ]},
        { t: "Review prep", tasks: [
          ["career", 30, "Prepare your month 2 review", "Five bullets for Saturday's session: the shipped link, the hardest bug, feedback received, streak status, and your month 3 asks (referees, application reviews). Bring the demo."],
        ]},
        { t: "Stretch: images", tasks: [
          ["skill", 30, "Stretch: generate a project banner", "Request the fal.ai key in your toolkit and generate a banner image for the SafeOps repo and your LinkedIn post, or design one manually. Ten minutes of play; creative tools are part of the stack too."],
        ]},
        { t: "Teach it", tasks: [
          ["career", 30, "Give a 15-minute walkthrough", "Walk a coursemate or NSChE junior through how SafeOps works, from prompt to UI. Teaching it cements it and plants your flag as the chapter's builder."],
        ]},
        { t: "Receipts", tasks: [
          ["career", 20, "Gather two testimonials", "Ask two people who tried SafeOps for one honest sentence about it. Save them; they season your LinkedIn featured section and SOPs."],
        ]},
        { t: "Month 2 exam", tasks: [
          ["checkpoint", 35, "Month 2 self-assessment", "In writing: 1) Sketch your pipeline end to end from memory. 2) Why does the severity rules layer exist? 3) What did user testing change? 4) Paste your favourite line of code and why. 5) Rate consistency 1-10 versus month 1.", "Paste your five answers."],
        ]},
      ],
    },
    {
      theme: "Your story on paper",
      days: [
        { t: "CV overhaul", tasks: [
          ["career", 90, "Master CV overhaul", "Full rebuild, one page: header with LinkedIn and GitHub, education, projects (SafeOps first), leadership (presidency with numbers), skills. Every bullet starts with a verb and carries a number where possible. Have Claude critique it against a grad-programme job description, then fix.", "Paste a link to the CV or its Projects section text."],
        ]},
        { t: "LinkedIn overhaul", tasks: [
          ["career", 60, "LinkedIn overhaul", "New headline (Chemical Engineering finalist building AI tools for process safety), About section telling the Ajegunle-to-builder story in first person, SafeOps in Featured, skills reordered. Profiles get found; make yours findable."],
        ]},
        { t: "Statement outline", tasks: [
          ["career", 30, "Personal statement outline", "Outline the SOP arc: the move that changed everything, why ChemE, the NSChE leadership test, the discovery that code multiplies an engineer, SafeOps as proof, why THIS programme, and the five-year vision. One line per beat."],
        ]},
        { t: "Draft the opening", tasks: [
          ["career", 40, "Statement draft: first 300 words", "Write the opening scene and the pivot. Start with a moment, not 'From a young age'. You have a story most applicants would trade for; tell it plainly."],
        ]},
        { t: "Finish draft one", tasks: [
          ["career", 40, "Complete statement draft 1", "Finish the full draft: 700 to 900 words. Bad first drafts are mandatory; unwritten drafts are the only failure.", "Paste your draft's first and last paragraphs."],
        ]},
        { t: "Revise", tasks: [
          ["career", 30, "AI critique, human rewrite", "Ask Claude to critique your draft as a scholarship committee member: clarity, evidence, motivation. Take what is useful, rewrite in YOUR voice. AI sharpens; it must not sand off the Ajegunle."],
        ]},
        { t: "Assets check", tasks: [
          ["checkpoint", 25, "Assets checkpoint", "Inventory: CV done? LinkedIn done? Statement draft 2? Three programme deadlines in calendar? Paste status of each and name the weakest asset; it gets priority next week.", "Paste your four-item status list."],
        ]},
      ],
    },
    {
      theme: "Applications live",
      days: [
        { t: "Application war room", tasks: [
          ["career", 60, "Build the application tracker", "One sheet, every row an application: three master's programmes plus four jobs (Shell and TotalEnergies graduate programmes, one tech role, one wildcard). Columns: deadline, status, documents, referees, next action. What gets tracked gets done.", "Paste your tracker rows (programme, deadline, next action)."],
          ["career", 30, "Find the four roles", "Confirm the four live vacancies or programme windows and their real requirements. Prefer open-now over someday."],
        ]},
        { t: "First application", tasks: [
          ["career", 60, "Tailor and apply: role 1", "Tailor the CV top third to role 1's language, write the short cover note, submit, and log it. First one is the hardest; it breaks the seal.", "Confirm submission: role and date."],
        ]},
        { t: "Second application", tasks: [
          ["career", 40, "Apply: role 2", "Same drill, faster this time. Tailor, submit, log, move. Momentum loves a scoreboard."],
        ]},
        { t: "SOP tailoring", tasks: [
          ["career", 40, "Tailor statement for programme 1", "Adapt your statement to programme 1: name specific courses, labs, or faculty and connect them to SafeOps and your goals. Generic essays lose to specific ones every time."],
        ]},
        { t: "Referees", tasks: [
          ["career", 30, "Ask your referees", "Ask two lecturers for references: short message with your CV, the programmes, deadlines, and a one-paragraph summary of what you have built this term (make it easy to praise you). Send both today.", "Confirm both asks are sent."],
        ]},
        { t: "Tracker discipline", tasks: [
          ["career", 20, "Tracker update ritual", "Update every row: status, replies, next actions with dates. Chase anything stalled with a polite follow-up. Ten minutes of admin protects weeks of work."],
        ]},
        { t: "Scoreboard", tasks: [
          ["checkpoint", 25, "Submission scoreboard", "Count them: applications submitted, asks sent, referees confirmed. Paste the numbers. Sent is the metric; replies are weather.", "Paste your counts: submitted / asks sent / referees confirmed."],
        ]},
      ],
    },
    {
      theme: "Interview-ready",
      days: [
        { t: "Story bank", tasks: [
          ["career", 60, "Build your STAR story bank", "Write five stories in Situation-Task-Action-Result form: leading under pressure (NSChE), a technical challenge (SafeOps bug), a failure and recovery, influencing without authority, and initiative (this programme). These five answer 80 percent of interviews."],
        ]},
        { t: "Mock interview", tasks: [
          ["career", 45, "AI mock interview", "Have Claude interview you for a graduate engineer role: 10 questions, one at a time, answer out loud, type summaries. Then ask it to grade and identify your two weakest answers.", "Paste the two weakest answers identified."],
        ]},
        { t: "Repair", tasks: [
          ["career", 30, "Rebuild the weak answers", "Rewrite both weak answers with sharper STAR structure and real numbers. Say each out loud three times. Interviews are performances; performers rehearse."],
        ]},
        { t: "Technical pitch", tasks: [
          ["career", 30, "The 90-second pitch", "Record yourself explaining SafeOps in 90 seconds: problem, build, result. Listen back once, cut the rambling, record again. This pitch works in interviews, viva panels, and lift lobbies."],
        ]},
        { t: "Insider intel", tasks: [
          ["career", 30, "Request two informational chats", "Message two people working where you want to be (Shell graduate, ML engineer, master's student abroad): four lines, one specific question about their path. People love being asked well."],
        ]},
        { t: "Essay second pass", tasks: [
          ["career", 40, "Statement final pass", "Read your statement out loud, fix every stumble, tighten to word limits, and lock final versions for each programme. Done means submitted-ready."],
        ]},
        { t: "Mock round 2", tasks: [
          ["checkpoint", 35, "Mock interview round two", "Second AI mock, harder questions requested. Compare against round one: which answers improved, what score would you give yourself now? Paste the comparison.", "Paste your round-1 vs round-2 self-scores and biggest improvement."],
        ]},
      ],
    },
    {
      theme: "Launch and legacy",
      days: [
        { t: "The roadmap", tasks: [
          ["career", 60, "Write your 12-month roadmap", "One page, next 12 months: graduation and NYSC plan, application calendar with every deadline, skill plan (what after Python plus AI APIs), income plan, and the next project idea. The programme ends; the system continues.", "Paste your roadmap."],
        ]},
        { t: "Clear the queue", tasks: [
          ["career", 60, "Submit everything open", "Any application with an open window and ready documents: submit today. Update the tracker. Leave nothing ready-but-unsent."],
        ]},
        { t: "Portfolio front door", tasks: [
          ["project", 40, "GitHub profile README", "Create your profile README: who you are, SafeOps pinned with a screenshot, the attendance cleaner, skills, and contact. Recruiters and admissions officers do click."],
        ]},
        { t: "Showcase prep", tasks: [
          ["career", 30, "Build your showcase talk", "Five minutes for Saturday's cohort showcase: where you started, the track choice, live SafeOps demo, the numbers (applications, streak, points), and what is next. Slides optional; the demo is the star."],
        ]},
        { t: "Rehearse", tasks: [
          ["career", 20, "Dress rehearsal", "Run the talk once, timed, out loud. Cut whatever does not fit in five minutes. Confidence on stage is preparation wearing a nice shirt."],
        ]},
        { t: "Pay it forward", tasks: [
          ["career", 20, "Advice for the next cohort", "Write half a page to the next mentee on this track: what to do in week 1, what you wish you knew, the one habit that mattered most. Legacy is part of leadership."],
        ]},
        { t: "Graduation", tasks: [
          ["checkpoint", 35, "Final self-assessment", "The last test: 1) Week-1 you vs today, three differences. 2) The proudest artifact and why. 3) The habit you will never drop. 4) Applications count and what is still open. 5) Your one-line identity statement now. See you at the showcase.", "Paste your five answers. Congratulations, builder."],
        ]},
      ],
    },
  ],
};
