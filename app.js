"use strict";

/*
 * Pink English 2.0
 * - Multi-turn, branching-ready conversation practice
 * - Naturalness scoring (0–2), Vietnamese feedback and phrase saving
 * - Existing Grammar / Vocabulary quiz sets remain available
 * - Progress is stored locally in the current browser
 */

const STORAGE_KEY = "pinkEnglish.profile.v2";
const state = {
  data: null,
  page: "home",
  activeFilter: "All",
  activeConversation: null,
  lastConversation: null,
  activeQuiz: null,
  profile: loadProfile()
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function loadProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { savedPhrases: [], history: [] };
    const parsed = JSON.parse(raw);
    return {
      savedPhrases: Array.isArray(parsed.savedPhrases) ? parsed.savedPhrases : [],
      history: Array.isArray(parsed.history) ? parsed.history : []
    };
  } catch (error) {
    console.warn("Could not read saved learning progress:", error);
    return { savedPhrases: [], history: [] };
  }
}

function saveProfile() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.profile));
  } catch (error) {
    console.warn("Could not save learning progress:", error);
    showToast("Không thể lưu tiến độ. Bộ nhớ trình duyệt có thể đã đầy.");
  }
}

function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2200);
}

function showPage(pageName, navName = pageName) {
  state.page = pageName;
  $$(".page").forEach(page => page.classList.toggle("active", page.id === `page-${pageName}`));
  $$(".nav-button").forEach(button => button.classList.toggle("active", button.dataset.nav === navName));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function speak(text) {
  if (!("speechSynthesis" in window)) {
    showToast("Trình duyệt này chưa hỗ trợ đọc văn bản.");
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 0.92;
  window.speechSynthesis.speak(utterance);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function categoryIcon(category) {
  const icons = {
    "Daily Life": "☀",
    "Food & Shopping": "☕",
    "Social Life": "✦",
    "Workplace": "▤",
    "Travel": "↗",
    "Business": "◫"
  };
  return icons[category] || "✧";
}

function validateData(data) {
  if (!data || !Array.isArray(data.sets)) {
    throw new Error("questions.json cần có mảng sets.");
  }
  data.sets.forEach((set, setIndex) => {
    if (!set.id || !set.title || !Array.isArray(set.questions)) {
      throw new Error(`Bộ câu hỏi ${setIndex + 1} thiếu id, title hoặc questions.`);
    }
    set.questions.forEach((question, questionIndex) => {
      const valid = typeof question.question === "string" &&
        Array.isArray(question.options) && question.options.length === 3 &&
        question.options.every(option => typeof option === "string") &&
        Number.isInteger(question.correctAnswer) && question.correctAnswer >= 0 && question.correctAnswer <= 2 &&
        typeof question.explanation === "string";
      if (!valid) throw new Error(`Câu ${questionIndex + 1} trong bộ ${set.title} không hợp lệ.`);
    });
  });

  if (!Array.isArray(data.conversations)) {
    throw new Error("questions.json cần có mảng conversations.");
  }
  data.conversations.forEach((conversation, conversationIndex) => {
    if (!conversation.id || !conversation.title || !conversation.startAt || !conversation.nodes) {
      throw new Error(`Tình huống ${conversationIndex + 1} thiếu thông tin cơ bản.`);
    }
    if (!conversation.nodes[conversation.startAt]) {
      throw new Error(`Tình huống ${conversation.title} có startAt không tồn tại.`);
    }
    Object.entries(conversation.nodes).forEach(([nodeId, node]) => {
      if (!node.speaker || !node.line || !Array.isArray(node.choices) || node.choices.length !== 3) {
        throw new Error(`Lượt ${nodeId} trong ${conversation.title} cần speaker, line và đúng 3 choices.`);
      }
      node.choices.forEach(choice => {
        if (typeof choice.text !== "string" || ![0, 1, 2].includes(choice.score) || typeof choice.feedback !== "string") {
          throw new Error(`Một lựa chọn trong ${conversation.title} thiếu text, score hoặc feedback.`);
        }
        if (choice.next !== null && choice.next !== undefined && !conversation.nodes[choice.next]) {
          throw new Error(`Liên kết next trong ${conversation.title} trỏ tới lượt không tồn tại.`);
        }
      });
    });
  });
}

async function loadData() {
  const homeScenarios = $("#home-scenarios");
  homeScenarios.replaceChildren(makeElement("p", "muted small", "Đang tải nội dung…"));
  try {
    const response = await fetch("./questions.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Không tải được questions.json (HTTP ${response.status}).`);
    const data = await response.json();
    validateData(data);
    state.data = data;
    renderHome();
    renderPractice();
    renderSaved();
    renderProgress();
  } catch (error) {
    console.error("Pink English data error:", error);
    homeScenarios.replaceChildren();
    const message = makeElement("div", "notice", `Không thể tải dữ liệu: ${error.message} Hãy kiểm tra questions.json đã được commit lên GitHub cùng thư mục với index.html chưa.`);
    homeScenarios.appendChild(message);
  }
}

function getQuizSets() {
  if (!state.data) return [];
  return state.data.sets.filter(set => !String(set.id).toLowerCase().includes("conversation"));
}

function renderHome() {
  if (!state.data) return;
  const completed = state.profile.history.filter(item => item.type === "conversation");
  const avg = completed.length
    ? Math.round(completed.reduce((sum, item) => sum + (item.percent || 0), 0) / completed.length)
    : null;
  $("#home-completed").textContent = String(completed.length);
  $("#home-saved").textContent = String(state.profile.savedPhrases.length);
  $("#home-accuracy").textContent = avg === null ? "—" : `${avg}%`;
  $("#header-streak").textContent = `${completed.length} conversations completed`;

  const container = $("#home-scenarios");
  container.replaceChildren();
  state.data.conversations.slice(0, 2).forEach(conversation => {
    container.appendChild(createScenarioCard(conversation));
  });
}

function createScenarioCard(conversation) {
  const card = makeElement("button", "scenario-card");
  card.type = "button";
  card.addEventListener("click", () => startConversation(conversation.id));

  const top = makeElement("div", "scenario-top");
  top.append(makeElement("span", "scenario-symbol", categoryIcon(conversation.category)));
  top.append(makeElement("span", "pill pink", conversation.level || "A1"));

  const title = makeElement("h3", "", conversation.title);
  const description = makeElement("p", "", conversation.goal || conversation.setting);
  const meta = makeElement("div", "scenario-meta");
  const minutes = makeElement("span", "", `◷ ${conversation.estimatedMinutes || 4} min`);
  const category = makeElement("span", "", conversation.category || "Conversation");
  meta.append(minutes, category);
  card.append(top, title, description, meta);
  return card;
}

function renderPractice() {
  if (!state.data) return;
  const categories = ["All", ...new Set(state.data.conversations.map(item => item.category).filter(Boolean))];
  const filterContainer = $("#category-filters");
  filterContainer.replaceChildren();
  categories.forEach(category => {
    const button = makeElement("button", `filter-chip${state.activeFilter === category ? " active" : ""}`, category);
    button.type = "button";
    button.addEventListener("click", () => {
      state.activeFilter = category;
      renderPractice();
    });
    filterContainer.appendChild(button);
  });

  const library = $("#conversation-library");
  library.replaceChildren();
  const filtered = state.activeFilter === "All"
    ? state.data.conversations
    : state.data.conversations.filter(item => item.category === state.activeFilter);
  if (!filtered.length) {
    library.appendChild(makeElement("div", "empty-state", "Chưa có tình huống trong chủ đề này."));
  } else {
    filtered.forEach(item => library.appendChild(createScenarioCard(item)));
  }

  const quizList = $("#quiz-set-list");
  quizList.replaceChildren();
  getQuizSets().forEach(set => {
    const row = makeElement("div", "quiz-row");
    const icon = makeElement("div", "feature-icon", set.id.toLowerCase().includes("grammar") ? "Aa" : "文");
    const copy = makeElement("div", "quiz-row-copy");
    copy.append(makeElement("h3", "", set.title), makeElement("p", "", `${set.questions.length} câu · ${set.level || "A1–C1"}`));
    const button = makeElement("button", "button secondary small-button", "Practice");
    button.type = "button";
    button.addEventListener("click", () => startQuiz(set.id));
    row.append(icon, copy, button);
    quizList.appendChild(row);
  });
}

function startConversation(conversationId) {
  const scenario = state.data.conversations.find(item => item.id === conversationId);
  if (!scenario) return showToast("Không tìm thấy tình huống này.");
  state.activeConversation = {
    scenario,
    nodeId: scenario.startAt,
    turnIndex: 0,
    score: 0,
    answers: [],
    transcript: [],
    awaitingContinue: false,
    lastChoice: null,
    nextNodeId: null
  };
  renderConversation();
  showPage("conversation", "practice");
}

function getReachableTurnCount(scenario) {
  // Follow the first available path. Current content uses a consistent turn count across branches.
  let id = scenario.startAt;
  const seen = new Set();
  let count = 0;
  while (id && scenario.nodes[id] && !seen.has(id)) {
    seen.add(id);
    count += 1;
    const first = scenario.nodes[id].choices[0];
    id = first ? first.next : null;
  }
  return count || Object.keys(scenario.nodes).length;
}

function renderBubble(entry) {
  const isUser = entry.role === "user";
  const line = makeElement("div", `chat-line${isUser ? " user" : ""}`);
  const avatar = makeElement("div", "avatar", isUser ? "You" : (entry.speaker || "?").slice(0, 1));
  const wrap = makeElement("div", "bubble-wrap");
  const speaker = makeElement("span", "speaker-name", isUser ? "You" : entry.speaker);
  const bubble = makeElement("div", "bubble", entry.text);
  wrap.append(speaker, bubble);
  if (!isUser) {
    const tools = makeElement("div", "bubble-tools");
    const listen = makeElement("button", "listen-button", "▶ Listen");
    listen.type = "button";
    listen.addEventListener("click", () => speak(entry.text));
    tools.appendChild(listen);
    wrap.appendChild(tools);
  }
  line.append(avatar, wrap);
  return line;
}

function renderConversation() {
  const active = state.activeConversation;
  if (!active) return;
  const scenario = active.scenario;
  const total = getReachableTurnCount(scenario);
  const node = scenario.nodes[active.nodeId];
  $("#conversation-category").textContent = (scenario.category || "Conversation").toUpperCase();
  $("#conversation-title").textContent = scenario.title;
  $("#conversation-level").textContent = scenario.level || "A1";
  $("#conversation-setting").textContent = scenario.setting || "Practice this everyday situation.";
  $("#conversation-goal").textContent = scenario.goal || "Choose a natural response.";
  $("#conversation-step-label").textContent = `Turn ${Math.min(active.turnIndex + 1, total)} of ${total}`;
  $("#conversation-progress").style.width = `${Math.min(active.turnIndex / total * 100, 100)}%`;

  const log = $("#conversation-log");
  log.replaceChildren();
  active.transcript.forEach(entry => log.appendChild(renderBubble(entry)));

  const currentTurn = $("#current-turn");
  const feedbackBox = $("#conversation-feedback");
  feedbackBox.classList.add("hidden");
  feedbackBox.replaceChildren();
  currentTurn.classList.remove("hidden");

  if (active.awaitingContinue) {
    currentTurn.classList.add("hidden");
    feedbackBox.classList.remove("hidden");
    feedbackBox.appendChild(createConversationFeedback(active.lastChoice));
  } else {
    log.appendChild(renderBubble({ role: "other", speaker: node.speaker, text: node.line }));
    const choiceList = $("#conversation-choices");
    choiceList.replaceChildren();
    node.choices.forEach((choice, index) => {
      const button = makeElement("button", "choice-button");
      button.type = "button";
      const letter = makeElement("span", "choice-letter", String.fromCharCode(65 + index));
      const text = makeElement("span", "choice-text", choice.text);
      button.append(letter, text);
      button.addEventListener("click", () => selectConversationChoice(index));
      choiceList.appendChild(button);
    });
  }
  log.scrollTop = log.scrollHeight;
}

function createConversationFeedback(choice) {
  const card = makeElement("div", "feedback-card");
  const top = makeElement("div", "feedback-top");
  const scoreLabel = choice.score === 2 ? "Most natural" : choice.score === 1 ? "Understandable" : "Try another wording";
  const scoreClass = `score-${choice.score}`;
  top.append(makeElement("span", `feedback-score ${scoreClass}`, `${scoreLabel} · ${choice.score}/2`));
  top.append(makeElement("span", "pill", choice.tone || "Feedback"));
  card.append(top, makeElement("p", "", choice.feedback));

  if (choice.phrase) {
    const phraseBox = makeElement("div", "phrase-box");
    phraseBox.append(
      makeElement("span", "label", "Useful expression"),
      makeElement("strong", "", choice.phrase),
      makeElement("span", "", choice.translation || "")
    );
    card.appendChild(phraseBox);
  }

  const actions = makeElement("div", "feedback-actions");
  const save = makeElement("button", "button secondary small-button", "♡ Save expression");
  save.type = "button";
  save.addEventListener("click", () => savePhrase(choice));
  const next = makeElement("button", "button small-button", choice.next ? "Continue conversation →" : "Finish conversation →");
  next.type = "button";
  next.addEventListener("click", continueConversation);
  actions.append(save, next);
  card.appendChild(actions);
  return card;
}

function selectConversationChoice(choiceIndex) {
  const active = state.activeConversation;
  if (!active || active.awaitingContinue) return;
  const node = active.scenario.nodes[active.nodeId];
  const choice = node.choices[choiceIndex];
  if (!choice) return;

  active.transcript.push({ role: "other", speaker: node.speaker, text: node.line });
  active.transcript.push({ role: "user", speaker: "You", text: choice.text });
  active.transcript.push({ role: "other", speaker: active.scenario.otherSpeaker || node.speaker, text: choice.nextReply || "" });
  active.score += choice.score;
  active.answers.push({ nodeId: active.nodeId, score: choice.score, choiceText: choice.text, phrase: choice.phrase || "", translation: choice.translation || "" });
  active.lastChoice = choice;
  active.nextNodeId = choice.next ?? null;
  active.awaitingContinue = true;
  renderConversation();
}

function savePhrase(choice) {
  if (!choice || !choice.phrase) return showToast("Lựa chọn này chưa có cụm từ để lưu.");
  const scenario = state.activeConversation?.scenario || state.lastConversation?.scenario;
  const duplicate = state.profile.savedPhrases.some(item => item.phrase.toLowerCase() === choice.phrase.toLowerCase());
  if (duplicate) return showToast("Cụm từ này đã có trong Saved.");
  state.profile.savedPhrases.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    phrase: choice.phrase,
    translation: choice.translation || "",
    context: scenario ? scenario.title : "Conversation practice",
    savedAt: new Date().toISOString()
  });
  saveProfile();
  renderHome();
  renderSaved();
  renderProgress();
  showToast("Đã lưu cụm từ vào Saved.");
}

function continueConversation() {
  const active = state.activeConversation;
  if (!active || !active.awaitingContinue) return;
  if (!active.nextNodeId) {
    finishConversation();
    return;
  }
  active.nodeId = active.nextNodeId;
  active.turnIndex += 1;
  active.awaitingContinue = false;
  active.lastChoice = null;
  active.nextNodeId = null;
  renderConversation();
}

function finishConversation() {
  const active = state.activeConversation;
  if (!active) return;
  const maxScore = active.answers.length * 2;
  const percent = maxScore ? Math.round(active.score / maxScore * 100) : 0;
  const record = {
    type: "conversation",
    scenarioId: active.scenario.id,
    title: active.scenario.title,
    category: active.scenario.category,
    score: active.score,
    maxScore,
    percent,
    turns: active.answers.length,
    completedAt: new Date().toISOString()
  };
  state.profile.history.unshift(record);
  state.profile.history = state.profile.history.slice(0, 100);
  saveProfile();
  state.lastConversation = active;
  state.activeConversation = null;
  renderConversationResult(record, active);
  renderHome();
  renderSaved();
  renderProgress();
  showPage("conversation-result", "practice");
}

function renderConversationResult(record, active) {
  $("#result-title").textContent = record.percent >= 85 ? "Beautifully done!" : record.percent >= 60 ? "Nice progress!" : "Good practice!";
  $("#result-subtitle").textContent = `${record.title} · ${record.turns} turns completed`;
  $("#result-score").textContent = `${record.score} / ${record.maxScore}`;
  $("#result-score-caption").textContent = `Naturalness score · ${record.percent}%`;
  const stats = $("#result-stats");
  stats.replaceChildren();
  [
    [String(record.turns), "Turns"],
    [`${record.percent}%`, "Score"],
    [String(new Set(active.answers.map(answer => answer.phrase).filter(Boolean)).size), "Expressions"]
  ].forEach(([value, label]) => {
    const box = makeElement("div", "summary-stat");
    box.append(makeElement("strong", "", value), makeElement("span", "", label));
    stats.appendChild(box);
  });
  const phrases = $("#result-phrases");
  phrases.replaceChildren();
  const unique = [...new Map(active.answers.filter(item => item.phrase).map(item => [item.phrase, item])).values()];
  if (!unique.length) phrases.appendChild(makeElement("div", "empty-state", "No expressions were collected in this conversation."));
  unique.forEach(item => {
    const row = makeElement("div", "saved-item");
    const copy = makeElement("div");
    copy.append(makeElement("strong", "", item.phrase), makeElement("p", "", item.translation));
    const button = makeElement("button", "button secondary small-button", "Save");
    button.type = "button";
    button.addEventListener("click", () => savePhrase(item));
    row.append(copy, button);
    phrases.appendChild(row);
  });
}

function renderSaved() {
  const container = $("#saved-phrases");
  if (!container) return;
  container.replaceChildren();
  if (!state.profile.savedPhrases.length) {
    const empty = makeElement("div", "empty-state");
    empty.append(makeElement("div", "empty-icon", "♡"), makeElement("strong", "", "Your phrasebook is empty"), makeElement("p", "small", "Save expressions while practicing a conversation. They'll appear here."));
    container.appendChild(empty);
    return;
  }
  state.profile.savedPhrases.forEach(item => {
    const row = makeElement("div", "saved-item");
    const copy = makeElement("div");
    copy.append(makeElement("strong", "", item.phrase), makeElement("p", "", `${item.translation || ""}${item.context ? ` · ${item.context}` : ""}`));
    const actions = makeElement("div");
    actions.style.display = "flex";
    actions.style.gap = "7px";
    const listen = makeElement("button", "icon-button", "▶");
    listen.type = "button";
    listen.title = "Listen";
    listen.addEventListener("click", () => speak(item.phrase));
    const remove = makeElement("button", "remove-button", "×");
    remove.type = "button";
    remove.title = "Remove phrase";
    remove.addEventListener("click", () => removeSavedPhrase(item.id));
    actions.append(listen, remove);
    row.append(copy, actions);
    container.appendChild(row);
  });
}

function removeSavedPhrase(id) {
  state.profile.savedPhrases = state.profile.savedPhrases.filter(item => item.id !== id);
  saveProfile();
  renderSaved();
  renderHome();
  renderProgress();
  showToast("Đã xóa cụm từ khỏi Saved.");
}

function renderProgress() {
  const conversations = state.profile.history.filter(item => item.type === "conversation");
  const average = conversations.length
    ? Math.round(conversations.reduce((sum, item) => sum + item.percent, 0) / conversations.length)
    : null;
  $("#progress-completed").textContent = String(conversations.length);
  $("#progress-average").textContent = average === null ? "—" : `${average}%`;
  $("#progress-saved").textContent = String(state.profile.savedPhrases.length);

  const categoryContainer = $("#category-progress");
  categoryContainer.replaceChildren();
  const categories = [...new Set((state.data?.conversations || []).map(item => item.category))];
  categories.forEach(category => {
    const records = conversations.filter(item => item.category === category);
    const avg = records.length ? Math.round(records.reduce((sum, item) => sum + item.percent, 0) / records.length) : 0;
    const item = makeElement("div", "progress-item");
    const top = makeElement("div", "progress-item-top");
    top.append(makeElement("strong", "", category), makeElement("span", "", records.length ? `${records.length} completed · ${avg}% avg.` : "Not started yet"));
    const track = makeElement("div", "small-track");
    const fill = makeElement("div");
    fill.style.width = `${avg}%`;
    track.appendChild(fill);
    item.append(top, track);
    categoryContainer.appendChild(item);
  });

  const historyContainer = $("#progress-history");
  historyContainer.replaceChildren();
  if (!state.profile.history.length) {
    historyContainer.appendChild(makeElement("div", "empty-state", "Your completed conversations and quizzes will appear here."));
  } else {
    state.profile.history.slice(0, 8).forEach(item => {
      const row = makeElement("div", "saved-item");
      const copy = makeElement("div");
      copy.append(makeElement("strong", "", item.title || "Quick quiz"), makeElement("p", "", `${item.category || "Practice"} · ${formatDate(item.completedAt)}`));
      const score = makeElement("span", "pill pink", `${item.percent}%`);
      row.append(copy, score);
      historyContainer.appendChild(row);
    });
  }
}

function startQuiz(setId) {
  const set = getQuizSets().find(item => item.id === setId);
  if (!set) return showToast("Không tìm thấy bộ câu hỏi.");
  state.activeQuiz = { set, index: 0, score: 0, answered: false };
  renderQuizQuestion();
  showPage("quiz", "practice");
}

function renderQuizQuestion() {
  const quiz = state.activeQuiz;
  if (!quiz) return;
  const question = quiz.set.questions[quiz.index];
  $("#quiz-set-title").textContent = quiz.set.title;
  $("#quiz-set-level").textContent = question.difficulty || quiz.set.level || "Practice";
  $("#quiz-counter").textContent = `${quiz.index + 1} / ${quiz.set.questions.length}`;
  $("#quiz-progress").style.width = `${quiz.index / quiz.set.questions.length * 100}%`;
  $("#quiz-topic").textContent = `Score: ${quiz.score}`;
  $("#quiz-question").textContent = question.question;
  const options = $("#quiz-options");
  options.replaceChildren();
  question.options.forEach((option, index) => {
    const button = makeElement("button", "choice-button quiz-option");
    button.type = "button";
    button.append(makeElement("span", "choice-letter", String.fromCharCode(65 + index)), makeElement("span", "choice-text", option));
    button.addEventListener("click", () => answerQuiz(index));
    options.appendChild(button);
  });
  $("#quiz-feedback").classList.add("hidden");
  $("#quiz-feedback").replaceChildren();
  quiz.answered = false;
}

function answerQuiz(selectedIndex) {
  const quiz = state.activeQuiz;
  if (!quiz || quiz.answered) return;
  quiz.answered = true;
  const question = quiz.set.questions[quiz.index];
  const buttons = $$(".quiz-option", $("#quiz-options"));
  buttons.forEach(button => { button.disabled = true; });
  buttons[question.correctAnswer]?.classList.add("correct");
  if (selectedIndex === question.correctAnswer) quiz.score += 1;
  else buttons[selectedIndex]?.classList.add("wrong");

  const feedback = $("#quiz-feedback");
  feedback.classList.remove("hidden");
  const card = makeElement("div", "feedback-card");
  card.append(
    makeElement("div", `feedback-score ${selectedIndex === question.correctAnswer ? "score-2" : "score-0"}`, selectedIndex === question.correctAnswer ? "Correct answer" : `Correct: ${question.options[question.correctAnswer]}`),
    makeElement("p", "", question.explanation)
  );
  if (question.grammarNote) {
    const note = makeElement("div", "note-card");
    note.append(makeElement("h4", "", "Công thức / cấu trúc cần nhớ"));
    note.append(makeElement("p", "", `CÔNG THỨC\n${question.grammarNote.formula}`));
    note.append(makeElement("p", "", `CÁCH DÙNG\n${question.grammarNote.use}`));
    if (question.grammarNote.signals) note.append(makeElement("p", "", `DẤU HIỆU\n${question.grammarNote.signals}`));
    card.appendChild(note);
  }
  const next = makeElement("button", "button full", quiz.index === quiz.set.questions.length - 1 ? "See results →" : "Next question →");
  next.type = "button";
  next.style.marginTop = "13px";
  next.addEventListener("click", nextQuizQuestion);
  card.appendChild(next);
  feedback.appendChild(card);
  $("#quiz-topic").textContent = `Score: ${quiz.score}`;
}

function nextQuizQuestion() {
  const quiz = state.activeQuiz;
  if (!quiz || !quiz.answered) return;
  if (quiz.index < quiz.set.questions.length - 1) {
    quiz.index += 1;
    renderQuizQuestion();
  } else {
    const total = quiz.set.questions.length;
    const percent = Math.round(quiz.score / total * 100);
    state.profile.history.unshift({
      type: "quiz",
      title: quiz.set.title,
      category: quiz.set.title,
      score: quiz.score,
      maxScore: total,
      percent,
      completedAt: new Date().toISOString()
    });
    state.profile.history = state.profile.history.slice(0, 100);
    saveProfile();
    $("#quiz-final-score").textContent = `${quiz.score} / ${total}`;
    renderProgress();
    renderHome();
    showPage("quiz-result", "practice");
  }
}

function retryQuiz() {
  if (!state.activeQuiz) return;
  startQuiz(state.activeQuiz.set.id);
}

function goToPractice() {
  renderPractice();
  showPage("practice", "practice");
}

function handleAction(action) {
  switch (action) {
    case "go-practice": goToPractice(); break;
    case "go-quiz-library": goToPractice(); setTimeout(() => $("#quiz-library").scrollIntoView({ behavior: "smooth", block: "start" }), 40); break;
    case "start-featured": {
      const featured = state.data?.conversations.find(item => item.id === "coffee-shop-a2") || state.data?.conversations[0];
      if (featured) startConversation(featured.id);
      break;
    }
    case "back-to-practice": goToPractice(); break;
    case "restart-conversation": {
      const scenarioId = state.lastConversation?.scenario.id;
      if (scenarioId) startConversation(scenarioId);
      break;
    }
    case "retry-quiz": retryQuiz(); break;
  }
}

document.addEventListener("click", event => {
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    handleAction(actionButton.dataset.action);
    return;
  }
  const navButton = event.target.closest("[data-nav]");
  if (navButton) {
    const destination = navButton.dataset.nav;
    if (destination === "practice") goToPractice();
    else if (destination === "saved") { renderSaved(); showPage("saved", "saved"); }
    else if (destination === "progress") { renderProgress(); showPage("progress", "progress"); }
    else { renderHome(); showPage("home", "home"); }
  }
});

loadData();
