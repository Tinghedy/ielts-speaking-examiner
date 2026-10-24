# IELTS 口說模擬考

一位會開口說話的 AI 雅思考官。用語音跟你完整考一次 IELTS Speaking，考完給你中文回饋、可以背的單字，還有家教逐題批改。

👉 **馬上開始：<https://tinghedy.github.io/ielts-speaking-examiner/>**

---

## 第一部分：給想練英文的你

不需要會寫程式，照著下面做就能用。

### 這個網站可以幫你做什麼

- **真人感的模擬考**：AI 考官用英國腔跟你對話，流程照真正的 IELTS 口說考試走（Part 1 問答 → Part 2 題卡長答 → Part 3 延伸討論）。
- **想練哪段就練哪段**：可以考完整一輪，也可以只練 Part 1、Part 2、Part 3，或 Part 2 + 3。
- **題目跟著考季走**：題庫來自本季考生回報的題目，最近考過的話題會盡量避開。
- **考完立刻有回饋**：依官方四項評分標準估分，並引用你自己說過的句子，告訴你怎麼改。
- **幫你整理要背的單字**：搜尋過去的考題和別人整理好的詞彙庫，列出這次話題值得背的單字和片語，還會挑出你說錯的字並附上正確說法。
- **AI 家教逐題批改**：檢查每一題的答題結構，修正錯誤、升級用字，改寫一個更高分的版本，最後出練習題給你。你可以直接回覆家教，讓它再批改一次。

### 開始之前，你需要準備

1. **一台電腦或手機**，建議用 Chrome 瀏覽器。
2. **耳機（最好有麥克風）**。不戴耳機的話，考官的聲音可能會被麥克風收進去，干擾對話。
3. **一把 Gemini API key**。這是讓網站能使用 Google AI 的「通行證」，免費就能申請。

### 第一次使用：三個步驟

**步驟 1：申請 Gemini API key（免費）**

1. 打開 <https://aistudio.google.com/apikey>，用 Google 帳號登入。
2. 按「Create API key（建立 API 金鑰）」。
3. 複製產生的那一串英文數字。

**步驟 2：把 key 存進網站**

1. 打開[網站](https://tinghedy.github.io/ielts-speaking-examiner/)，點左邊的「設定」。
2. 把 key 貼到「Gemini API key」欄位，按「儲存」。
3. 看到「已儲存在這台裝置」就完成了。之後用同一台裝置、同一個瀏覽器開網站，就不用再輸入。

> 🔒 key 只會存在你自己的瀏覽器裡，不會上傳到任何其他地方。請不要把 key 分享給別人。

**步驟 3：開始考試**

1. 在左上角的「練習範圍」選擇要練的部分。
2. 按「開始考試」，瀏覽器詢問時選擇「允許使用麥克風」。
3. 考官會先開口，接著就像真正的考試一樣回答就好。

### 考試中會發生什麼事

- **Part 1**：考官先問你的名字，再問 2–3 個日常話題，大約 4–5 分鐘。
- **Part 2**：畫面上會出現題卡，有 **1 分鐘準備時間**，這段時間麥克風會暫停，你可以拿紙筆做筆記。時間到後說 1–2 分鐘，左邊的計時器會倒數，2 分鐘一到考官會打斷你，跟真正的考試一樣。
- **Part 3**：針對 Part 2 的主題延伸討論比較抽象的問題，大約 4–5 分鐘。
- 想提早結束，按「結束考試」就會直接進入回饋。

**提示詞彙（可選）**：逐字稿右上角有一個「提示詞彙」開關。打開後，考官每問一題，畫面上就會出現跟題目相關的片語、單字和一句開頭句，適合「聽得懂、但說的時候想不起來用」的時候。考官本身不會用說的給提示。想模擬真實考試，就把它關掉。

### 考完你會得到

| 區塊 | 內容 |
| --- | --- |
| **考後回饋** | 四項評分（流暢度、詞彙、文法、發音）的分數估計、你說過的句子，以及具體改法 |
| **背誦清單：主題單字** | 這次話題值得背的單字和片語，附中文、例句、過去考過的題目和資料來源 |
| **背誦清單：我說錯的詞** | ~~錯的說法~~ → **正確說法**，加上一句中文解釋 |
| **家教複習** | 按下「家教複習（逐題批改）」，AI 家教會逐題批改，最後附片語表和練習題。可以在下方直接回覆家教 |

另外還有：

- **下載逐字稿與回饋（.md）**：把整次的逐字稿、回饋、單字和家教批改存成一個檔案。
- **Copy 我所有的對話**：一鍵複製你和考官的完整對話，方便貼到其他地方。
- **家教複習紀錄**：左側欄會保存你過去的家教批改，點開就能重看，也能接著回覆家教，就像打開舊的聊天室。

### 練習小建議

- 每次練完先看「我說錯的詞」，這些是你**真的會犯**的錯，最值得優先改。
- 「主題單字」不用一次全背，挑 3–5 個你下次真的會用的就好。
- 照家教最後出的練習，用新片語重新回答一次，再讓家教批改，效果最好。
- 同一個 Part 可以多練幾次，題目會自動換新。

### 常見問題

**Q：要付錢嗎？**
網站本身免費。Gemini API 有免費額度，一般練習通常夠用。如果練得很頻繁，可能會遇到額度上限（見下一題）。

**Q：出現「額度用完了（429）」怎麼辦？**
免費方案每分鐘、每天都有使用上限。等一兩分鐘再按「重試」；如果是當天的額度用完，就隔天再練。想要更多額度，可以到 [Google AI Studio](https://aistudio.google.com) 設定帳單。

**Q：考官突然不說話了？**
偶爾會發生。網站會在你說完 7 秒後自動提醒考官繼續，逐字稿會出現「已提醒考官繼續」。如果還是沒反應，按「結束考試」再重新開始。

**Q：分數準嗎？**
分數是 AI 依照官方公開的評分標準做的估計，適合用來看自己的進步方向，**不能代表真正的考試成績**。

**Q：我的練習紀錄存在哪裡？**
API key、家教複習紀錄和你的設定，都只存在**這台裝置的這個瀏覽器**。換電腦、換瀏覽器、用無痕模式，或清除瀏覽器資料後就看不到了。想長期保存的話，記得按「下載」。

**Q：可以用手機嗎？**
可以。用手機瀏覽器打開網站後，選「加入主畫面」，就能像 App 一樣使用。記得戴耳機。

**Q：逐字稿有錯字？**
逐字稿是語音辨識自動產生的，可能聽錯。回饋和家教都會考慮這點，不會把明顯的辨識錯誤算成你的錯。

---

## 第二部分：給開發者

### 技術概要

- 純靜態網站：HTML + CSS + 原生 JavaScript，**不需要打包或建置**。
- 考官對話使用 **Gemini Live API**（WebSocket 即時語音）；提示詞彙、背誦清單和家教複習使用一般的 `generateContent` / `streamGenerateContent`。
- 所有請求都直接從瀏覽器送出，使用者自己的 API key 存在 `localStorage`。
- 部署在 GitHub Pages（`main` 分支根目錄）。

### 在本機執行

```bash
git clone https://github.com/Tinghedy/ielts-speaking-examiner.git
cd ielts-speaking-examiner
python3 -m http.server 8000
```

接著打開 <http://localhost:8000>，在「設定」填入 API key。

> 麥克風只能在 `localhost` 或 HTTPS 下使用，直接用 `file://` 開啟 `index.html` 會無法收音。

### 檔案結構

| 檔案 | 用途 |
| --- | --- |
| `index.html` | 頁面結構 |
| `style.css` | 樣式（含深色模式與手機版面） |
| `app.js` | 主流程：考試狀態、計時、逐字稿、回饋、提示詞彙、背誦清單、家教複習與紀錄、Markdown 匯出 |
| `examiner.js` | 考官的 system instruction（依練習範圍組合）、抽題邏輯，以及 Live API 的工具定義 |
| `question-bank.js` | 本季題庫：Part 1 話題、Part 2 題卡、Part 3 討論方向 |
| `geminilive.js` | Gemini Live API 的 WebSocket 用戶端 |
| `mediaUtils.js` | 麥克風擷取（16 kHz PCM）、考官語音播放，以及防回音的收音閘門 |
| `audio-processors/` | 上述音訊處理用的 AudioWorklet |
| `hints.js` | 提示詞彙，以及共用的 `generateContent()`、`withTimeout()`、`apiError()` |
| `study.js` | 背誦清單：主題單字（Google Search grounding）與錯誤修正 |
| `tutor.js` | 家教複習的 prompt 與串流請求 |
| `manifest.webmanifest`、`icons/` | PWA（加入主畫面）設定 |

### 使用的模型

| 用途 | 常數 | 目前的值 |
| --- | --- | --- |
| 考官（即時語音） | `MODEL`（`app.js`） | `gemini-3.8-live` |
| 提示詞彙 | `HINT_MODEL`（`hints.js`） | `gemini-3.5-flash-lite` |
| 背誦清單 | `STUDY_MODEL`（`study.js`） | 同 `HINT_MODEL` |
| 家教複習 | `TUTOR_MODEL`（`tutor.js`） | 同 `HINT_MODEL` |

換模型只要改對應的常數。

### 運作方式

**考試流程**

- 考官的行為完全由 `examiner.js` 的 system instruction 決定，`buildSystemInstruction(selection, parts)` 只放入選到的 Part，並依第一段和最後一段調整開場與結束方式。
- 考官透過四個工具驅動畫面：`set_exam_part`、`start_part2_preparation`、`end_exam`、`submit_feedback`。都設為 `NON_BLOCKING` + `SILENT`，對話不會因此中斷。
- 計時由瀏覽器負責（`tick()` 每 250 ms 一次）。時間到時，用 `[SYSTEM]` 開頭的文字訊息通知考官，例如「Part 1 時間到」或「準備時間結束」。
- 考官說話時，麥克風改送靜音，避免喇叭的聲音被收回去；Part 2 準備時間則完全靜音。
- 如果考生說完 7 秒後考官都沒有回應，會自動送一次提醒（`checkExaminerSilence()`）。
- 連線中斷時會用 session resumption 自動續接，最多 3 次。

**考後**

- 回饋由 Live 考官透過 `submit_feedback` 工具回傳，所以它聽得到錄音、能評估發音。
- 背誦清單在考試結束時自動產生：主題單字用 Google Search grounding 搜尋，額度不足（400 / 403 / 429）時會改用不搜尋的方式重試；錯誤修正則使用 JSON schema 輸出。
- 家教複習要使用者按按鈕才開始，以 SSE 串流顯示，畫面用 [marked](https://marked.js.org/) 12.0.2 轉換 Markdown，再用 [DOMPurify](https://github.com/cure53/DOMPurify) 3.1.6 過濾（都從 cdnjs 載入，載入失敗時改顯示純文字）。

### 瀏覽器儲存（localStorage）

| Key | 內容 |
| --- | --- |
| `ielts-examiner.gemini-api-key` | 使用者的 API key |
| `ielts-examiner.recent-topics` | 最近用過的話題（抽題時避開） |
| `ielts-examiner.practice-mode` | 上次選的練習範圍 |
| `ielts-examiner.hints-on` | 提示詞彙開關 |
| `ielts-examiner.tutor-history` | 家教複習紀錄，最多 30 筆 |

### 更新題庫

IELTS 口說題庫每年 1 月、5 月、9 月換季。換季時更新 `question-bank.js`：

- `QUESTION_BANK_LABEL`：考季名稱
- `PART1_OPENERS`、`PART1_TOPICS`：Part 1 話題與範例題
- `PART2_CARDS`：Part 2 題卡（`part3` 對應 `PART3_DIRECTIONS` 的 key）
- `isNew: true` 標記本季新題，抽中機率是舊題的兩倍

### 臨時憑證模式（`server.py`）

程式支援另一種不需要在瀏覽器存 key 的方式：若沒有存 API key，會向同網域的 `POST api/token` 要一組臨時憑證，只能用來連考官的 Live API。對應的 `server.py` **不在這個 repo 裡**。這個模式下，提示詞彙、背誦清單和家教複習仍需要 API key。

### 分支與部署

- `develop`：開發中的版本。
- `main`：正式版，push 後 GitHub Pages 會自動部署到 <https://tinghedy.github.io/ielts-speaking-examiner/>。

開發流程：在 `develop` 上修改、測試，確認沒問題後合併到 `main`。
