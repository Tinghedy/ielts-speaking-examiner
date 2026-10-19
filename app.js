/**
 * IELTS Speaking mock examiner - application workflow.
 * Handles the exam flow, timers, live transcript, feedback and Markdown export.
 */

const MODEL = "gemini-3.8-live";

const TIMING = {
  part1WrapUpSec: 270, // ask the examiner to move on after ~4.5 minutes
  part3WrapUpSec: 270,
  prepSec: 60,
  speakMinSec: 60,
  speakMaxSec: 120,
  examinerReplyTimeoutSec: 15, // unmute the mic even if the examiner never finishes a turn
  feedbackTimeoutSec: 150,
  maxReconnects: 3,
};

// Keep the mic silenced this long after examiner audio ends (speaker echo / output latency)
const ECHO_TAIL_MS = 700;

const PHASE = {
  IDLE: "idle",
  CONNECTING: "connecting",
  EXAM: "exam",
  FEEDBACK: "feedback",
  DONE: "done",
};

const state = {
  phase: PHASE.IDLE,
  client: null,
  streamer: null,
  player: null,
  systemInstruction: "",
  examTopics: null,
  resumeHandle: null,
  reconnects: 0,
  isReconnecting: false,
  startedAt: null,
  endedAt: null,
  part: 0,
  partStartedAt: null,
  wrapUpSent: { 1: false, 3: false },
  part2: { stage: "none", card: null, endsAt: 0 }, // none | prep | waiting | speaking | done
  afterTurn: [], // callbacks run on the next examiner turnComplete
  feedbackRequestedAt: null,
  feedback: null,
  transcript: [], // { role: "examiner" | "candidate" | "system", text, part, open, el }
  tickTimer: null,
};

const $ = (id) => document.getElementById(id);

// ─── Small helpers ────────────────────────────────────────────────────────────

function formatClock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function secondsSince(timestamp) {
  return timestamp ? (Date.now() - timestamp) / 1000 : 0;
}

function showNotice(text, kind = "info") {
  const el = $("notice");
  el.textContent = text;
  el.dataset.kind = kind;
  el.hidden = !text;
}

function setStatus(text, kind) {
  const el = $("status");
  el.textContent = text;
  el.dataset.kind = kind;
}

function setMicMuted(muted) {
  if (state.streamer) state.streamer.setMuted(muted);
  renderMic();
}

// Run a callback after the examiner's next turn, with a timeout fallback
function afterExaminerTurn(callback) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    callback();
  };
  state.afterTurn.push(run);
  setTimeout(run, TIMING.examinerReplyTimeoutSec * 1000);
}

// Send a control message that the examiner should respond to
function sendControl(text) {
  if (state.client) state.client.sendTextMessage(`[SYSTEM] ${text}`);
}

// Add a control note to the context without triggering a response
function sendSilentNote(text) {
  if (state.client) state.client.sendClientContentMessage(`[SYSTEM] ${text}`, false);
}

// ─── Transcript ───────────────────────────────────────────────────────────────

const ROLE_LABEL = { examiner: "Examiner", candidate: "我", system: "系統" };

function closeOpenEntries() {
  state.transcript.forEach((entry) => (entry.open = false));
}

function addTranscript(role, text) {
  if (!text) return;
  const last = state.transcript[state.transcript.length - 1];

  if (role !== "system" && last && last.role === role && last.open) {
    last.text += text;
    last.el.querySelector(".text").textContent = last.text;
  } else {
    closeOpenEntries();
    const entry = { role, text, part: state.part, open: role !== "system", el: null };
    entry.el = document.createElement("div");
    entry.el.className = `line ${role}`;
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = ROLE_LABEL[role];
    const body = document.createElement("span");
    body.className = "text";
    body.textContent = text;
    entry.el.append(who, body);
    $("transcriptEmpty").hidden = true;
    $("transcript").appendChild(entry.el);
    state.transcript.push(entry);
  }

  const box = $("transcriptScroll");
  if (box.scrollHeight - box.scrollTop - box.clientHeight < 160) {
    box.scrollTop = box.scrollHeight;
  }
  renderButtons();
}

function transcriptAsText() {
  let currentPart = -1;
  const lines = [];
  for (const entry of state.transcript) {
    if (entry.role === "system") continue;
    if (entry.part !== currentPart) {
      currentPart = entry.part;
      lines.push(`\n--- Part ${currentPart || 1} ---`);
    }
    lines.push(`${entry.role === "examiner" ? "Examiner" : "Candidate"}: ${entry.text.trim()}`);
  }
  return lines.join("\n").trim();
}

// ─── Exam flow ────────────────────────────────────────────────────────────────

function setPart(part) {
  if (![1, 2, 3].includes(part) || part === state.part) return;
  state.part = part;
  state.partStartedAt = Date.now();
  if (part === 3 && state.part2.stage !== "none") stopPart2Timer();
  addTranscript("system", `進入 Part ${part}`);
  renderParts();
  renderButtons();
}

function startPart2Preparation(card) {
  if (state.phase !== PHASE.EXAM || ["prep", "waiting", "speaking"].includes(state.part2.stage)) return;
  setPart(2);
  state.part2 = { stage: "prep", card, endsAt: Date.now() + TIMING.prepSec * 1000 };
  setMicMuted(true);
  renderButtons();

  if (card && card.topic) {
    const bullets = (card.bullet_points || []).map((b) => `• ${b}`).join("\n");
    addTranscript("system", `題卡：${card.topic}\nYou should say:\n${bullets}\n${card.final_point || ""}`.trim());
  }
  addTranscript("system", "開始 1 分鐘準備（麥克風暫停收音）");
  renderCueCard();
}

function finishPreparation() {
  state.part2.stage = "waiting";
  addTranscript("system", "準備時間結束");
  sendControl("The one-minute preparation time is over. Ask the candidate to start speaking now.");
  afterExaminerTurn(() => {
    if (state.part2.stage !== "waiting") return;
    state.part2.stage = "speaking";
    state.part2.endsAt = Date.now() + TIMING.speakMaxSec * 1000;
    setMicMuted(false);
  });
}

function finishLongTurn() {
  state.part2.stage = "done";
  // If the examiner is already talking, the long turn has ended by itself
  if (state.player && state.player.isPlaying()) return;

  addTranscript("system", "作答時間 2 分鐘到");
  setMicMuted(true);
  sendControl("The candidate's two minutes are up. Interrupt them politely right now and continue as instructed.");
  afterExaminerTurn(() => {
    if (state.phase === PHASE.EXAM) setMicMuted(false);
  });
}

function stopPart2Timer() {
  if (state.part2.stage === "prep" || state.part2.stage === "waiting") setMicMuted(false);
  state.part2.stage = "done";
}

function requestFeedback(endedByUser) {
  if (state.phase !== PHASE.EXAM) return;
  state.phase = PHASE.FEEDBACK;
  state.endedAt = Date.now();
  state.feedbackRequestedAt = Date.now();
  stopPart2Timer();
  setMicMuted(true);
  closeOpenEntries();

  if (endedByUser && state.player) state.player.interrupt();
  addTranscript("system", endedByUser ? "考生按下結束，考試結束，產生回饋中…" : "考試結束，產生回饋中…");

  const send = (opening) =>
    sendControl(
      `${opening} Here is the automatic speech-recognition transcript of the test (it may contain recognition errors):\n\n` +
        `${transcriptAsText()}\n\nNow call submit_feedback as instructed. Do not read it aloud.`
    );
  if (endedByUser) {
    send("The candidate pressed the End button, so the test is over now. Do not ask any more questions.");
  } else {
    // Let the examiner finish its closing line first
    afterExaminerTurn(() => {
      if (state.phase === PHASE.FEEDBACK) send("The test is over.");
    });
  }
  render();
}

// Tolerate slightly malformed tool arguments (strings instead of arrays/objects)
function normalizeFeedback(raw) {
  const toList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  const feedback = { summary: String(raw.summary || "") };
  for (const { key } of CRITERIA) {
    const c = raw[key] || {};
    feedback[key] = {
      band: c.band,
      comment: String(c.comment || ""),
      examples: toList(c.examples).map((ex) =>
        typeof ex === "string" ? { quote: ex, note: "" } : { quote: String(ex.quote || ""), note: String(ex.note || "") }
      ),
      improvements: toList(c.improvements).map(String),
    };
  }
  return feedback;
}

function receiveFeedback(feedback) {
  if (state.feedback) return;
  state.feedback = normalizeFeedback(feedback || {});
  state.phase = PHASE.DONE;
  if (!state.endedAt) state.endedAt = Date.now();
  addTranscript("system", "回饋已產生");
  renderFeedback();
  render();
  // Let the examiner finish its closing sentence, then hang up
  afterExaminerTurn(() => stopSession());
}

// ─── API key (stored only in this browser) ────────────────────────────────────

const API_KEY_STORAGE = "ielts-examiner.gemini-api-key";

function loadApiKey() {
  try {
    return localStorage.getItem(API_KEY_STORAGE) || "";
  } catch {
    return "";
  }
}

function saveApiKey(key) {
  try {
    if (key) localStorage.setItem(API_KEY_STORAGE, key);
    else localStorage.removeItem(API_KEY_STORAGE);
    return true;
  } catch {
    return false;
  }
}

function renderApiKey() {
  const hasKey = Boolean(loadApiKey());
  $("apiKeyState").textContent = hasKey ? "已儲存在這台裝置" : "尚未設定";
  $("apiKeyState").dataset.kind = hasKey ? "on" : "off";
  $("clearKeyBtn").hidden = !hasKey;
}

function openSettings() {
  $("settings").open = true;
  $("apiKeyInput").focus();
}

// ─── Connection ───────────────────────────────────────────────────────────────

// With a saved API key the browser connects directly (static hosting).
// Otherwise ask the local server (server.py) for an ephemeral token.
async function getCredentials() {
  const apiKey = loadApiKey();
  if (apiKey) return { token: null, apiKey };

  let response;
  try {
    response = await fetch("api/token", { method: "POST" });
  } catch {
    response = null;
  }
  const body = response ? await response.json().catch(() => null) : null;
  if (!response || !body) {
    openSettings();
    throw new Error("請先在「設定」輸入 Gemini API key");
  }
  if (!response.ok) throw new Error(body.error || response.statusText);
  return { token: body.token, apiKey: null };
}

async function createClient(resumeHandle) {
  const { token, apiKey } = await getCredentials();
  const client = new GeminiLiveAPI(token, MODEL, apiKey);

  client.systemInstructions = state.systemInstruction;
  client.voiceName = $("voiceSelect").value;
  client.temperature = 0.8;
  client.inputAudioTranscription = true;
  client.outputAudioTranscription = true;
  client.automaticActivityDetection.silence_duration_ms = 1500; // give candidates time to think mid-answer
  client.sessionResumptionHandle = resumeHandle || "";
  client.contextWindowCompression = { slidingWindow: {} };

  client.addFunction(new SetExamPartTool(setPart));
  client.addFunction(new StartPart2PreparationTool(startPart2Preparation));
  client.addFunction(new EndExamTool(() => requestFeedback(false)));
  client.addFunction(new SubmitFeedbackTool(receiveFeedback));

  client.onReceiveResponse = (message) => handleMessage(client, message, Boolean(resumeHandle));
  client.onError = () => {};
  client.onOpen = () => {};
  client.onClose = () => handleClose(client);

  client.connect();
  return client;
}

async function startExam() {
  if (state.phase !== PHASE.IDLE && state.phase !== PHASE.DONE) return;
  resetExam();
  state.phase = PHASE.CONNECTING;
  render();
  showNotice("");

  try {
    // Audio contexts must be created synchronously in the click handler (iOS)
    state.player = new AudioPlayer();
    const playerReady = state.player.init();
    state.streamer = new AudioStreamer(null);
    state.streamer.setMuted(true);
    // Don't let the examiner's voice from a phone speaker reach the mic
    state.streamer.isOutputPlaying = () => Boolean(state.player && state.player.isPlaying(ECHO_TAIL_MS));
    state.streamer.prepare();

    await playerReady;
    state.player.setVolume($("volume").value / 100);
    await state.streamer.start($("micSelect").value || null);
    populateMics();

    state.examTopics = pickExamTopics();
    state.systemInstruction = buildSystemInstruction(state.examTopics);
    state.client = await createClient(null);
    state.streamer.client = state.client;
  } catch (error) {
    console.error("Failed to start:", error);
    showNotice(`無法開始：${error.message}`, "error");
    stopSession();
  }
}

function handleMessage(client, message, isResumed) {
  if (client !== state.client) return;

  switch (message.type) {
    case MultimodalLiveResponseType.SETUP_COMPLETE:
      if (isResumed) {
        state.isReconnecting = false;
        state.streamer.client = client;
        addTranscript("system", "（連線已自動續接）");
        if (state.phase === PHASE.EXAM && state.part2.stage !== "prep") setMicMuted(false);
      } else {
        state.phase = PHASE.EXAM;
        state.startedAt = Date.now();
        setMicMuted(false);
        kickOff(client, 1);
      }
      render();
      break;

    case MultimodalLiveResponseType.AUDIO:
      state.examinerAudioReceived = true;
      if (state.player) state.player.play(message.data);
      break;

    case MultimodalLiveResponseType.INPUT_TRANSCRIPTION:
      if (!message.data.finished) addTranscript("candidate", message.data.text);
      break;

    case MultimodalLiveResponseType.OUTPUT_TRANSCRIPTION:
      if (!message.data.finished) {
        if (state.part === 0 && state.phase === PHASE.EXAM) setPart(1);
        addTranscript("examiner", message.data.text);
      }
      break;

    case MultimodalLiveResponseType.TURN_COMPLETE: {
      const last = state.transcript[state.transcript.length - 1];
      if (last && last.role === "examiner") last.open = false;
      const callbacks = state.afterTurn;
      state.afterTurn = [];
      callbacks.forEach((cb) => cb());
      break;
    }

    case MultimodalLiveResponseType.INTERRUPTED:
      if (state.player) state.player.interrupt();
      break;

    case MultimodalLiveResponseType.TOOL_CALL:
      handleToolCall(client, message.data.functionCalls || []);
      break;

    case MultimodalLiveResponseType.SESSION_RESUMPTION_UPDATE:
      if (message.data.resumable && message.data.newHandle) {
        state.resumeHandle = message.data.newHandle;
      }
      break;

    case MultimodalLiveResponseType.GO_AWAY:
      reconnect();
      break;
  }
}

// Ask the examiner to start; retry once if it stays silent
function kickOff(client, attempt) {
  sendControl("The candidate is ready and can hear you. Start the test now.");
  setTimeout(() => {
    const examinerSpoke = state.examinerAudioReceived || state.transcript.some((e) => e.role === "examiner");
    if (client !== state.client || state.phase !== PHASE.EXAM || examinerSpoke) return;
    if (attempt < 2) {
      kickOff(client, attempt + 1);
    } else {
      showNotice("考官沒有回應，請按「結束考試」後再按「開始考試」重試。", "error");
    }
  }, 8000);
}

async function handleToolCall(client, functionCalls) {
  const functionResponses = await Promise.all(
    functionCalls.map(async ({ name, id, args }) => {
      const toolDef = client.functionsMap[name];
      let response;
      try {
        if (!toolDef) throw new Error(`Unknown tool ${name}`);
        const result = await client.callFunction(name, args || {});
        response = { result: result ?? "ok" };
      } catch (err) {
        console.error(`Tool ${name} failed:`, err);
        response = { error: err.message };
      }
      if (toolDef && toolDef.behavior === "NON_BLOCKING") {
        response.scheduling = toolDef.scheduling || "SILENT";
      }
      return { id, name, response };
    })
  );
  if (client === state.client) client.sendToolResponse(functionResponses);
}

function handleClose(client) {
  if (client !== state.client) return;
  if (state.phase === PHASE.EXAM || state.phase === PHASE.FEEDBACK) {
    reconnect();
  } else if (state.phase === PHASE.CONNECTING) {
    showNotice("無法連線到 Gemini Live API，請確認 API key 與網路。", "error");
    stopSession();
  }
}

async function reconnect() {
  if (state.isReconnecting) return;
  if (!state.resumeHandle || state.reconnects >= TIMING.maxReconnects) {
    showNotice("連線中斷，無法續接。逐字稿仍可下載。", "error");
    stopSession();
    return;
  }

  state.isReconnecting = true;
  state.reconnects += 1;
  renderStatus();
  const oldClient = state.client;
  state.client = null;
  if (oldClient) oldClient.disconnect();

  try {
    state.client = await createClient(state.resumeHandle);
  } catch (error) {
    console.error("Reconnect failed:", error);
    state.isReconnecting = false;
    showNotice(`重新連線失敗：${error.message}。逐字稿仍可下載。`, "error");
    stopSession();
  }
}

function stopSession() {
  const client = state.client;
  state.client = null;
  if (client) client.disconnect();

  if (state.streamer) {
    state.streamer.destroy();
    state.streamer = null;
  }
  if (state.player) {
    state.player.destroy();
    state.player = null;
  }

  state.afterTurn = [];
  state.isReconnecting = false;
  if (state.startedAt && !state.endedAt) state.endedAt = Date.now();
  if (state.phase !== PHASE.IDLE) state.phase = state.startedAt ? PHASE.DONE : PHASE.IDLE;
  render();
}

function resetExam() {
  Object.assign(state, {
    resumeHandle: null,
    reconnects: 0,
    isReconnecting: false,
    startedAt: null,
    endedAt: null,
    part: 0,
    partStartedAt: null,
    wrapUpSent: { 1: false, 3: false },
    part2: { stage: "none", card: null, endsAt: 0 },
    afterTurn: [],
    feedbackRequestedAt: null,
    feedback: null,
    transcript: [],
    examinerAudioReceived: false,
  });
  $("transcript").innerHTML = "";
  $("transcriptEmpty").hidden = false;
  $("feedback").hidden = true;
  $("feedbackBody").innerHTML = "";
  renderCueCard();
}

function onEndClick() {
  if (state.phase === PHASE.EXAM) {
    if (state.part === 0 && state.transcript.length === 0) {
      stopSession();
    } else {
      requestFeedback(true);
    }
  } else if (state.phase === PHASE.FEEDBACK || state.phase === PHASE.CONNECTING) {
    stopSession();
    showNotice("已中止，未取得回饋。逐字稿仍可下載。", "info");
  }
}

// ─── Periodic checks (timers) ─────────────────────────────────────────────────

function tick() {
  if (state.phase === PHASE.EXAM && !state.isReconnecting) {
    const partElapsed = secondsSince(state.partStartedAt);

    if (state.part === 1 && !state.wrapUpSent[1] && partElapsed >= TIMING.part1WrapUpSec) {
      state.wrapUpSent[1] = true;
      sendSilentNote("Part 1 has lasted about 4.5 minutes. After the candidate's current answer, move on to Part 2.");
    }
    if (state.part === 3 && !state.wrapUpSent[3] && partElapsed >= TIMING.part3WrapUpSec) {
      state.wrapUpSent[3] = true;
      sendSilentNote("Part 3 has lasted about 4.5 minutes. After the candidate's current answer, end the test as instructed.");
    }

    const now = Date.now();
    if (state.part2.stage === "prep" && now >= state.part2.endsAt) finishPreparation();
    if (state.part2.stage === "speaking" && now >= state.part2.endsAt) finishLongTurn();
  }

  if (
    state.phase === PHASE.FEEDBACK &&
    secondsSince(state.feedbackRequestedAt) > TIMING.feedbackTimeoutSec
  ) {
    stopSession();
    showNotice("等待回饋逾時，已結束連線。逐字稿仍可下載。", "error");
  }

  renderTimer();
  renderMic();
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function render() {
  renderStatus();
  renderButtons();
  renderParts();
  renderMic();
  renderTimer();
  renderCueCard();
}

function renderStatus() {
  const map = {
    [PHASE.IDLE]: ["尚未開始", "idle"],
    [PHASE.CONNECTING]: ["連線中…", "busy"],
    [PHASE.EXAM]: [state.isReconnecting ? "重新連線中…" : "考試進行中", "live"],
    [PHASE.FEEDBACK]: ["產生回饋中…", "busy"],
    [PHASE.DONE]: ["已結束", "idle"],
  };
  const [text, kind] = map[state.phase];
  setStatus(text, kind);
}

function renderButtons() {
  const running = [PHASE.CONNECTING, PHASE.EXAM, PHASE.FEEDBACK].includes(state.phase);
  $("startBtn").disabled = running;
  $("startBtn").textContent = state.phase === PHASE.DONE ? "重新開始" : "開始考試";
  $("endBtn").disabled = !running;
  $("endBtn").textContent = state.phase === PHASE.FEEDBACK ? "停止等待回饋" : "結束考試";
  $("downloadBtn").disabled = running || state.transcript.length === 0;
  $("manualPrepBtn").hidden = !(state.phase === PHASE.EXAM && state.part === 2 && state.part2.stage === "none");
  $("voiceSelect").disabled = running;
  $("micSelect").disabled = running;
}

function renderParts() {
  document.querySelectorAll("#parts li").forEach((li) => {
    const step = li.dataset.step;
    let status = "todo";
    if (step === "feedback") {
      if (state.feedback) status = "done";
      else if (state.phase === PHASE.FEEDBACK) status = "current";
    } else {
      const n = Number(step);
      if (state.phase === PHASE.FEEDBACK || state.feedback || n < state.part) status = "done";
      else if (n === state.part && state.phase === PHASE.EXAM) status = "current";
    }
    li.dataset.status = status;
  });
}

function renderMic() {
  const el = $("micState");
  if (!state.streamer || ![PHASE.EXAM, PHASE.FEEDBACK].includes(state.phase)) {
    el.textContent = "麥克風關閉";
    el.dataset.kind = "off";
  } else if (!state.streamer.muted && state.player && state.player.isPlaying(ECHO_TAIL_MS)) {
    el.textContent = "考官說話中";
    el.dataset.kind = "paused";
  } else if (state.streamer.muted) {
    el.textContent = state.part2.stage === "prep" ? "麥克風暫停（準備中）" : "麥克風暫停";
    el.dataset.kind = "paused";
  } else {
    el.textContent = "麥克風收音中";
    el.dataset.kind = "on";
  }
}

function renderTimer() {
  const total = state.startedAt ? (state.endedAt || Date.now()) - state.startedAt : 0;
  $("elapsed").textContent = formatClock(total / 1000);

  const label = $("timerLabel");
  const clock = $("timerClock");
  const hint = $("timerHint");
  const bar = $("timerBar");
  const card = $("timerCard");
  const now = Date.now();
  let progress = 0;

  card.dataset.mode = "idle";
  if (state.phase === PHASE.EXAM && state.part2.stage === "prep") {
    const left = (state.part2.endsAt - now) / 1000;
    label.textContent = "Part 2 準備時間";
    clock.textContent = formatClock(left);
    hint.textContent = "可以在紙上做筆記，麥克風暫停收音";
    progress = 1 - left / TIMING.prepSec;
    card.dataset.mode = "prep";
  } else if (state.phase === PHASE.EXAM && state.part2.stage === "waiting") {
    label.textContent = "Part 2 作答時間";
    clock.textContent = formatClock(TIMING.speakMaxSec);
    hint.textContent = "等考官請你開始…";
    card.dataset.mode = "prep";
  } else if (state.phase === PHASE.EXAM && state.part2.stage === "speaking") {
    const left = (state.part2.endsAt - now) / 1000;
    const spoken = TIMING.speakMaxSec - left;
    label.textContent = "Part 2 作答時間（剩餘）";
    clock.textContent = formatClock(left);
    hint.textContent =
      spoken < TIMING.speakMinSec
        ? `至少再說 ${formatClock(TIMING.speakMinSec - spoken)}，時間到考官會打斷`
        : "已超過 1 分鐘，可以收尾；時間到考官會打斷";
    progress = spoken / TIMING.speakMaxSec;
    card.dataset.mode = left <= 15 ? "warn" : "speak";
  } else if (state.phase === PHASE.EXAM && state.part) {
    label.textContent = `Part ${state.part} 已進行`;
    clock.textContent = formatClock(secondsSince(state.partStartedAt));
    hint.textContent = state.part === 2 ? "考官說明題目中" : "約 4–5 分鐘";
  } else if (state.phase === PHASE.FEEDBACK) {
    label.textContent = "產生回饋中";
    clock.textContent = formatClock(secondsSince(state.feedbackRequestedAt));
    hint.textContent = "通常需要 10–60 秒";
  } else {
    label.textContent = "計時";
    clock.textContent = "0:00";
    hint.textContent = "Part 2 會在這裡顯示準備與作答倒數";
  }
  bar.style.width = `${Math.min(100, Math.max(0, progress * 100))}%`;
}

function renderCueCard() {
  const card = state.part2.card;
  const el = $("cueCard");
  if (!card || !card.topic) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  $("cueTopic").textContent = card.topic;
  const list = $("cueBullets");
  list.innerHTML = "";
  (card.bullet_points || []).forEach((b) => {
    const li = document.createElement("li");
    li.textContent = b;
    list.appendChild(li);
  });
  $("cueFinal").textContent = card.final_point || "";
}

// ─── Feedback ─────────────────────────────────────────────────────────────────

function bandOf(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// IELTS overall band: mean of the four criteria rounded to the nearest half band
function overallBand(feedback) {
  const bands = CRITERIA.map(({ key }) => bandOf(feedback[key]?.band)).filter((b) => b !== null);
  if (bands.length === 0) return null;
  const mean = bands.reduce((a, b) => a + b, 0) / bands.length;
  return Math.round(mean * 2) / 2;
}

function renderFeedback() {
  const fb = state.feedback;
  const body = $("feedbackBody");
  body.innerHTML = "";
  if (!fb) {
    $("feedback").hidden = true;
    return;
  }
  $("feedback").hidden = false;

  const overall = overallBand(fb);
  $("overallBand").textContent = overall === null ? "–" : overall.toFixed(1);
  $("feedbackSummary").textContent = fb.summary || "";

  for (const { key, label } of CRITERIA) {
    const c = fb[key] || {};
    const section = document.createElement("section");
    section.className = "criterion";

    const head = document.createElement("header");
    const title = document.createElement("h3");
    title.textContent = label;
    const band = document.createElement("span");
    band.className = "band";
    band.textContent = bandOf(c.band) === null ? "–" : `Band ${bandOf(c.band).toFixed(1)}`;
    head.append(title, band);
    section.appendChild(head);

    if (c.comment) {
      const p = document.createElement("p");
      p.textContent = c.comment;
      section.appendChild(p);
    }

    if (c.examples?.length) {
      const h = document.createElement("h4");
      h.textContent = "你說過的句子";
      section.appendChild(h);
      for (const ex of c.examples) {
        const q = document.createElement("blockquote");
        q.textContent = `“${ex.quote}”`;
        const note = document.createElement("p");
        note.className = "note";
        note.textContent = ex.note || "";
        section.append(q, note);
      }
    }

    if (c.improvements?.length) {
      const h = document.createElement("h4");
      h.textContent = "具體改法";
      const ol = document.createElement("ol");
      c.improvements.forEach((tip) => {
        const li = document.createElement("li");
        li.textContent = tip;
        ol.appendChild(li);
      });
      section.append(h, ol);
    }

    body.appendChild(section);
  }
  $("feedback").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ─── Markdown export ──────────────────────────────────────────────────────────

function quoteMd(text) {
  return String(text).trim().split("\n").map((l) => `> ${l}`).join("\n");
}

function buildMarkdown() {
  const started = state.startedAt ? new Date(state.startedAt) : new Date();
  const duration = state.startedAt ? ((state.endedAt || Date.now()) - state.startedAt) / 1000 : 0;
  const md = [];

  md.push("# IELTS Speaking 模擬考紀錄", "");
  md.push(`- 日期：${started.toLocaleString("zh-TW", { hour12: false })}`);
  md.push(`- 模型：${MODEL}`);
  md.push(`- 總時長：${formatClock(duration)}`);
  const topics = state.examTopics;
  if (topics) {
    const mark = (t) => (t.isNew ? "（本期新題）" : "");
    md.push(`- 題庫：${QUESTION_BANK_LABEL}`);
    md.push(`- Part 1 話題：${topics.opener.topic}、${topics.part1.map((t) => t.topic + mark(t)).join("、")}`);
    md.push(`- Part 2 題卡：Describe ${topics.part2.card}${mark(topics.part2)}`);
  }

  const fb = state.feedback;
  if (fb) {
    const overall = overallBand(fb);
    md.push(`- 總分估計：${overall === null ? "–" : overall.toFixed(1)}（四項平均，取最接近的 0.5）`, "");
    md.push("## 回饋", "");
    if (fb.summary) md.push(fb.summary.trim(), "");
    md.push("| 評分項目 | Band |", "| --- | --- |");
    for (const { key, label } of CRITERIA) {
      const band = bandOf(fb[key]?.band);
      md.push(`| ${label} | ${band === null ? "–" : band.toFixed(1)} |`);
    }
    md.push("");
    for (const { key, label } of CRITERIA) {
      const c = fb[key] || {};
      const band = bandOf(c.band);
      md.push(`### ${label} — Band ${band === null ? "–" : band.toFixed(1)}`, "");
      if (c.comment) md.push(c.comment.trim(), "");
      if (c.examples?.length) {
        md.push("**你說過的句子**", "");
        for (const ex of c.examples) {
          md.push(quoteMd(`"${ex.quote}"`), "");
          if (ex.note) md.push(ex.note.trim(), "");
        }
      }
      if (c.improvements?.length) {
        md.push("**具體改法**", "");
        c.improvements.forEach((tip, i) => md.push(`${i + 1}. ${tip.trim()}`));
        md.push("");
      }
    }
  } else {
    md.push("", "_本次沒有產生回饋。_");
  }

  md.push("", "## 逐字稿", "", "_逐字稿由語音辨識自動產生，可能有辨識錯誤。_");
  let currentPart = -1;
  for (const entry of state.transcript) {
    if (entry.part !== currentPart) {
      currentPart = entry.part;
      md.push("", `### ${currentPart ? `Part ${currentPart}` : "開場"}`, "");
    }
    const text = entry.text.trim();
    if (entry.role === "system") {
      md.push(`_（${text.replace(/\n/g, " / ")}）_`, "");
    } else {
      md.push(`**${entry.role === "examiner" ? "Examiner" : "我"}：** ${text}`, "");
    }
  }

  return md.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function downloadMarkdown() {
  const d = state.startedAt ? new Date(state.startedAt) : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const name = `ielts-speaking-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.md`;
  const blob = new Blob([buildMarkdown()], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

async function populateMics() {
  try {
    const select = $("micSelect");
    const current = select.value;
    const devices = await navigator.mediaDevices.enumerateDevices();
    select.innerHTML = '<option value="">預設麥克風</option>';
    devices
      .filter((d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default")
      .forEach((d) => {
        const option = document.createElement("option");
        option.value = d.deviceId;
        option.textContent = d.label || `麥克風 ${d.deviceId.slice(0, 6)}`;
        select.appendChild(option);
      });
    select.value = current;
  } catch (error) {
    console.error("Error enumerating devices:", error);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  $("startBtn").addEventListener("click", startExam);
  $("endBtn").addEventListener("click", onEndClick);
  $("downloadBtn").addEventListener("click", downloadMarkdown);
  $("manualPrepBtn").addEventListener("click", () => startPart2Preparation(null));
  $("saveKeyBtn").addEventListener("click", () => {
    const key = $("apiKeyInput").value.trim();
    if (!key) return;
    if (!saveApiKey(key)) {
      showNotice("無法儲存 API key（瀏覽器可能是無痕模式）。", "error");
      return;
    }
    $("apiKeyInput").value = "";
    showNotice("");
    renderApiKey();
  });
  $("clearKeyBtn").addEventListener("click", () => {
    saveApiKey("");
    renderApiKey();
  });
  $("volume").addEventListener("input", () => {
    if (state.player) state.player.setVolume($("volume").value / 100);
  });
  window.addEventListener("beforeunload", (e) => {
    if ([PHASE.EXAM, PHASE.FEEDBACK].includes(state.phase)) e.preventDefault();
  });

  populateMics();
  renderApiKey();
  render();
  state.tickTimer = setInterval(tick, 250);
});
