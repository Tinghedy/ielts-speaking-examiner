/**
 * Tutor review ("家教複習") after the test.
 * Sends the tutor prompt plus the transcript to a text model and streams back
 * a question-by-question review in Markdown. The candidate can then reply
 * (e.g. re-answer a question with the new phrases) and the tutor marks it
 * again, as a normal multi-turn conversation.
 * Needs the Gemini API key saved in Settings.
 */

const TUTOR_MODEL = HINT_MODEL;
const TUTOR_TIMEOUT_MS = 240000; // the full review is long

const TUTOR_PROMPT = `你是一位經驗豐富的雅思口說家教。我是來自台灣的學生，看得懂很多單字和片語，但說話時常常想不起來用，習慣用最簡單的說法。

我會貼上一次模擬考的逐字稿（由語音辨識產生，可能有辨識錯誤）。請逐題審視我的回答。

## 每一題請這樣回饋

1. 題目：考官的問題
2. 我的回答：逐字引用，不要修改
3. 結構
   - Part 1、Part 3：檢查是否符合 OREC（Opinion → Reason → Example → Conclusion），缺哪一步就指出。也檢查我有沒有先直接回答問題（例如先說 Yes / No），以及有沒有改寫題目當開頭。
   - Part 2：檢查有沒有涵蓋題卡的每一點、有沒有開場句（例如 Let me tell you about…）和結尾。用字數估計長度（約 130 字 ≈ 1 分鐘），不到 1 分鐘要明確指出。
4. 錯誤修正：只挑真正的錯誤（文法、搭配詞、中式英文、意思和我想表達的不同）。格式：
   ❌ 我說的 → ✅ 更好的說法 ｜ 原因（一句中文）
   中式英文要標明。沒有錯就寫「無」，不要硬挑。
5. 詞彙升級：找出 2–4 個我用了太簡單說法的地方，給自然的升級片語：
   我說的 → 升級說法（中文意思）
   片語要完整附上介系詞（例如 devote time to something），是流利的人真的會說的、約 band 7 的程度，不要冷僻或過時的俚語。
6. 改寫示範：保留我原本的想法和真實細節，不要幫我編新的經歷。把回答改寫成約高一個 band 的版本，改動處用粗體標示。Part 1 約 3–4 句，Part 3 約 4–6 句。

## 所有題目之後

- 最常出現的 3 個問題：依對分數的影響排序，每個附上我自己的一個例子。
- 本次片語清單：把所有升級片語整理成表格：片語｜中文｜例句（用我自己的情況造句）。
- 練習：
  1. 用本次片語出 5 題填空題，句子和我的生活相關，答案放在最後。
  2. 挑 2 題我答得最弱的，請我用新片語重新回答。我回答後，用同樣的方式再批改一次。

## 規則

- 說明用繁體中文（台灣用語），英文片語和例句保持英文。
- 直接、具體，不要空泛稱讚。做得好的地方可以點出來，但要說清楚好在哪裡。
- 只根據逐字稿判斷，逐字稿無法判斷發音。如果某個字看起來像辨識錯誤（例如句意不通），標註「可能是辨識錯誤」並推測我原本想說的字，不要算成我的錯誤。
- 每題的修正和升級以影響最大的為主，不要一次改太多。

以下是逐字稿：`;

/**
 * The first message: the prompt, the Part 2 cue card if there was one, then the transcript.
 * @param {string} transcript Examiner and candidate lines, as sent for feedback
 * @param {{topic:string, bullet_points?:string[], final_point?:string}|null} card
 */
function buildTutorOpening(transcript, card) {
  const parts = [TUTOR_PROMPT];
  if (card && card.topic) {
    const bullets = (card.bullet_points || []).map((b) => `- ${b}`).join("\n");
    parts.push(`（Part 2 題卡：${card.topic}\nYou should say:\n${bullets}\n${card.final_point || ""}）`.trim());
  }
  parts.push(transcript);
  return parts.join("\n\n");
}

/**
 * Stream one tutor reply. `turns` is the whole conversation so far:
 * [{ role: "user" | "model", text }]. Calls onText with the text received so far.
 */
async function streamTutor(turns, apiKey, { signal, onText }) {
  return withTimeout(signal, TUTOR_TIMEOUT_MS, async (combined) => {
    const response = await fetch(`${GEMINI_API}/${TUTOR_MODEL}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: combined,
      body: JSON.stringify({
        contents: turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
        generationConfig: { temperature: 0.4 },
      }),
    });
    if (!response.ok) throw await apiError(response);

    // Server-sent events: one "data: {json}" line per chunk
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = done ? "" : lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const chunk = JSON.parse(line.slice(5));
        if (chunk.error) throw new Error(chunk.error.message || "串流中斷");
        const parts = chunk.candidates?.[0]?.content?.parts || [];
        const piece = parts.filter((p) => !p.thought).map((p) => p.text || "").join("");
        if (piece) {
          text += piece;
          onText(text);
        }
      }
      if (done) break;
    }
    if (!text) throw new Error("模型沒有回傳內容");
    return text;
  });
}
