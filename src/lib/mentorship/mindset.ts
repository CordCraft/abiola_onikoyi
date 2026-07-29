import "server-only";

// Shared mindset curriculum for the 91-day mentorship programme (canonical
// copy; scripts/mentorship-program/shared.mjs mirrors it for the seed CLI).
// A 13-week self-esteem and behaviour arc; every day carries one short
// mindset exercise alongside the mentee-specific skill work. Week themes
// double as the coach's note shown at the top of each day.

export const WEEK_TAGLINES = [
  "Own your story. This week you take stock, take aim, and start.",
  "Watch your self-talk. The voice in your head is trainable.",
  "Feelings lie; evidence does not. This week you collect receipts.",
  "Progress beats perfection. Done is the engine of confidence.",
  "You act like who you believe you are. This week we upgrade the identity.",
  "Setbacks are data, not verdicts. Scientists do not cry over experiments.",
  "Confidence is a lagging indicator of reps. Stack them.",
  "Work that stays hidden helps no one. This week you let yourself be seen.",
  "You built something real. Celebrate it loudly and share it.",
  "Rejection is redirection. Volume of brave asks beats fear every time.",
  "Closed mouths do not get fed. This week you knock on doors.",
  "Look how far you have come. Now reach back and pull someone up.",
  "Integration week. You are not who you were 91 days ago. Prove it.",
];

// MINDSET[week][day] -> { t: title, d: instruction }, weeks 0..12, days 0..6
// (Saturday..Friday). Each is a 5-10 minute exercise.
export const MINDSET = [
  [
    { t: "Name the mission", d: "Write three sentences: who you are, what you are building toward, and why it matters. Read them out loud once. This is your anchor for the next 91 days." },
    { t: "Your starting line", d: "List five hard things you have already survived or achieved. Look at the list. You already have evidence that you can do hard things." },
    { t: "Strengths inventory", d: "Write three strengths people have complimented you on, and for each one, a moment where it showed up. You are not starting from zero." },
    { t: "Meet the inner critic", d: "Write down the most common negative sentence your mind says about you. Below it, write the reply a good coach would give. Keep both. You will need the reply again." },
    { t: "Pick your values", d: "From honesty, growth, service, courage, excellence, family, and faith, pick your top three and write one line each on why. Decisions get easier when values are explicit." },
    { t: "Start your Wins Log", d: "Create a note titled Wins Log. Add today: one thing you did well this week, however small. You will feed this log for 13 weeks and it will become proof." },
    { t: "Week one mirror", d: "Reread your Day 1 mission. Rate 1 to 5 how much you lived it this week, and write one sentence about what next week's you will do differently." },
  ],
  [
    { t: "Catch and flip", d: "Today, catch one 'I can't' thought and rewrite it as 'I can't yet, and here is my next step.' Write both versions down." },
    { t: "Talk like a friend", d: "Write the advice you would give your best friend if they had your current biggest worry. Now take that advice yourself. You deserve your own kindness." },
    { t: "The power question", d: "Swap 'Why does this keep happening to me?' for 'What can I do about this in the next ten minutes?' Use it once today and note what happened." },
    { t: "Body first", d: "Stand or sit tall for two minutes, shoulders back, slow breaths. Notice how confidence follows posture. Use this before your hardest task today." },
    { t: "The five-second start", d: "When you feel resistance to a task today, count down 5-4-3-2-1 and physically start. Log whether it worked. Action kills anxiety." },
    { t: "Wins Log: effort counts", d: "Add two wins from this week. At least one must be about effort, not outcome. Trying when you did not feel like it is a win." },
    { t: "Language check", d: "Scan your week. Did you say 'I'm just bad at X' anywhere? Rewrite each one as 'I'm still learning X.' Words become beliefs." },
  ],
  [
    { t: "Fact versus feeling", d: "Write one fear you have about your future. Under it, list the facts for and against it. Keep only what the evidence supports. Fear shrinks under cross-examination." },
    { t: "Skill receipts", d: "List every skill you have gained in the last 12 months, however small. Include what this programme has already added. The list only grows from here." },
    { t: "You are someone's proof", d: "Somebody younger looks at you and believes more is possible. Write who that might be and what they see when they look at you." },
    { t: "Compliment bank", d: "Ask one person today what they think you are good at. Write the answer down word for word, without arguing with it." },
    { t: "Compare to you only", d: "Compare yourself to you, 30 days ago, and nobody else. Write two concrete ways this month's version of you is ahead." },
    { t: "Wins Log: read aloud", d: "Add two wins, then read the whole log from the start, out loud. Hearing your own evidence hits differently than reading it." },
    { t: "One action, not one feeling", d: "Rate your confidence 1 to 5. Then write ONE action, not a feeling, that would move it up by one point next week. Schedule that action." },
  ],
  [
    { t: "The done list", d: "Tonight, instead of staring at what is left, write down everything you DID today. Momentum is built by counting what is done." },
    { t: "The 80 percent rule", d: "Ship one thing today at 80 percent instead of polishing it to imaginary perfection. Perfectionism is often fear wearing a suit." },
    { t: "One tiny promise", d: "Make yourself one small promise this morning, like 20 minutes of focused work, and keep it. Self-trust is built in small reps, not grand gestures." },
    { t: "Failure resume", d: "Write three past failures and one thing each taught you. Failures you learn from are tuition, not verdicts." },
    { t: "Energy audit", d: "List what drained you and what energised you this week. Choose one drain to reduce next week. Guard your energy like money." },
    { t: "Wins Log: month one", d: "Add your month one wins; aim for five. You now have a full month of receipts that you show up." },
    { t: "Letter to week-13 you", d: "Write four sentences to yourself about who you were four weeks ago versus today. Save it. You will read it in week 13 and smile." },
  ],
  [
    { t: "I am becoming", d: "Complete this sentence in writing with three different endings: 'I am becoming the kind of person who...'. Identity drives behaviour more than motivation ever will." },
    { t: "Act as if", d: "Pick one thing the two-years-from-now version of you would do today, and do it. The future you is built one borrowed habit at a time." },
    { t: "Environment check", d: "Does your phone home screen, desk, and playlist support who you are becoming? Change one thing in your environment today to match the mission." },
    { t: "Role model teardown", d: "Pick someone living your dream role. Write three habits they almost certainly practise daily. Adopt one of them starting this week." },
    { t: "Say it out loud", d: "Tell one person your goal today, out loud, specifically. Spoken goals become commitments; silent goals stay wishes." },
    { t: "Wins Log: identity proof", d: "Add two wins and label which identity each one proves: builder, finisher, learner, leader. You are collecting evidence of who you are." },
    { t: "The builder's mirror", d: "One sentence: what did the builder in you build this week? If the answer is thin, what will it be by next Friday?" },
  ],
  [
    { t: "Think like a scientist", d: "Take one thing that went wrong recently and write it up like an experiment: what was tested, what happened, what is the next test? No shame, just data." },
    { t: "The gap and the gain", d: "Write the gap (where you wish you were) and the gain (how far you have come since day 1). Spend twice as long on the gain. Both are true; only one fuels you." },
    { t: "Circle of control", d: "List your current worries, then sort them into 'I control this' and 'I do not'. Act only on the first list today. The second list is rent-free noise." },
    { t: "Stress is a signal", d: "Notice where stress shows up in your body today. Name it, take five slow breaths, and continue. Feelings are signals, not stop signs." },
    { t: "Your comeback story", d: "Recall a time you recovered from a low point. Write down the first small action that started the recovery. That move is in your toolkit forever." },
    { t: "Wins Log: comebacks", d: "Add two wins, including one comeback from this week, however small: a task you almost skipped but did, a mistake you fixed." },
    { t: "The if-then armour", d: "Write your recovery plan: 'If I miss a day, fail a test, or get rejected, then within 24 hours I will ___.' Decide now, so the bad day does not get to decide." },
  ],
  [
    { t: "Rate your skill stack", d: "Write the three skills you are building and rate each 1 to 10, honestly. Confidence is a lagging indicator of practice, and you are about to practise." },
    { t: "Hard thing first", d: "Do your hardest task first today, before your energy is spent. Tonight, note how the rest of the day felt once the dragon was slain early." },
    { t: "Teach to learn", d: "Explain one thing you learned this week to someone, or record a voice note teaching it to an imaginary student. Teaching is the fastest proof of competence." },
    { t: "One discomfort rep", d: "Do one slightly uncomfortable growth act today: ask a question publicly, post something, introduce yourself to someone. Courage is a muscle, not a mood." },
    { t: "Confidence you can schedule", d: "Before your next big task, write a three-line plan first. Preparation is confidence you can schedule in advance." },
    { t: "Wins Log: remeasure", d: "Add two wins, then re-rate the three skills from Saturday. Any movement, even 1 point, is the system working." },
    { t: "Count your reps", d: "Count the total tasks you have completed in this portal so far. Write the number down. That number is proof, not luck." },
  ],
  [
    { t: "Name the visibility fear", d: "Write what you are afraid people will think if you share your work. Then write what the RIGHT people will think. You are not building for the mockers." },
    { t: "Draft in public", d: "Share one piece of work-in-progress with one person and ask for feedback. Sharing drafts is brave; hiding polished work forever is not humility, it is fear." },
    { t: "Take the compliment", d: "Today, when anyone compliments you, say only 'thank you'. No deflecting, no 'it was nothing'. Notice how hard and how good that feels." },
    { t: "Your two-sentence intro", d: "Write a two-sentence introduction of yourself and your current project. Say it out loud three times. You will use it sooner than you think." },
    { t: "Ask for help", d: "Ask one specific person one specific question about your work today. Asking well is a strength signal; struggling silently helps nobody." },
    { t: "Wins Log: witnessed", d: "Add two wins. At least one must involve another human seeing your work. Work that is seen compounds." },
    { t: "Audience of one", d: "Write the name of one real person your future work will help. From now on, work for them, not for applause." },
  ],
  [
    { t: "What shipping proves", d: "You are about to finish your build month. Write down what shipping this project proves about you that no one can take away." },
    { t: "Gratitude times three", d: "Write three people who contributed to your journey this season and one line of thanks for each. Send at least one of them today." },
    { t: "Plan the celebration", d: "Plan a small, real celebration for shipping your project: a meal, a call home, an evening off. Rewards wire habits into identity." },
    { t: "Impostor check", d: "If sharing your work makes you feel like a fraud, write this down: 'Beginners who ship beat experts who hide.' Then ship anyway." },
    { t: "Story of the build", d: "Write five bullet points of your project journey: the idea, the struggle, the breakthrough, the result, the lesson. This story is now an asset." },
    { t: "Wins Log: month two", d: "Add your month two wins; aim for five. Read the full log out loud from day one. That person on page one would be proud." },
    { t: "Letter after building", d: "Four sentences to yourself: what did building something real change about how you see yourself? Save it next to the month one letter." },
  ],
  [
    { t: "Rejection math", d: "A no is a data point, not a verdict on your worth. Write your target number of applications and bold asks for this month. Volume beats fear." },
    { t: "The 24-hour rule", d: "Decide now: when a rejection lands, you get 24 hours to feel it fully, then one concrete next action. Write down what your default next action will be." },
    { t: "The rejected greats", d: "Find one person you admire who was rejected repeatedly before breaking through. Write their rejection count next to yours. You are in good company, and early innings." },
    { t: "You are the offer", d: "You are not begging for opportunity; you are offering value. Write three specific things an opportunity-giver gains by choosing you." },
    { t: "Fear-setting", d: "For your next application, write: the worst realistic outcome, how you would recover, and what staying silent costs you in three years. Inaction has a price tag too." },
    { t: "Wins Log: brave asks", d: "Add two wins. Every brave ask this week counts as a win regardless of the answer. You control the sending, not the response." },
    { t: "Scoreboard of asks", d: "Write your sent-count for the week: applications, messages, requests. Sent is success. The scoreboard tracks courage, not outcomes." },
  ],
  [
    { t: "The warm list", d: "Write ten people who could open a door for you: lecturers, alumni, seniors, family friends, people from events. This is your contact list for the week." },
    { t: "First knock", d: "Send message one from your list. Four lines: who you are, what you are building, one specific ask, thank you. Short, specific, human." },
    { t: "Follow the fear", d: "The contact you are most nervous to message is usually the most valuable one. Send that exact message today. Nerves are a compass." },
    { t: "Give first", d: "Send one message today that offers something: a congratulations, a useful resource, a genuine thank you. Networks are built on deposits, not withdrawals." },
    { t: "Two more knocks", d: "Send two more messages from your warm list. Reusing your template is allowed; personalise one line for each person." },
    { t: "Wins Log: replies and sends", d: "Add two wins including any replies received. No replies yet? The sends still count. Seeds do not sprout the day you plant them." },
    { t: "Count the doors", d: "Total your outreach for the week. Every door knocked is one more than silence would have opened. Keep the list warm; you will return to it." },
  ],
  [
    { t: "Look down the ladder", d: "Write what you know now that the year-one version of you would beg to learn. You are further up the ladder than you feel." },
    { t: "Teach one thing", d: "Share one lesson from this programme with a coursemate or junior today. The fastest way to secure knowledge is to give it away." },
    { t: "Report to your believers", d: "Write a short update to someone who invested in you: what you have done with their belief this season. Send it if you can. Gratitude closes loops." },
    { t: "Name this chapter", d: "If your journey were a book, what would this chapter be called? Name the next chapter too. You are the author, not just a character." },
    { t: "The service idea", d: "Write one way you could help ten people like you within the next year using what you now know. Keep it; it may become your next project." },
    { t: "Wins Log: the archive", d: "Add two wins, then count the total entries in your log. Read your five favourites out loud. This document did not exist 12 weeks ago. Neither did this version of you." },
    { t: "Design the ending", d: "One week left. Write the ending you want for week 13, then list what it requires from you Monday to Friday. Endings are built midweek." },
  ],
  [
    { t: "The full look-back", d: "Reread your week 4 and week 9 letters. Write down what the person who wrote them did not yet know. Growth is easiest to see in the rear-view mirror." },
    { t: "Identity 2.0", d: "Rewrite 'I am becoming the kind of person who...' from week 5 without looking at the original. Then compare. Keep both versions forever." },
    { t: "Choose your keepers", d: "Choose the three daily habits from this programme you will keep after it ends. Put them in your calendar now, before the structure disappears." },
    { t: "Letter to future you", d: "Write to yourself 12 months from now: what you promise, what you hope, and what you refuse to go back to. Seal it in a note with a reminder date." },
    { t: "The thank-you round", d: "Send a final thank-you to your mentor and one other person from these 13 weeks. Specific beats long: name one thing they did that mattered." },
    { t: "Wins Log finale", d: "Add your final wins, then read the entire log from Day 1. That document is the proof of who you are now. Keep feeding it after the programme ends." },
    { t: "Graduation mirror", d: "Write your five-sentence story of the last 91 days: where you started, what you built, what changed. You will tell it at the showcase. Own every word." },
  ],
];

// Kind -> default points. Checkpoints are the weekly tests and weigh most.
export const POINTS = { mindset: 5, skill: 10, project: 15, career: 10, checkpoint: 25 };


export const CHECKIN_TASK = {
  kind: "career",
  minutes: 10,
  points: 10,
  title: "Submit your weekly check-in",
  detail:
    "Go to the Check-ins tab and submit this week's reflection: wins, blockers, and next week's focus. This is what unlocks next week's tasks, and your mentor reads every word.",
} as const;
