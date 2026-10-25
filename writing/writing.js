/**
 * IELTS Writing micro-practice: one paragraph task a day.
 * Mode A (outline day): keywords for all four paragraphs.
 * Mode B (paragraph day): pick a saved outline and write one paragraph in full.
 * Everything is stored only in this browser (localStorage).
 */

const STORE = {
  records: "ielts-writing.records",
  current: "ielts-writing.current", // { id, setOn } of today's prompt
  recent: "ielts-writing.recent", // last prompt ids, to avoid repeats
  draft: "ielts-writing.draft",
};
const RECENT_LIMIT = 3;
const RECORD_LIMIT = 300;
const FULL = { key: "full", name: "整篇", label: "Essay" };

const $ = (id) => document.getElementById(id);

const W = {
  mode: "A",
  promptId: null, // today's prompt (mode A, or mode B without an outline)
  outline: { intro: "", body1: "", body2: "", conclusion: "" },
  outlineId: null, // the saved outline used in mode B
  section: "intro", // mode B: a SECTIONS key or "full"
  paragraph: "",
  focused: null, // mode A: the paragraph being typed, for the highlight
  timer: { length: 300, elapsed: 0, startedAt: null },
};

// ─── Small helpers ────────────────────────────────────────────────────────────

function load(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // private mode or storage full
  }
}

function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shortDate(dateString) {
  const [, m, d] = dateString.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function formatClock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function countWords(text) {
  return (text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length;
}

function makeEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function sectionOf(key) {
  return key === "full" ? FULL : SECTIONS.find((s) => s.key === key);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

function flash(button, text) {
  const original = button.dataset.label || button.textContent;
  button.dataset.label = original;
  button.textContent = text;
  clearTimeout(button.flashTimer);
  button.flashTimer = setTimeout(() => (button.textContent = original), 1500);
}

// ─── Prompts and records ──────────────────────────────────────────────────────

function loadRecords() {
  const list = load(STORE.records, []);
  return Array.isArray(list) ? list : [];
}

function outlines() {
  return loadRecords().filter((r) => r.mode === "A");
}

// A random prompt that wasn't used in the last few picks
function pickPrompt() {
  const recent = load(STORE.recent, []);
  const fresh = WRITING_PROMPTS.filter((p) => !recent.includes(p.id) && p.id !== W.promptId);
  const pool = fresh.length ? fresh : WRITING_PROMPTS.filter((p) => p.id !== W.promptId);
  const prompt = pool[Math.floor(Math.random() * pool.length)];
  W.promptId = prompt.id;
  save(STORE.current, { id: prompt.id, setOn: localDate() });
  save(STORE.recent, [prompt.id, ...recent.filter((id) => id !== prompt.id)].slice(0, RECENT_LIMIT));
}

// The prompt being practised: the chosen outline's in mode B, otherwise today's
function currentPrompt() {
  if (W.mode === "B" && W.outlineId) {
    const record = outlines().find((r) => r.id === W.outlineId);
    if (record) return { id: record.promptId, type: record.type, prompt: record.prompt, outline: record };
  }
  return WRITING_PROMPTS.find((p) => p.id === W.promptId) || WRITING_PROMPTS[0];
}

function streak() {
  const dates = new Set(loadRecords().map((r) => r.date));
  const day = new Date();
  const doneToday = dates.has(localDate(day));
  if (!doneToday) day.setDate(day.getDate() - 1);
  let count = 0;
  while (dates.has(localDate(day))) {
    count += 1;
    day.setDate(day.getDate() - 1);
  }
  return { count, doneToday };
}

// ─── Draft (survives a reload) ────────────────────────────────────────────────

function saveDraft() {
  save(STORE.draft, {
    date: localDate(),
    mode: W.mode,
    promptId: W.promptId,
    outline: W.outline,
    outlineId: W.outlineId,
    section: W.section,
    paragraph: W.paragraph,
  });
}

// ─── Timer ────────────────────────────────────────────────────────────────────

function elapsedMs() {
  const t = W.timer;
  return t.elapsed + (t.startedAt ? Date.now() - t.startedAt : 0);
}

function startTimer() {
  if (!W.timer.startedAt) W.timer.startedAt = Date.now();
  renderTimer();
}

function toggleTimer() {
  const t = W.timer;
  if (t.startedAt) {
    t.elapsed = elapsedMs();
    t.startedAt = null;
  } else {
    t.startedAt = Date.now();
  }
  renderTimer();
}

function resetTimer() {
  Object.assign(W.timer, { elapsed: 0, startedAt: null });
  renderTimer();
}

function setTimerLength(seconds) {
  W.timer.length = seconds;
  $("timerLength").value = String(seconds);
  renderTimer();
}

function renderTimer() {
  const t = W.timer;
  const left = t.length - elapsedMs() / 1000;
  const box = document.querySelector(".w-timer");
  const running = Boolean(t.startedAt);
  const started = running || t.elapsed > 0;

  $("timerClock").textContent = left >= 0 ? formatClock(Math.ceil(left)) : `+${formatClock(-left)}`;
  $("timerToggle").textContent = running ? "暫停" : started ? "繼續" : "開始";

  let state = "idle";
  let note = "按開始，或直接開始打字";
  if (left < 0) {
    state = "over";
    note = "時間到！想寫完就繼續寫，不會鎖住。";
  } else if (running) {
    state = left <= 30 ? "warn" : "running";
    note = left <= 30 ? "最後 30 秒，準備收尾" : "專心寫，時間到只會提示";
  } else if (started) {
    state = "paused";
    note = "已暫停";
  }
  box.dataset.state = state;
  $("timerNote").textContent = note;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function render() {
  renderPrompt();
  renderMode();
  renderTasks();
  renderCount();
  renderTimer();
  renderStreak();
  renderRecords();
}

function renderPrompt() {
  const prompt = currentPrompt();
  $("promptText").textContent = prompt.prompt;
  $("promptType").textContent = WRITING_TYPES[prompt.type].label;
  const fromOutline = W.mode === "B" && prompt.outline;
  $("promptHead").textContent = fromOutline ? "這次的題目" : "今日題目";
  $("promptSource").hidden = !fromOutline;
  if (fromOutline) $("promptSource").textContent = `來自 ${shortDate(prompt.outline.date)} 的大綱`;
  $("swapBtn").hidden = Boolean(fromOutline);
}

function renderMode() {
  for (const tab of document.querySelectorAll(".w-mode")) {
    tab.setAttribute("aria-selected", String(tab.dataset.mode === W.mode));
  }
  const isB = W.mode === "B";
  $("modeDesc").textContent = isB
    ? "選一份之前的大綱，只把其中一段寫成完整段落。同一份大綱可以拆成 3–4 天練。"
    : "讀題後，用英文關鍵字填滿四段：立場、理由一、理由二、例子。不用寫成完整句子。";
  $("bControls").hidden = !isB;
  $("paragraphBox").hidden = !isB;
  if (isB) {
    renderOutlineSelect();
    renderSectionPicker();
  }
}

function renderOutlineSelect() {
  const select = $("outlineSelect");
  select.innerHTML = "";
  for (const record of outlines()) {
    const type = WRITING_TYPES[record.type]?.label || "";
    const option = makeEl("option", "", `${shortDate(record.date)}｜${type}｜${record.prompt.slice(0, 48)}…`);
    option.value = record.id;
    select.appendChild(option);
  }
  const none = makeEl("option", "", "不用大綱：直接寫今日題目");
  none.value = "";
  select.appendChild(none);
  select.value = W.outlineId || "";
}

function renderSectionPicker() {
  const picker = $("sectionPicker");
  picker.innerHTML = "";
  for (const section of [...SECTIONS, FULL]) {
    const btn = makeEl("button", "w-segment", section.name);
    btn.type = "button";
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(W.section === section.key));
    btn.addEventListener("click", () => setSection(section.key));
    picker.appendChild(btn);
  }
}

// The four paragraph task cards; in mode A each holds a keyword box
function renderTasks() {
  const prompt = currentPrompt();
  const type = WRITING_TYPES[prompt.type];
  const outline = W.mode === "B" ? prompt.outline?.outline : null;
  const list = $("tasks");
  list.innerHTML = "";

  SECTIONS.forEach((section, i) => {
    const li = makeEl("li", "w-task");
    li.dataset.key = section.key;
    const head = makeEl("div", "w-task-head");
    head.append(makeEl("span", "w-num", String(i + 1)), makeEl("b", "", section.name), makeEl("span", "w-task-text", type.tasks[section.key]));
    li.appendChild(head);

    if (W.mode === "A") {
      const input = makeEl("textarea", "w-keywords");
      input.rows = 2;
      input.lang = "en";
      input.value = W.outline[section.key];
      input.placeholder = `${section.label}: keywords…`;
      input.setAttribute("aria-label", `${section.name}的關鍵字`);
      input.addEventListener("focus", () => setFocused(section.key));
      input.addEventListener("input", () => {
        W.outline[section.key] = input.value;
        onType();
      });
      li.appendChild(input);
    } else if (outline && outline[section.key]) {
      const mine = makeEl("p", "w-outline-line");
      mine.append(makeEl("span", "w-outline-tag", "我的大綱"), makeEl("span", "", outline[section.key]));
      mine.lastChild.lang = "en";
      li.appendChild(mine);
    }
    list.appendChild(li);
  });

  renderHighlight();
  if (W.mode === "B") renderParagraphLabel();
}

// Highlight the paragraph being worked on
function renderHighlight() {
  for (const li of document.querySelectorAll(".w-task")) {
    const key = li.dataset.key;
    const current = W.mode === "A" ? W.focused === key : W.section === "full" || W.section === key;
    li.dataset.current = String(current);
  }
}

function renderParagraphLabel() {
  const prompt = currentPrompt();
  const textarea = $("paragraph");
  if (W.section === "full") {
    $("paragraphLabel").textContent = "寫完整篇：四段都寫，段落之間空一行";
    textarea.rows = 16;
  } else {
    const section = sectionOf(W.section);
    $("paragraphLabel").textContent = `寫${section.name}：${WRITING_TYPES[prompt.type].tasks[W.section]}`;
    textarea.rows = 9;
  }
  textarea.value = W.paragraph;
}

function currentText() {
  return W.mode === "A" ? SECTIONS.map((s) => W.outline[s.key]).join(" ") : W.paragraph;
}

function renderCount() {
  const words = countWords(currentText());
  $("wordCount").textContent = `${words} word${words === 1 ? "" : "s"}`;
}

function renderStreak() {
  const { count, doneToday } = streak();
  const pill = $("streak");
  if (!count) {
    pill.textContent = "今天開始第 1 天";
    pill.dataset.kind = "off";
  } else if (doneToday) {
    pill.textContent = `連續 ${count} 天 · 今天完成`;
    pill.dataset.kind = "on";
  } else {
    pill.textContent = `連續 ${count} 天 · 今天還沒練`;
    pill.dataset.kind = "busy";
  }
}

function renderRecords() {
  const records = loadRecords();
  $("recordCount").textContent = records.length ? `${records.length} 筆` : "";
  $("recordEmpty").hidden = records.length > 0;
  const list = $("records");
  list.innerHTML = "";

  for (const record of records) {
    const li = makeEl("li", "w-record");
    const details = makeEl("details");
    const type = WRITING_TYPES[record.type]?.label || "";
    const what = record.mode === "A" ? "A 大綱" : `B ${sectionOf(record.section)?.name || ""}`;
    const summary = makeEl("summary");
    summary.append(
      makeEl("b", "", `${shortDate(record.date)} · ${what}`),
      makeEl("span", "w-record-meta", `${type} · ${record.words} words${record.seconds ? ` · ${formatClock(record.seconds)}` : ""}`)
    );
    details.appendChild(summary);

    const body = makeEl("div", "w-record-body");
    const prompt = makeEl("p", "w-record-prompt", record.prompt);
    prompt.lang = "en";
    body.appendChild(prompt);
    const content = makeEl("pre", "w-record-text", recordAnswer(record));
    content.lang = "en";
    body.appendChild(content);

    const actions = makeEl("div", "w-record-actions");
    const copy = makeEl("button", "btn small ghost", "複製");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      await copyText(copyTextFor(record));
      flash(copy, "已複製");
    });
    actions.appendChild(copy);
    if (record.mode === "A") {
      const use = makeEl("button", "btn small ghost", "用這份大綱寫段落");
      use.type = "button";
      use.addEventListener("click", () => {
        W.outlineId = record.id;
        setMode("B");
        $("practice").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      actions.appendChild(use);
    }
    const del = makeEl("button", "btn small ghost w-delete", "刪除");
    del.type = "button";
    del.addEventListener("click", () => deleteRecord(record.id));
    actions.appendChild(del);
    body.appendChild(actions);

    details.appendChild(body);
    li.appendChild(details);
    list.appendChild(li);
  }
}

function recordAnswer(record) {
  if (record.mode === "A") return SECTIONS.map((s) => `${s.label}: ${record.outline[s.key] || ""}`).join("\n");
  return record.text;
}

// ─── Copy for a teacher or an AI ──────────────────────────────────────────────

function copyTextFor({ mode, section, type, prompt, outline, text }) {
  const typeInfo = WRITING_TYPES[type];
  const lines = [];
  const title = mode === "A" ? "A 大綱日" : section === "full" ? "完整作文" : `B 段落日：${sectionOf(section).name}`;
  lines.push(`IELTS Writing Task 2｜${title}`, `題型：${typeInfo.label}`, `題目：${prompt}`, "");

  if (mode === "A" || section === "full") {
    lines.push("段落任務：");
    SECTIONS.forEach((s, i) => lines.push(`${i + 1}. ${s.name}（${s.label}）：${typeInfo.tasks[s.key]}`));
  } else {
    lines.push(`這段的任務：${typeInfo.tasks[section]}`);
  }

  if (mode === "A") {
    lines.push("", "我的大綱：", ...SECTIONS.map((s) => `${s.label}: ${outline[s.key] || ""}`));
  } else {
    if (outline) lines.push("", "我的大綱：", ...SECTIONS.map((s) => `${s.label}: ${outline[s.key] || ""}`));
    lines.push("", `我的${section === "full" ? "作文" : "段落"}（${countWords(text)} words）：`, text);
  }
  return lines.join("\n").trim();
}

// What is on screen now, in the same shape as a saved record
function currentEntry() {
  const prompt = currentPrompt();
  const base = { mode: W.mode, type: prompt.type, prompt: prompt.prompt, promptId: prompt.id };
  if (W.mode === "A") return { ...base, outline: { ...W.outline } };
  return { ...base, section: W.section, outline: prompt.outline?.outline || null, outlineId: prompt.outline?.id || null, text: W.paragraph };
}

// ─── Actions ──────────────────────────────────────────────────────────────────

function onType() {
  if (!W.timer.startedAt && W.timer.elapsed === 0) startTimer();
  renderCount();
  saveDraft();
  $("saveNote").hidden = true;
}

function setFocused(key) {
  W.focused = key;
  renderHighlight();
}

function defaultLength() {
  return W.mode === "A" ? 300 : W.section === "full" ? 2400 : 600;
}

function setMode(mode) {
  const changed = mode !== W.mode;
  W.mode = mode;
  if (mode === "B" && !outlines().some((r) => r.id === W.outlineId)) W.outlineId = outlines()[0]?.id || null;
  if (changed) setTimerLength(defaultLength());
  saveDraft();
  render();
}

function setSection(key) {
  const wasFull = W.section === "full";
  W.section = key;
  if (key === "full") setTimerLength(2400);
  else if (wasFull) setTimerLength(600);
  saveDraft();
  renderSectionPicker();
  renderHighlight();
  renderParagraphLabel();
}

function swapPrompt() {
  const hasOutline = SECTIONS.some((s) => W.outline[s.key].trim());
  if (W.mode === "A" && hasOutline && !confirm("換一題會清空目前的大綱，確定嗎？")) return;
  pickPrompt();
  if (W.mode === "A") W.outline = { intro: "", body1: "", body2: "", conclusion: "" };
  resetTimer();
  saveDraft();
  render();
}

function clearCurrent() {
  if (!currentText().trim()) return;
  if (!confirm("清空目前寫的內容？")) return;
  if (W.mode === "A") W.outline = { intro: "", body1: "", body2: "", conclusion: "" };
  else W.paragraph = "";
  resetTimer();
  saveDraft();
  renderTasks();
  renderCount();
}

function saveRecord() {
  const text = currentText();
  const note = $("saveNote");
  if (!text.trim()) {
    note.textContent = W.mode === "A" ? "先寫一點關鍵字再儲存。" : "先寫一點內容再儲存。";
    note.hidden = false;
    return;
  }

  const entry = currentEntry();
  const record = {
    id: `w-${Date.now()}`,
    date: localDate(),
    createdAt: Date.now(),
    ...entry,
    words: countWords(text),
    seconds: Math.round(elapsedMs() / 1000),
  };
  const records = [record, ...loadRecords()].slice(0, RECORD_LIMIT);
  if (!save(STORE.records, records)) {
    note.textContent = "無法儲存（瀏覽器可能是無痕模式或空間不足），可以先按「複製」保存。";
    note.hidden = false;
    return;
  }

  if (W.mode === "A") {
    W.outline = { intro: "", body1: "", body2: "", conclusion: "" };
    W.outlineId = record.id; // ready for tomorrow's paragraph day
  } else {
    W.paragraph = "";
  }
  resetTimer();
  saveDraft();
  render();

  const { count } = streak();
  note.textContent =
    W.mode === "A"
      ? `已儲存！連續 ${count} 天。明天切到「B 段落日」就能用這份大綱寫一段。`
      : `已儲存！連續 ${count} 天。`;
  note.hidden = false;
}

function deleteRecord(id) {
  if (!confirm("刪除這筆練習紀錄？")) return;
  save(STORE.records, loadRecords().filter((r) => r.id !== id));
  if (W.outlineId === id) W.outlineId = outlines()[0]?.id || null;
  saveDraft();
  render();
}

function startToday() {
  $("practice").scrollIntoView({ behavior: "smooth", block: "start" });
  const first = W.mode === "A" ? document.querySelector(".w-keywords") : $("paragraph");
  if (first) first.focus({ preventScroll: true });
  startTimer();
}

// ─── Setup ────────────────────────────────────────────────────────────────────

function init() {
  const today = localDate();
  const day = new Date().getDay();
  const plan = WEEK_PLAN[day];

  // Today's prompt: keep it through the week, a new one on Monday
  const current = load(STORE.current, null);
  const known = current && WRITING_PROMPTS.some((p) => p.id === current.id);
  if (known && !(day === 1 && current.setOn < today)) W.promptId = current.id;
  else pickPrompt();

  const draft = load(STORE.draft, null);
  const hasDraftText = draft && (draft.paragraph?.trim() || Object.values(draft.outline || {}).some((v) => v.trim()));
  if (draft && (hasDraftText || draft.date === today)) {
    // Carry on where the learner left off
    Object.assign(W, {
      mode: draft.mode === "B" ? "B" : "A",
      outline: { intro: "", body1: "", body2: "", conclusion: "", ...draft.outline },
      outlineId: draft.outlineId ?? null,
      section: draft.section || "intro",
      paragraph: draft.paragraph || "",
    });
    if (W.outlineId && !outlines().some((r) => r.id === W.outlineId)) W.outlineId = outlines()[0]?.id || null;
  } else if (plan.mode) {
    // A new day: set things up the way the weekly rhythm suggests
    W.mode = plan.mode;
    W.section = plan.section || "intro";
    W.outlineId = outlines()[0]?.id || null;
  }
  // Today's suggested length when the learner is doing today's task, otherwise the mode's default
  const onPlan = plan.mode === W.mode && (W.mode === "A" || plan.section === W.section);
  setTimerLength(onPlan ? plan.minutes * 60 : defaultLength());

  $("todayPlan").textContent = `今天：${plan.text.split("｜")[1]}`;
  document.querySelector(`#weekTable tr[data-day="${day}"]`).dataset.today = "true";

  $("startBtn").addEventListener("click", startToday);
  $("swapBtn").addEventListener("click", swapPrompt);
  $("modeA").addEventListener("click", () => setMode("A"));
  $("modeB").addEventListener("click", () => setMode("B"));
  $("outlineSelect").addEventListener("change", (e) => {
    W.outlineId = e.target.value || null;
    saveDraft();
    renderPrompt();
    renderTasks();
  });
  $("paragraph").addEventListener("input", (e) => {
    W.paragraph = e.target.value;
    onType();
  });
  $("timerToggle").addEventListener("click", toggleTimer);
  $("timerReset").addEventListener("click", resetTimer);
  $("timerLength").addEventListener("change", (e) => setTimerLength(Number(e.target.value)));
  $("clearBtn").addEventListener("click", clearCurrent);
  $("saveBtn").addEventListener("click", saveRecord);
  $("copyBtn").addEventListener("click", async () => {
    if (!currentText().trim()) {
      flash($("copyBtn"), "還沒有內容");
      return;
    }
    await copyText(copyTextFor(currentEntry()));
    flash($("copyBtn"), "已複製");
  });

  const boxes = [...document.querySelectorAll("#checklist input")];
  const renderChecks = () => ($("checkCount").textContent = `${boxes.filter((b) => b.checked).length} / ${boxes.length}`);
  boxes.forEach((b) => b.addEventListener("change", renderChecks));
  $("checkReset").addEventListener("click", () => {
    boxes.forEach((b) => (b.checked = false));
    renderChecks();
  });
  renderChecks();

  render();
  setInterval(() => {
    if (W.timer.startedAt) renderTimer();
  }, 250);
}

window.addEventListener("DOMContentLoaded", init);
