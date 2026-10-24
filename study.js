/**
 * Study list after the test, in two parts:
 * 1. Topic vocabulary to memorise. The model uses Google Search grounding to
 *    look up past IELTS questions on this session's topics and vocabulary lists
 *    other people have published, and combines them with today's questions.
 * 2. Corrections: the words the candidate got wrong, fixed.
 * Both are normal generateContent calls (see generateContent in hints.js) and
 * need the Gemini API key saved in Settings.
 */

const STUDY_MODEL = HINT_MODEL;
const STUDY_TIMEOUT_MS = 90000; // searching takes a while

// How many vocabulary items to ask for per topic
const VOCAB_COUNTS = { 1: 8, 2: 15, 3: 15 };

const VOCAB_INSTRUCTION = `You build a vocabulary study list for an IELTS Speaking candidate from Taiwan who has just finished a practice test. They will memorise this list, so every item must be worth learning and genuinely useful for answering questions on these topics.

Use Google Search to look up:
1. Past IELTS Speaking questions on each topic from previous seasons (for example question banks and candidate reports on ieltsliz.com, ielts-simon.com, ieltsactualtests.com, ieltsmentor.com, ielts.org or similar).
2. Vocabulary lists, collocations and model-answer phrases that IELTS teachers and learners have published for these topics.

Then combine what you found with the questions the examiner asked today.

Rules:
- Natural spoken British English at about band 7. Prefer collocations, phrasal verbs and useful chunks over rare single words. No obscure or old-fashioned idioms.
- Give each phrase with any preposition it needs (e.g. "devote time to something").
- Example sentences are first person, natural, under 15 words, and answer a real question on the topic.
- Chinese meanings are short and in Traditional Chinese as used in Taiwan.
- No duplicates across topics.
- past_questions: 3 to 5 real past questions on the topic that you found, worded as the examiner would ask them.

Reply with JSON only, no other text, in exactly this shape:
{"topics":[{"part":1,"topic":"...","past_questions":["..."],"items":[{"en":"...","zh":"...","kind":"word|phrase|idiom","example":"..."}]}]}`;

const VOCAB_SCHEMA = {
  type: "OBJECT",
  properties: {
    topics: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          part: { type: "INTEGER" },
          topic: { type: "STRING" },
          past_questions: { type: "ARRAY", items: { type: "STRING" } },
          items: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                en: { type: "STRING" },
                zh: { type: "STRING", description: "Short meaning in Traditional Chinese (Taiwan)" },
                kind: { type: "STRING", enum: ["word", "phrase", "idiom"] },
                example: { type: "STRING" },
              },
              required: ["en", "zh", "kind", "example"],
            },
          },
        },
        required: ["part", "topic", "past_questions", "items"],
      },
    },
  },
  required: ["topics"],
};

const FIX_KINDS = {
  word_choice: "用字",
  collocation: "搭配",
  grammar: "文法",
  word_form: "詞性",
  chinglish: "中式英文",
};

const FIX_INSTRUCTION = `You check the English of an IELTS Speaking candidate from Taiwan. You get the speech-recognition transcript of their practice test. List the words and phrases they got wrong, with the correct version, so they can memorise the corrections.

Rules:
- Only real mistakes: wrong word choice, wrong collocation, grammar errors, wrong word form, and Chinese-influenced expressions a fluent speaker would not say. Do not list things that are merely plain but correct.
- The transcript comes from speech recognition. Skip anything that is probably a recognition error rather than the candidate's mistake (odd words that sound like a correct word, missing punctuation, capitals). Ignore fillers, repetitions and self-corrections.
- original: copy the candidate's words exactly from the transcript, just enough of the sentence to show the mistake (under 20 words).
- corrected: the same part of the sentence, fixed, changing as little as possible.
- wrong / right: only the specific word or phrase that was wrong, and what to say instead.
- explanation: one short sentence in Traditional Chinese as used in Taiwan, explaining why.
- If the same mistake appears several times, list it once.
- At most 15 items, the most important first. If there are no real mistakes, return an empty list.`;

const FIX_SCHEMA = {
  type: "OBJECT",
  properties: {
    corrections: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          original: { type: "STRING" },
          corrected: { type: "STRING" },
          wrong: { type: "STRING" },
          right: { type: "STRING" },
          kind: { type: "STRING", enum: Object.keys(FIX_KINDS) },
          explanation: { type: "STRING" },
        },
        required: ["original", "corrected", "wrong", "right", "kind", "explanation"],
      },
    },
  },
  required: ["corrections"],
};

const textOf = (v) => String(v || "").trim();
const listOf = (v) => (Array.isArray(v) ? v : []);

// The search tool can't be combined with a response schema, so pull the JSON out of the text
function parseJsonReply(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("模型回傳的格式不對");
  return JSON.parse(text.slice(start, end + 1));
}

function buildVocabPrompt({ topics, asked }) {
  const lines = ["Topics in today's practice test:"];
  for (const t of topics) {
    lines.push(`- Part ${t.part}: ${t.name}${t.samples?.length ? ` (typical questions: ${t.samples.join(" / ")})` : ""}`);
    lines.push(`  Give ${VOCAB_COUNTS[t.part] || 10} items for this topic.`);
  }
  for (const [part, questions] of Object.entries(asked)) {
    if (questions.length) lines.push("", `Questions the examiner asked in Part ${part} today:`, ...questions.map((q) => `- ${q}`));
  }
  return lines.join("\n");
}

function cleanVocab(raw) {
  return listOf(raw.topics)
    .map((t) => ({
      part: Number(t.part) || null,
      topic: textOf(t.topic),
      pastQuestions: listOf(t.past_questions).map(textOf).filter(Boolean),
      items: listOf(t.items)
        .map((i) => ({ en: textOf(i.en), zh: textOf(i.zh), kind: textOf(i.kind), example: textOf(i.example) }))
        .filter((i) => i.en),
    }))
    .filter((t) => t.items.length);
}

// Web pages the answer was grounded on, plus Google's required search suggestions
function groundingOf(candidate) {
  const meta = candidate.groundingMetadata || {};
  const seen = new Set();
  const sources = [];
  for (const chunk of listOf(meta.groundingChunks)) {
    const uri = chunk.web?.uri;
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    sources.push({ uri, title: textOf(chunk.web.title) || uri });
  }
  return { sources, searchHtml: meta.searchEntryPoint?.renderedContent || "" };
}

/**
 * Topic vocabulary, looked up with Google Search.
 * @param {{topics:{part:number,name:string,samples?:string[]}[], asked:Object<number,string[]>}} request
 * @returns {Promise<{topics:object[], sources:object[], searchHtml:string, searched:boolean}>}
 */
async function fetchStudyVocab(request, apiKey, signal) {
  const contents = [{ role: "user", parts: [{ text: buildVocabPrompt(request) }] }];
  const systemInstruction = { parts: [{ text: VOCAB_INSTRUCTION }] };
  const options = { signal, timeoutMs: STUDY_TIMEOUT_MS };

  try {
    const { text, candidate } = await generateContent(
      STUDY_MODEL,
      { systemInstruction, contents, tools: [{ google_search: {} }], generationConfig: { temperature: 0.4 } },
      apiKey,
      options
    );
    return { topics: cleanVocab(parseJsonReply(text)), ...groundingOf(candidate), searched: true };
  } catch (error) {
    // Model or key without search access: still give a list from the model's own knowledge
    if (error.status !== 400 && error.status !== 403) throw error;
    console.warn("Search grounding unavailable, retrying without it:", error);
    const { text } = await generateContent(
      STUDY_MODEL,
      {
        systemInstruction,
        contents,
        generationConfig: { temperature: 0.4, responseMimeType: "application/json", responseSchema: VOCAB_SCHEMA },
      },
      apiKey,
      options
    );
    return { topics: cleanVocab(JSON.parse(text)), sources: [], searchHtml: "", searched: false };
  }
}

/**
 * Corrections of the candidate's mistakes.
 * @param {string} transcript Examiner and candidate lines, as sent for feedback
 */
async function fetchStudyFixes(transcript, apiKey, signal) {
  const { text } = await generateContent(
    STUDY_MODEL,
    {
      systemInstruction: { parts: [{ text: FIX_INSTRUCTION }] },
      contents: [{ role: "user", parts: [{ text: `Transcript of the practice test:\n\n${transcript}` }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: FIX_SCHEMA },
    },
    apiKey,
    { signal, timeoutMs: STUDY_TIMEOUT_MS }
  );
  return listOf(JSON.parse(text).corrections)
    .map((c) => ({
      original: textOf(c.original),
      corrected: textOf(c.corrected),
      wrong: textOf(c.wrong),
      right: textOf(c.right),
      kind: FIX_KINDS[c.kind] ? c.kind : "word_choice",
      explanation: textOf(c.explanation),
    }))
    .filter((c) => c.wrong && c.right);
}
