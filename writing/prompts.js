/**
 * IELTS Writing Task 2: question types, paragraph tasks and the prompt bank.
 * Each type lists what each of the four paragraphs should do. The site only
 * gives the task; the learner decides the position, reasons and examples.
 */

const SECTIONS = [
  { key: "intro", name: "開頭", label: "Intro" },
  { key: "body1", name: "主體一", label: "Body 1" },
  { key: "body2", name: "主體二", label: "Body 2" },
  { key: "conclusion", name: "結尾", label: "Conclusion" },
];

const WRITING_TYPES = {
  opinion: {
    label: "Opinion",
    hint: "To what extent do you agree or disagree?",
    tasks: {
      intro: "改寫題目，並寫出明確立場（同意／部分同意／不同意）",
      body1: "主題句（理由一）→ 解釋 → 具體例子",
      body2: "主題句（理由二，或先讓步再反駁）→ 解釋 → 例子",
      conclusion: "重申立場，用一句話收攏兩個理由",
    },
  },
  discuss: {
    label: "Discuss both views",
    hint: "Discuss both views and give your own opinion.",
    tasks: {
      intro: "改寫題目，說明會討論兩方，並帶出自己的看法",
      body1: "A 方觀點 → 解釋 → 例子",
      body2: "B 方觀點 → 解釋 → 例子（通常放自己支持的一方）",
      conclusion: "總結兩方，明確說出自己的立場",
    },
  },
  "adv-disadv": {
    label: "Advantages / Disadvantages",
    hint: "Do the advantages outweigh the disadvantages?",
    tasks: {
      intro: "改寫題目，若題目有問，就要表態優點是否大於缺點",
      body1: "優點 → 解釋 → 例子",
      body2: "缺點 → 解釋 → 例子",
      conclusion: "總結並回答「是否利大於弊」",
    },
  },
  "problem-solution": {
    label: "Problem / Solution",
    hint: "What are the causes, and what solutions can be suggested?",
    tasks: {
      intro: "改寫題目，預告會談原因與解法",
      body1: "主要原因或問題 → 解釋 → 例子",
      body2: "對應的解法 → 為什麼有效 → 例子",
      conclusion: "總結問題與解法",
    },
  },
  "two-part": {
    label: "Two-part question",
    hint: "Two direct questions to answer.",
    tasks: {
      intro: "改寫題目，簡短回答兩個問題",
      body1: "回答第一題 → 解釋 → 例子",
      body2: "回答第二題 → 解釋 → 例子",
      conclusion: "總結兩個答案",
    },
  },
};

const WRITING_PROMPTS = [
  {
    id: "q1",
    type: "opinion",
    prompt:
      "Some people believe that university students should be required to take courses outside their main field of study. To what extent do you agree or disagree?",
  },
  {
    id: "q2",
    type: "discuss",
    prompt:
      "Some people think older adults should learn to use digital technology, while others believe it is unnecessary at their stage of life. Discuss both views and give your own opinion.",
  },
  {
    id: "q3",
    type: "adv-disadv",
    prompt:
      "More and more people are working from home rather than in an office. Do the advantages of this trend outweigh the disadvantages?",
  },
  {
    id: "q4",
    type: "problem-solution",
    prompt:
      "In many cities, young people find it increasingly difficult to afford housing. What are the causes of this problem, and what solutions can be suggested?",
  },
  {
    id: "q5",
    type: "two-part",
    prompt:
      "Many people now get their news mainly from social media. Why is this happening? Is this a positive or negative development?",
  },
];
