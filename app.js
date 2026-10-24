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
  mode: "full", // key of PRACTICE_MODES
  plan: [1, 2, 3], // the parts this session covers, in order
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
  hintLog: [], // { part, label, data } for the Markdown export
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
      lines.push(`\n--- Part ${currentPart || state.plan[0]} ---`);
    }
    lines.push(`${entry.role === "examiner" ? "Examiner" : "Candidate"}: ${entry.text.trim()}`);
  }
  return lines.join("\n").trim();
}

// ─── Exam flow ────────────────────────────────────────────────────────────────

function setPart(part) {
  if (!state.plan.includes(part) || part === state.part) return;
  state.part = part;
  state.partStartedAt = Date.now();
  if (part === 3 && state.part2.stage !== "none") stopPart2Timer();
  addTranscript("system", `進入 Part ${part}`);
  renderParts();
  renderButtons();
}

function startPart2Preparation(card) {
  if (state.phase !== PHASE.EXAM || !state.plan.includes(2)) return;
  if (["prep", "waiting", "speaking"].includes(state.part2.stage)) return;
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
  updateHints();
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
  startStudy();

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

// ─── Practice mode (remembered in this browser) ───────────────────────────────

const MODE_STORAGE = "ielts-examiner.practice-mode";

function loadMode() {
  try {
    const mode = localStorage.getItem(MODE_STORAGE);
    return PRACTICE_MODES[mode] ? mode : "full";
  } catch {
    return "full";
  }
}

function saveMode(mode) {
  try {
    localStorage.setItem(MODE_STORAGE, mode);
  } catch {
    // Private mode: the choice just won't be remembered
  }
}

// The finished session keeps its own mode until the next one starts (for the export)
function applyMode(mode) {
  state.mode = PRACTICE_MODES[mode] ? mode : "full";
  state.plan = PRACTICE_MODES[state.mode].parts;
}

function populateModes() {
  const select = $("modeSelect");
  for (const [value, { label }] of Object.entries(PRACTICE_MODES)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }
  select.value = state.mode;
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
  applyMode($("modeSelect").value);
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

    state.examTopics = pickExamTopics(state.plan);
    state.systemInstruction = buildSystemInstruction(state.examTopics, state.plan);
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
        if (state.part === 0 && state.phase === PHASE.EXAM) setPart(state.plan[0]);
        addTranscript("examiner", message.data.text);
      }
      break;

    case MultimodalLiveResponseType.TURN_COMPLETE: {
      const last = state.transcript[state.transcript.length - 1];
      if (last && last.role === "examiner") last.open = false;
      const callbacks = state.afterTurn;
      state.afterTurn = [];
      callbacks.forEach((cb) => cb());
      // Let the last bit of output transcription arrive before reading the question
      if (hints.on) setTimeout(() => updateHints(), 300);
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
    hintLog: [],
    examinerAudioReceived: false,
  });
  resetHints();
  resetStudy();
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
      const next = state.plan.includes(2) ? "move on to Part 2" : "end the test as instructed";
      sendSilentNote(`Part 1 has lasted about 4.5 minutes. After the candidate's current answer, ${next}.`);
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
  renderHints();
  renderStudy();
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
  $("modeSelect").disabled = running;
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
      if (!state.plan.includes(n)) status = "skip";
      else if (state.phase === PHASE.FEEDBACK || state.feedback || n < state.part) status = "done";
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

// ─── Vocabulary hints (hints.js) ──────────────────────────────────────────────

const HINTS_STORAGE = "ielts-examiner.hints-on";
const HINT_TRIGGER = /\?|\b(tell me|describe|talk about|explain)\b/i;

const hints = {
  on: false,
  key: null, // what the current hints are for, to avoid asking twice
  label: "",
  status: "idle", // idle | loading | ready | error | nokey
  data: null,
  error: "",
  controller: null,
};

function loadHintsPref() {
  try {
    return localStorage.getItem(HINTS_STORAGE) === "1";
  } catch {
    return false;
  }
}

function saveHintsPref(on) {
  try {
    localStorage.setItem(HINTS_STORAGE, on ? "1" : "0");
  } catch {
    // Private mode: the toggle just won't be remembered
  }
}

function setHintsOn(on) {
  hints.on = on;
  saveHintsPref(on);
  if (!on && hints.controller) {
    // Drop a request in flight so turning it back on asks again
    hints.controller.abort();
    hints.controller = null;
    hints.key = null;
    hints.status = "idle";
  }
  if (on) updateHints();
  renderHints();
}

function resetHints() {
  if (hints.controller) hints.controller.abort();
  Object.assign(hints, { key: null, label: "", status: "idle", data: null, error: "", controller: null });
  renderHints();
}

function part2InProgress() {
  return ["prep", "waiting", "speaking"].includes(state.part2.stage);
}

// The sentence to show above the hints, e.g. the question itself
function questionLabel(text) {
  const sentences = text.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);
  return [...sentences].reverse().find((s) => s.includes("?")) || sentences[sentences.length - 1] || text;
}

// What the hints should be about right now, or null if there is nothing yet
function currentHintRequest() {
  if (state.phase !== PHASE.EXAM) return null;

  // During Part 2 the hints stay on the cue card until the long turn is over
  if (part2InProgress()) {
    const card = state.part2.card;
    return card && card.topic ? { part: 2, card, label: card.topic, key: `card:${card.topic}` } : null;
  }

  const entry = [...state.transcript].reverse().find((e) => e.role === "examiner");
  if (!entry || entry.open || !HINT_TRIGGER.test(entry.text)) return null;
  const question = entry.text.trim().slice(-500);
  const card = state.part2.card?.topic || (state.examTopics ? `Describe ${state.examTopics.part2.card}` : "");
  return {
    part: state.part || 1,
    question,
    followsCard: state.part === 3 ? card : "",
    label: questionLabel(question),
    key: `q:${question}`,
  };
}

function updateHints({ force = false } = {}) {
  if (!hints.on) return;
  const request = currentHintRequest();
  if (!request) {
    // Part 2 started without a cue card (manual button): old Part 1 hints don't fit
    if (part2InProgress() && hints.key && !hints.key.startsWith("card:")) resetHints();
    return;
  }
  if (!force && request.key === hints.key) return;

  if (hints.controller) hints.controller.abort();
  Object.assign(hints, { key: request.key, label: request.label, data: null, error: "", controller: null });

  const apiKey = loadApiKey();
  if (!apiKey) {
    hints.status = "nokey";
    renderHints();
    return;
  }

  const controller = new AbortController();
  hints.controller = controller;
  hints.status = "loading";
  renderHints();

  fetchHints(request, apiKey, controller.signal)
    .then((data) => {
      if (hints.controller !== controller) return;
      hints.status = "ready";
      hints.data = data;
      if (data.phrases.length || data.words.length) {
        state.hintLog.push({ part: request.part, label: request.label, data });
      }
    })
    .catch((error) => {
      if (hints.controller !== controller) return;
      console.error("Hints failed:", error);
      hints.status = "error";
      hints.error = error.message;
    })
    .finally(() => {
      if (hints.controller !== controller) return;
      hints.controller = null;
      renderHints();
    });
}

function makeEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderHints() {
  const card = $("hintsCard");
  $("hintsToggle").checked = hints.on;
  const visible = hints.on && [PHASE.IDLE, PHASE.CONNECTING, PHASE.EXAM].includes(state.phase);
  card.hidden = !visible;
  if (!visible) return;

  const body = $("hintsBody");
  body.innerHTML = "";
  const inExam = state.phase === PHASE.EXAM;
  $("hintsFor").textContent = inExam ? hints.label : "";
  card.dataset.status = inExam ? hints.status : "idle";

  const note = (text, kind) => {
    const p = makeEl("p", "hints-note", text);
    if (kind) p.dataset.kind = kind;
    body.appendChild(p);
    return p;
  };
  const action = (text, onClick) => {
    const btn = makeEl("button", "link hints-action", text);
    btn.type = "button";
    btn.addEventListener("click", onClick);
    body.appendChild(btn);
  };

  if (!inExam) {
    note("考試開始後，考官每問一題，這裡就會出現和題目相關的片語與單字。Part 2 準備時間會針對題卡給提示。");
    return;
  }

  switch (hints.status) {
    case "loading":
      note("產生提示中…");
      break;
    case "nokey":
      note("提示詞彙需要在「設定」填入 Gemini API key（用 server.py 啟動時的臨時憑證只能連考官的 Live API）。", "error");
      action("打開設定", openSettings);
      break;
    case "error":
      note(`提示產生失敗：${hints.error}`, "error");
      action("重試", () => updateHints({ force: true }));
      break;
    case "ready":
      renderHintData(body, hints.data, note);
      break;
    default:
      note("等考官問下一題…");
  }
}

function renderHintData(body, data, note) {
  if (!data.starter && !data.phrases.length && !data.words.length) {
    note("這題不需要提示");
    return;
  }

  if (data.starter) {
    const p = makeEl("p", "hint-starter");
    p.append(makeEl("span", "hint-tag", "開頭"), makeEl("span", "", data.starter));
    p.lastChild.lang = "en";
    body.appendChild(p);
  }

  if (data.phrases.length) {
    const ul = makeEl("ul", "hint-phrases");
    for (const phrase of data.phrases) {
      const li = makeEl("li");
      const line = makeEl("div", "hint-line");
      const en = makeEl("b", "", phrase.en);
      en.lang = "en";
      line.append(en, makeEl("span", "zh", phrase.zh));
      li.appendChild(line);
      if (phrase.example) {
        const ex = makeEl("p", "hint-ex", phrase.example);
        ex.lang = "en";
        li.appendChild(ex);
      }
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }

  if (data.words.length) {
    const ul = makeEl("ul", "hint-words");
    for (const word of data.words) {
      const li = makeEl("li");
      const en = makeEl("b", "", word.en);
      en.lang = "en";
      li.append(en, makeEl("span", "zh", word.zh));
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }
}

// ─── Study list after the test (study.js) ─────────────────────────────────────

const study = {
  vocab: { status: "idle", data: null, error: "" }, // idle | loading | ready | error | nokey
  fixes: { status: "idle", data: null, error: "" },
  controller: null,
};

function resetStudy() {
  if (study.controller) study.controller.abort();
  study.controller = null;
  for (const area of ["vocab", "fixes"]) Object.assign(study[area], { status: "idle", data: null, error: "" });
  renderStudy();
}

function candidateSpoke() {
  return state.transcript.some((e) => e.role === "candidate" && e.text.trim());
}

// Examiner questions per part, as heard in the transcript
function askedQuestions() {
  const asked = {};
  for (const entry of state.transcript) {
    if (entry.role !== "examiner") continue;
    const part = entry.part || state.plan[0];
    const questions = entry.text.split(/(?<=[.?!])\s+/).map((q) => q.trim()).filter((q) => q.endsWith("?"));
    asked[part] = [...(asked[part] || []), ...questions];
  }
  for (const part of Object.keys(asked)) asked[part] = [...new Set(asked[part])].slice(0, 20);
  return asked;
}

// The topics of the parts that were actually reached
function studyTopics() {
  const topics = state.examTopics;
  if (!topics) return [];
  const reached = state.plan.filter((p) => p <= Math.max(state.part, state.plan[0]));
  const list = [];
  if (reached.includes(1)) {
    for (const t of [topics.opener, ...topics.part1]) list.push({ part: 1, name: t.topic, samples: t.samples });
  }
  const card = state.part2.card;
  const cardName = card?.topic || `Describe ${topics.part2.card}`;
  if (reached.includes(2)) {
    list.push({ part: 2, name: cardName, samples: card ? [...(card.bullet_points || []), card.final_point].filter(Boolean) : [] });
  }
  if (reached.includes(3)) {
    const directions = PART3_DIRECTIONS[topics.part2.part3];
    list.push({ part: 3, name: `Discussion following "${cardName}"`, samples: directions ? [directions] : [] });
  }
  return list;
}

function startStudy(only) {
  const areas = only ? [only] : ["vocab", "fixes"];
  if (!only && study.controller) study.controller.abort();
  const controller = only && study.controller ? study.controller : new AbortController();
  study.controller = controller;

  const apiKey = loadApiKey();
  const spoke = candidateSpoke();
  for (const area of areas) {
    const slot = study[area];
    Object.assign(slot, { data: null, error: "" });
    if (!apiKey) {
      slot.status = "nokey";
      continue;
    }
    if (area === "fixes" && !spoke) {
      Object.assign(slot, { status: "ready", data: [] });
      continue;
    }
    const request =
      area === "vocab"
        ? fetchStudyVocab({ topics: studyTopics(), asked: askedQuestions() }, apiKey, controller.signal)
        : fetchStudyFixes(transcriptAsText(), apiKey, controller.signal);
    slot.status = "loading";
    request
      .then((data) => {
        if (study.controller !== controller) return;
        Object.assign(slot, { status: "ready", data });
      })
      .catch((error) => {
        if (study.controller !== controller) return;
        console.error(`Study ${area} failed:`, error);
        Object.assign(slot, { status: "error", error: error.message });
      })
      .finally(() => {
        if (study.controller === controller) renderStudy();
      });
  }
  renderStudy();
}

function renderStudy() {
  const section = $("study");
  const started = study.vocab.status !== "idle" || study.fixes.status !== "idle";
  const ended = [PHASE.FEEDBACK, PHASE.DONE].includes(state.phase);
  section.hidden = !ended || !(started || candidateSpoke());
  if (section.hidden) return;

  // The session ended without the normal ending (e.g. connection lost): offer to generate
  $("studyStartBtn").hidden = started;
  $("studyBody").hidden = !started;
  if (!started) return;

  renderStudyArea($("studyVocab"), "vocab", renderVocab);
  renderStudyArea($("studyFixes"), "fixes", renderFixes);
}

function renderStudyArea(box, area, renderData) {
  const slot = study[area];
  box.innerHTML = "";
  box.dataset.status = slot.status;
  const note = (text, kind) => {
    const p = makeEl("p", "hints-note", text);
    if (kind) p.dataset.kind = kind;
    box.appendChild(p);
  };
  const action = (text, onClick) => {
    const btn = makeEl("button", "link hints-action", text);
    btn.type = "button";
    btn.addEventListener("click", onClick);
    box.appendChild(btn);
  };

  switch (slot.status) {
    case "loading":
      note(area === "vocab" ? "正在搜尋過去考題與詞彙庫…（約 20–60 秒）" : "檢查你說錯的詞…");
      break;
    case "nokey":
      note("背誦清單需要在「設定」填入 Gemini API key。", "error");
      action("打開設定", openSettings);
      break;
    case "error":
      note(`產生失敗：${slot.error}`, "error");
      action("重試", () => startStudy(area));
      break;
    case "ready":
      renderData(box, slot.data, note);
      break;
  }
}

function renderVocab(box, data, note) {
  if (!data.topics.length) {
    note("沒有產生單字。");
    return;
  }
  if (!data.searched) note("這次無法使用 Google 搜尋，以下單字由模型依自身知識整理。");

  for (const topic of data.topics) {
    const group = makeEl("div", "study-topic");
    const title = makeEl("h4", "", topic.part ? `Part ${topic.part} · ${topic.topic}` : topic.topic);
    title.lang = "en";
    group.appendChild(title);

    if (topic.pastQuestions.length) {
      const past = makeEl("details", "study-past");
      past.appendChild(makeEl("summary", "", `過去考過的題目（${topic.pastQuestions.length}）`));
      const ul = makeEl("ul");
      for (const q of topic.pastQuestions) {
        const li = makeEl("li", "", q);
        li.lang = "en";
        ul.appendChild(li);
      }
      past.appendChild(ul);
      group.appendChild(past);
    }

    const ul = makeEl("ul", "hint-phrases");
    for (const item of topic.items) {
      const li = makeEl("li");
      const line = makeEl("div", "hint-line");
      const en = makeEl("b", "", item.en);
      en.lang = "en";
      line.append(en, makeEl("span", "zh", item.zh));
      li.appendChild(line);
      if (item.example) {
        const ex = makeEl("p", "hint-ex", item.example);
        ex.lang = "en";
        li.appendChild(ex);
      }
      ul.appendChild(li);
    }
    group.appendChild(ul);
    box.appendChild(group);
  }

  if (data.sources.length) {
    const sources = makeEl("details", "study-sources");
    sources.appendChild(makeEl("summary", "", `資料來源（${data.sources.length}）`));
    const ul = makeEl("ul");
    for (const { uri, title } of data.sources) {
      const li = makeEl("li");
      const a = makeEl("a", "", title);
      a.href = uri;
      a.target = "_blank";
      a.rel = "noopener";
      li.appendChild(a);
      ul.appendChild(li);
    }
    sources.appendChild(ul);
    box.appendChild(sources);
  }

  // Google requires showing its search suggestions with grounded answers
  if (data.searchHtml) {
    const frame = makeEl("iframe", "study-search");
    frame.title = "Google 搜尋建議";
    frame.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
    frame.srcdoc = `<base target="_blank">${data.searchHtml}`;
    box.appendChild(frame);
  }
}

function renderFixes(box, data, note) {
  if (!data.length) {
    note(candidateSpoke() ? "沒有找到明顯的用字錯誤。" : "這次沒有收到你的回答。");
    return;
  }
  const ol = makeEl("ol", "study-fixes");
  for (const fix of data) {
    const li = makeEl("li");
    const pair = makeEl("div", "fix-pair");
    const wrong = makeEl("s", "fix-wrong", fix.wrong);
    const right = makeEl("b", "fix-right", fix.right);
    wrong.lang = right.lang = "en";
    pair.append(wrong, makeEl("span", "fix-arrow", "→"), right, makeEl("span", "hint-tag", FIX_KINDS[fix.kind]));
    li.appendChild(pair);
    if (fix.original) {
      const ctx = makeEl("p", "fix-context");
      const said = makeEl("span", "", `“${fix.original}”`);
      const better = makeEl("span", "", `“${fix.corrected}”`);
      said.lang = better.lang = "en";
      ctx.append(makeEl("span", "fix-label", "你說"), said, makeEl("span", "fix-label", "改成"), better);
      li.appendChild(ctx);
    }
    if (fix.explanation) li.appendChild(makeEl("p", "fix-why", fix.explanation));
    ol.appendChild(li);
  }
  box.appendChild(ol);
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
  md.push(`- 練習範圍：${PRACTICE_MODES[state.mode].label}`);
  const topics = state.examTopics;
  if (topics) {
    const mark = (t) => (t.isNew ? "（本期新題）" : "");
    md.push(`- 題庫：${QUESTION_BANK_LABEL}`);
    if (state.plan.includes(1)) {
      md.push(`- Part 1 話題：${topics.opener.topic}、${topics.part1.map((t) => t.topic + mark(t)).join("、")}`);
    }
    if (state.plan.includes(2) || state.plan.includes(3)) {
      md.push(`- ${state.plan.includes(2) ? "Part 2 題卡" : "Part 3 討論主題"}：Describe ${topics.part2.card}${mark(topics.part2)}`);
    }
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


  const vocab = study.vocab.status === "ready" ? study.vocab.data : null;
  const fixes = study.fixes.status === "ready" ? study.fixes.data : null;
  if (vocab?.topics.length || fixes?.length) {
    md.push("", "## 背誦清單", "");
    if (vocab?.topics.length) {
      md.push("### 主題單字", "");
      for (const topic of vocab.topics) {
        md.push(`#### ${topic.part ? `Part ${topic.part} · ` : ""}${topic.topic}`, "");
        if (topic.pastQuestions.length) {
          md.push("過去考過的題目：", "", ...topic.pastQuestions.map((q) => `- ${q}`), "");
        }
        md.push("| 單字／片語 | 中文 | 例句 |", "| --- | --- | --- |");
        const cell = (t) => t.replace(/\|/g, "\\|");
        topic.items.forEach((i) => md.push(`| **${cell(i.en)}** | ${cell(i.zh)} | ${cell(i.example)} |`));
        md.push("");
      }
      if (vocab.sources.length) {
        md.push("資料來源：", "", ...vocab.sources.map((s) => `- [${s.title}](${s.uri})`), "");
      }
    }
    if (fixes?.length) {
      md.push("### 我說錯的詞", "");
      fixes.forEach((f, i) => {
        md.push(`${i + 1}. ~~${f.wrong}~~ → **${f.right}**（${FIX_KINDS[f.kind]}）`);
        if (f.original) md.push(`   - 你說：_${f.original}_`, `   - 改成：_${f.corrected}_`);
        if (f.explanation) md.push(`   - ${f.explanation}`);
      });
      md.push("");
    }
  }

  if (state.hintLog.length) {
    md.push("", "## 提示詞彙", "");
    for (const { part, label, data } of state.hintLog) {
      md.push(`### Part ${part}：${label}`, "");
      if (data.starter) md.push(`開頭：${data.starter}`, "");
      data.phrases.forEach((p) => md.push(`- **${p.en}** ${p.zh}${p.example ? ` — _${p.example}_` : ""}`));
      if (data.words.length) md.push("", `單字：${data.words.map((w) => `**${w.en}** ${w.zh}`).join("、")}`);
      md.push("");
    }
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
    if (hints.status === "nokey") updateHints({ force: true });
    for (const area of ["vocab", "fixes"]) {
      if (study[area].status === "nokey") startStudy(area);
    }
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

  applyMode(loadMode());
  populateModes();
  $("modeSelect").addEventListener("change", (e) => {
    saveMode(e.target.value);
    if (state.phase === PHASE.IDLE) {
      applyMode(e.target.value);
      renderParts();
    }
  });

  hints.on = loadHintsPref();
  $("hintsToggle").addEventListener("change", (e) => setHintsOn(e.target.checked));
  $("studyStartBtn").addEventListener("click", () => startStudy());

  populateMics();
  renderApiKey();
  render();
  state.tickTimer = setInterval(tick, 250);
});
