/**
 * IELTS Speaking examiner: system instruction, topic bank and exam tools.
 */

// Topics come from question-bank.js and are drawn like a shuffled deck: every
// topic comes up once before any topic comes up again. New topics this season
// count half a use, so they come up twice per round. Topics from the last few
// sessions (COOLDOWN) are never drawn, even when they're due. Usage is kept per browser.
const USAGE_STORAGE = "ielts-examiner.topic-usage";
const OLD_RECENT_STORAGE = "ielts-examiner.recent-topics";

// Which parts each practice mode covers, in order
const PRACTICE_MODES = {
  full: { parts: [1, 2, 3], label: "完整模考（Part 1–3）" },
  p1: { parts: [1], label: "只練 Part 1" },
  p2: { parts: [2], label: "只練 Part 2" },
  p23: { parts: [2, 3], label: "Part 2 + Part 3" },
  p3: { parts: [3], label: "只練 Part 3" },
};

// How many recent sessions to skip, per group
const COOLDOWN = { opener: 2, part1: 4, part2: 8 };

const TOPIC_GROUPS = {
  opener: { list: () => PART1_OPENERS, nameOf: (t) => t.topic },
  part1: { list: () => PART1_TOPICS, nameOf: (t) => t.topic },
  part2: { list: () => PART2_CARDS, nameOf: (c) => c.card },
};

// { opener|part1|part2: { counts: { name: uses }, recent: [[names], ...] newest session first } }
function loadUsage() {
  let usage = null;
  try {
    usage = JSON.parse(localStorage.getItem(USAGE_STORAGE));
  } catch {
    usage = null;
  }
  if (usage) return usage;

  // First run with this version: treat the old "recent topics" as used once
  usage = {};
  let recent = {};
  try {
    recent = JSON.parse(localStorage.getItem(OLD_RECENT_STORAGE)) || {};
  } catch {
    recent = {};
  }
  for (const key of Object.keys(TOPIC_GROUPS)) {
    const names = recent[key] || [];
    usage[key] = { counts: Object.fromEntries(names.map((n) => [n, 1])), recent: names.map((n) => [n]) };
  }
  return usage;
}

// Called once the examiner has actually started, so failed connections don't use up topics
function rememberTopics(selection, parts) {
  const usage = loadUsage();
  const use = (key, items) => {
    const { nameOf } = TOPIC_GROUPS[key];
    const group = usage[key] || (usage[key] = { counts: {}, recent: [] });
    for (const item of items) group.counts[nameOf(item)] = (group.counts[nameOf(item)] || 0) + (item.isNew ? 0.5 : 1);
    group.recent = [items.map(nameOf), ...(group.recent || [])].slice(0, COOLDOWN[key]);
  };
  if (parts.includes(1)) {
    use("opener", [selection.opener]);
    use("part1", selection.part1);
  }
  if (parts.includes(2) || parts.includes(3)) use("part2", [selection.part2]);
  try {
    localStorage.setItem(USAGE_STORAGE, JSON.stringify(usage));
  } catch {
    // Private mode: repeats are possible, nothing else breaks
  }
}

// Draw from the least-used topics, skipping recent sessions' when possible
function drawTopics(key, count, usage) {
  const { list, nameOf } = TOPIC_GROUPS[key];
  const { counts = {}, recent = [] } = usage[key] || {};
  const cooling = recent.slice(0, COOLDOWN[key]).flat();
  const uses = (item) => counts[nameOf(item)] || 0;
  const pool = [...list()];
  const picked = [];
  while (picked.length < count && pool.length) {
    const fresh = pool.filter((item) => !cooling.includes(nameOf(item)));
    const candidates = fresh.length ? fresh : pool;
    const least = Math.min(...candidates.map(uses));
    const tier = candidates.filter((item) => uses(item) === least);
    const item = tier[Math.floor(Math.random() * tier.length)];
    picked.push(item);
    pool.splice(pool.indexOf(item), 1);
  }
  return picked;
}

function pickExamTopics() {
  const usage = loadUsage();
  return {
    opener: drawTopics("opener", 1, usage)[0],
    part1: drawTopics("part1", 2, usage),
    part2: drawTopics("part2", 1, usage)[0],
  };
}

function describeTopic({ topic, samples }) {
  return `"${topic}" (typical questions: ${samples.join(" / ")})`;
}

function describeParts(parts) {
  return parts.length === 1 ? `Part ${parts[0]}` : `Parts ${parts.join(" and ")}`;
}

function buildSystemInstruction(selection, parts = [1, 2, 3]) {
  const [topicA, topicB] = selection.part1;
  const card = selection.part2.card;
  const part3 = PART3_DIRECTIONS[selection.part2.part3];
  const has = (n) => parts.includes(n);
  const full = parts.length === 3;
  const endTest = `say "Thank you. That is the end of the speaking test." and call end_exam`;

  const scope = full
    ? "a full, realistic IELTS Speaking test"
    : `a realistic IELTS Speaking practice session that covers only ${describeParts(parts)} of the test`;

  const opening = has(1)
    ? ""
    : `
## Opening
Start speaking immediately (do not call any tool first). Say: "Good morning/afternoon. My name is [a common British first name]. Today we're going to practise ${describeParts(parts)} of the speaking test." Then go straight into Part ${parts[0]} as described below. Do not ask for the candidate's name and do not ask any Part 1 questions.
`;

  const part1Section = `
## Part 1: Introduction and interview (about 4 to 5 minutes)
1. Start speaking immediately (do not call any tool first). Introduce yourself: "Good morning/afternoon. My name is [a common British first name]. Could you tell me your full name, please?" Then: "And what can I call you?"
2. Ask about the opening topic ${describeTopic(selection.opener)}, then the topic ${describeTopic(topicA)}, then the topic ${describeTopic(topicB)}. Ask about 3 to 4 short questions per topic. Use the typical questions as your basis, worded naturally as a real examiner would, and add your own follow-ups.
3. Base each follow-up question on what the candidate has just said (pick up a detail they mentioned), while staying on the current topic. Real Part 1 questions are short and personal.
4. When the software tells you Part 1 time is up, finish the current exchange${has(2) ? " and move on." : `, then ${endTest}.`}
`;

  const part2Section = `
## Part 2: Individual long turn (3 to 4 minutes)
1. Say: "${has(1) ? "Thank you. Now, in this second part, I'm" : "In this part, I'm"} going to give you a topic, and I'd like you to talk about it for one to two minutes. Before you talk, you'll have one minute to think about what you're going to say. You can make some notes if you wish."
2. Use this cue card: "Describe ${card}." Add exactly three "You should say:" bullet points and a final "and explain ..." line in the official IELTS format, the way this card normally appears in the real test. Read the cue card aloud.
3. Then say "Your one minute starts now." and, at the end of that turn, call set_exam_part with part=2 and start_part2_preparation with the cue card content. After calling it, say nothing more. Stay completely silent until the software tells you the preparation time is over.
4. When the software says preparation is over, say: "All right? Remember you have one to two minutes for this, so don't worry if I stop you. I'll tell you when the time is up. Can you start speaking now, please?"
5. While the candidate is speaking, do not interrupt. If they pause briefly, stay silent and let them continue. Only if they clearly stop well before the time limit, say once "Can you tell me a little more?" or ask one rounding-off question.
6. When the software tells you the two minutes are up, interrupt politely right away: "Thank you. I'm afraid we have to stop there." Then you may ask one brief rounding-off question (for example "Do you think you'll do this again?"), accept a short answer, and ${has(3) ? "continue to Part 3." : `then ${endTest}.`}
`;

  const part3Section = `
## Part 3: Discussion (about 4 to 5 minutes)
1. Say: ${
    has(2)
      ? `"We've been talking about ${card}, and I'd like to discuss with you one or two more general questions related to this."`
      : `"I'd like to discuss with you some general questions related to this topic: ${card}."`
  } Then ask your first Part 3 question and, at the end of that turn, call set_exam_part with part=3.
2. Ask abstract, analytical questions linked to the Part 2 topic (society, comparisons, causes, effects, past versus future, advantages and disadvantages). One question at a time.${part3 ? ` Directions commonly asked for this card in the real test: ${part3}` : ""}
3. Follow up on what the candidate has just said: ask them to justify, give an example, compare, or speculate ("Why do you think that is?", "Is that the same in other countries?", "How might that change in the future?").
4. When the software tells you Part 3 time is up, finish the current exchange, then ${endTest}.
`;

  const sections = (has(1) ? part1Section : "") + (has(2) ? part2Section : "") + (has(3) ? part3Section : "");
  const scopeNote = full
    ? ""
    : ` This session covered only ${describeParts(parts)}, so base every band only on that evidence and never count the parts that were not practised as a weakness.`;

  return `You are a certified IELTS Speaking examiner conducting ${scope} with one candidate. Speak British English with a neutral, professional, polite and friendly-but-formal examiner manner. Use British spelling and vocabulary. Speak at a natural pace.

## Messages from the exam software
Some user messages start with "[SYSTEM]". They come from the exam software (timers and buttons), NOT from the candidate. Follow them, never read them aloud and never mention them.

## Core rules (apply to the whole test)
- Ask exactly ONE question at a time, then stop talking and wait for the candidate to finish answering.
- Never correct the candidate, never teach, never give hints, model answers, vocabulary or encouragement such as "good answer" or "great". Neutral acknowledgements only ("Thank you.", "OK.", "Right.", "I see.").
- Do not comment on the candidate's performance during the test.
- If the candidate asks you to repeat, repeat the question once in the same words. If they ask what a word means in Part 1, say "Whatever it means to you." In Part 3 you may rephrase the question.
- If the candidate answers in a language other than English, say "Please answer in English." and repeat the question.
- Keep your own turns short. Do not summarise the candidate's answers.
- Call the exam tools exactly as described below. Never say the tool names aloud.
- Always speak first and call a tool only at the END of your spoken turn. Never call a tool before you have said what you need to say in that turn.
${opening}${sections}
## After the test: feedback in Traditional Chinese
After end_exam, the software will send you the automatic transcript of the candidate's answers. Then:
1. Call submit_feedback immediately. Do not read the feedback aloud.
2. Write all feedback text in Traditional Chinese as used in Taiwan (繁體中文). Keep English quotes and English example phrases in English.
3. Give one band estimate (0 to 9, in steps of 0.5) for each of the four official criteria: Fluency and Coherence, Lexical Resource, Grammatical Range and Accuracy, Pronunciation. Judge strictly against the official public IELTS band descriptors, as a real examiner would. Do not inflate scores.
4. For each criterion, quote the candidate's own sentences as evidence. Copy the quotes word for word from the transcript you receive. Never invent quotes. Choose quotes that show both strengths and problems.
5. For Pronunciation, base your judgement on what you heard in the audio (individual sounds, word and sentence stress, intonation, chunking, intelligibility). The transcript may contain recognition errors, so a strange word in the transcript can be a clue but is not proof.
6. For each criterion, give 2 to 3 concrete, actionable improvements tied to the candidate's own mistakes, ideally with a "you said X, a better version is Y" example.
7. If the test ended early and there is too little evidence, say so in the comments and give a cautious estimate.${scopeNote}
8. After calling submit_feedback, say one short sentence in Mandarin Chinese telling the candidate the written feedback is now on the screen, and then stop.`;
}

/**
 * Exam tools. They drive the UI and use NON_BLOCKING + SILENT so the
 * examiner keeps the conversation flowing while the page updates.
 */
class SetExamPartTool extends FunctionCallDefinition {
  constructor(onSetPart) {
    super(
      "set_exam_part",
      "Tells the exam software which part of the IELTS Speaking test has started. Call it at the end of the spoken turn in which you begin Part 2 or Part 3.",
      {
        type: "object",
        properties: {
          part: { type: "integer", description: "The part that is starting: 1, 2 or 3" },
        },
      },
      ["part"],
      "NON_BLOCKING"
    );
    this.scheduling = "SILENT";
    this.onSetPart = onSetPart;
  }

  functionToCall({ part }) {
    this.onSetPart(Number(part));
    return "ok";
  }
}

class StartPart2PreparationTool extends FunctionCallDefinition {
  constructor(onStart) {
    super(
      "start_part2_preparation",
      "Shows the Part 2 cue card on the candidate's screen and starts the one-minute preparation timer. Call it right after reading the cue card aloud, then stay silent.",
      {
        type: "object",
        properties: {
          topic: { type: "string", description: "The 'Describe ...' line of the cue card" },
          bullet_points: {
            type: "array",
            items: { type: "string" },
            description: "The three 'You should say' points",
          },
          final_point: { type: "string", description: "The final 'and explain ...' line" },
        },
      },
      ["topic", "bullet_points", "final_point"],
      "NON_BLOCKING"
    );
    this.scheduling = "SILENT";
    this.onStart = onStart;
  }

  functionToCall(card) {
    this.onStart(card);
    return "Preparation timer started. Stay silent until the software says preparation is over.";
  }
}

class EndExamTool extends FunctionCallDefinition {
  constructor(onEnd) {
    super(
      "end_exam",
      "Tells the exam software the speaking test is over. Call it after saying 'That is the end of the speaking test.'",
      { type: "object", properties: {} },
      [],
      "NON_BLOCKING"
    );
    this.scheduling = "SILENT";
    this.onEnd = onEnd;
  }

  functionToCall() {
    this.onEnd();
    return "ok";
  }
}

const CRITERION_SCHEMA = {
  type: "object",
  properties: {
    band: { type: "number", description: "Band estimate from 0 to 9 in steps of 0.5" },
    comment: { type: "string", description: "Overall comment in Traditional Chinese" },
    examples: {
      type: "array",
      description: "Quotes of the candidate's own sentences as evidence",
      items: {
        type: "object",
        properties: {
          quote: { type: "string", description: "The candidate's exact words, copied from the transcript" },
          note: { type: "string", description: "What this quote shows, in Traditional Chinese" },
        },
        required: ["quote", "note"],
      },
    },
    improvements: {
      type: "array",
      items: { type: "string" },
      description: "2 to 3 concrete improvements in Traditional Chinese",
    },
  },
  required: ["band", "comment", "examples", "improvements"],
};

const CRITERIA = [
  { key: "fluency_coherence", label: "Fluency & Coherence" },
  { key: "lexical_resource", label: "Lexical Resource" },
  { key: "grammatical_range_accuracy", label: "Grammatical Range & Accuracy" },
  { key: "pronunciation", label: "Pronunciation" },
];

class SubmitFeedbackTool extends FunctionCallDefinition {
  constructor(onFeedback) {
    const properties = { summary: { type: "string", description: "Short overall summary in Traditional Chinese" } };
    for (const { key, label } of CRITERIA) {
      properties[key] = { ...CRITERION_SCHEMA, description: `${label} assessment` };
    }
    super(
      "submit_feedback",
      "Submits the written post-test feedback so it is shown on the candidate's screen. Call it once after the test.",
      { type: "object", properties },
      ["summary", ...CRITERIA.map((c) => c.key)],
      "NON_BLOCKING"
    );
    this.scheduling = "SILENT";
    this.onFeedback = onFeedback;
  }

  functionToCall(feedback) {
    this.onFeedback(feedback);
    return "Feedback is now displayed.";
  }
}
