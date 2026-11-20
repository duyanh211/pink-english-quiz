"use strict";

/*
 * Pink English 2.0
 * - Multi-turn, branching-ready conversation practice
 * - Naturalness scoring (0–2), Vietnamese feedback and phrase saving
 * - Existing Grammar / Vocabulary quiz sets remain available
 * - Progress is stored locally in the current browser
 */

const STORAGE_KEY = "pinkEnglish.profile.v2";
const QUIZ_SESSION_SIZE = 10;
const QUIZ_RANDOM_MODE = "pure"; // Uniform random sample without replacement inside each session.
const QUIZ_RESUME_MODE = "auto"; // Restore the saved session when the same quiz set is opened.
const state = {
  data: null,
  page: "home",
  activeFilter: "All",
  activeConversation: null,
  lastConversation: null,
  activeQuiz: null,
  profile: loadProfile(),
  wordDictionary: new Set(),
  wordsByFirstLetter: new Map(),
  wordDetails: {},
  wordDictionaryReady: false,
  wordChainTimer: null,
  dictionaryShardCache: new Map(),
  dictionaryGroupPromises: new Map(),
  dictionaryDetailsCache: {},
  dictionaryLookupPromises: new Map(),
  wordDetailRequestId: 0,
  memoryData: null,
  memoryGame: null,
  memorySelectedModeId: null,
  memoryTimerId: null,
  memoryMismatchTimerId: null,
  memoryFinishTimerId: null,
  memoryLastSetup: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function loadProfile() {
  const emptyProfile = {
    savedPhrases: [],
    history: [],
    quizSessions: {},
    wordChain: { activeGame: null, gamesPlayed: 0, totalPlayerWords: 0, bestChain: 0, history: [] },
    memoryMatch: { gamesPlayed: 0, totalPairsMatched: 0, bestMovesByMode: {}, history: [] }
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyProfile;
    const parsed = JSON.parse(raw);
    return {
      // Keep all data from the previous app version and add quiz sessions safely.
      savedPhrases: Array.isArray(parsed.savedPhrases) ? parsed.savedPhrases : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
      quizSessions: parsed.quizSessions && typeof parsed.quizSessions === "object" && !Array.isArray(parsed.quizSessions)
        ? parsed.quizSessions
        : {},
      wordChain: parsed.wordChain && typeof parsed.wordChain === "object" && !Array.isArray(parsed.wordChain)
        ? {
            activeGame: parsed.wordChain.activeGame && typeof parsed.wordChain.activeGame === "object" ? parsed.wordChain.activeGame : null,
            gamesPlayed: Number(parsed.wordChain.gamesPlayed) || 0,
            totalPlayerWords: Number(parsed.wordChain.totalPlayerWords) || 0,
            bestChain: Number(parsed.wordChain.bestChain) || 0,
            history: Array.isArray(parsed.wordChain.history) ? parsed.wordChain.history : []
          }
        : emptyProfile.wordChain,
      memoryMatch: parsed.memoryMatch && typeof parsed.memoryMatch === "object" && !Array.isArray(parsed.memoryMatch)
        ? {
            gamesPlayed: Number(parsed.memoryMatch.gamesPlayed) || 0,
            totalPairsMatched: Number(parsed.memoryMatch.totalPairsMatched) || 0,
            bestMovesByMode: parsed.memoryMatch.bestMovesByMode && typeof parsed.memoryMatch.bestMovesByMode === "object" ? parsed.memoryMatch.bestMovesByMode : {},
            history: Array.isArray(parsed.memoryMatch.history) ? parsed.memoryMatch.history : []
          }
        : emptyProfile.memoryMatch
    };
  } catch (error) {
    console.warn("Could not read saved learning progress:", error);
    return emptyProfile;
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
    try {
      await loadWordDictionary();
    } catch (dictionaryError) {
      console.warn("Word Chain dictionary could not be loaded:", dictionaryError);
      state.wordDictionaryReady = false;
      const status = $("#wordchain-dictionary-status");
      if (status) status.textContent = "Word Chain dictionary could not be loaded. Check that words.json is beside index.html.";
    }
    renderHome();
    renderPractice();
    renderSaved();
    renderProgress();
    renderWordChainHome();
    loadMemoryGameData();
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
  renderQuizResumeCards();
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
    const saved = getSavedQuizSession(set.id, set);
    const progressLabel = saved
      ? `Đang học dở · ${getAnsweredCount(saved)}/${saved.questionOrder.length} câu đã trả lời`
      : `Random ${Math.min(QUIZ_SESSION_SIZE, set.questions.length)} câu · Tự lưu tiến độ`;
    copy.appendChild(makeElement("span", "quiz-session-meta", progressLabel));

    const actions = makeElement("div", "quiz-row-actions");
    const button = makeElement("button", "button secondary small-button", saved ? "Continue" : `Start ${Math.min(QUIZ_SESSION_SIZE, set.questions.length)}`);
    button.type = "button";
    button.addEventListener("click", () => startQuiz(set.id));
    actions.appendChild(button);
    row.append(icon, copy, actions);
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

function getQuestionKey(question, index) {
  return String(question.id ?? `index-${index}`);
}

function shuffleArray(items) {
  const result = [...items];
  // Fisher–Yates gives each ordering an equal chance.
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function getAnsweredCount(session) {
  return Array.isArray(session?.answers) ? session.answers.filter(Boolean).length : 0;
}

function getSavedQuizSession(setId, set = null) {
  const session = state.profile.quizSessions?.[setId];
  if (!session || !Array.isArray(session.questionOrder) || !session.questionOrder.length || !Array.isArray(session.answers)) return null;
  if (set) {
    const currentKeys = new Set(set.questions.map((question, index) => getQuestionKey(question, index)));
    if (session.questionOrder.some(key => !currentKeys.has(String(key)))) return null;
  }
  return session;
}

function saveActiveQuizSession() {
  const quiz = state.activeQuiz;
  if (!quiz?.session || !quiz.setId) return;
  state.profile.quizSessions[quiz.setId] = {
    ...quiz.session,
    updatedAt: new Date().toISOString()
  };
  saveProfile();
}

function renderQuizResumeCards() {
  const section = $("#quiz-resume-section");
  const container = $("#quiz-resume-list");
  if (!section || !container) return;
  container.replaceChildren();
  const openSessions = getQuizSets()
    .map(set => ({ set, session: getSavedQuizSession(set.id, set) }))
    .filter(item => item.session);
  section.classList.toggle("hidden", openSessions.length === 0);

  openSessions.forEach(({ set, session }) => {
    const total = session.questionOrder.length;
    const answered = getAnsweredCount(session);
    const card = makeElement("div", "resume-card");
    const icon = makeElement("div", "feature-icon", set.id.toLowerCase().includes("grammar") ? "Aa" : "文");
    const copy = makeElement("div", "resume-card-copy");
    copy.append(
      makeElement("strong", "", set.title),
      makeElement("span", "", `${answered}/${total} câu đã trả lời · Tự động lưu`)
    );
    const track = makeElement("div", "small-track");
    const fill = makeElement("div");
    fill.style.width = `${Math.round(answered / Math.max(total, 1) * 100)}%`;
    track.appendChild(fill);
    copy.appendChild(track);
    const button = makeElement("button", "button secondary small-button", "Continue");
    button.type = "button";
    button.addEventListener("click", () => startQuiz(set.id));
    card.append(icon, copy, button);
    container.appendChild(card);
  });
}

function createQuizSession(set) {
  const count = Math.min(QUIZ_SESSION_SIZE, set.questions.length);
  const allKeys = set.questions.map((question, index) => getQuestionKey(question, index));
  // Pure random: no weighting by previous answers; no duplicates within this 10-question session.
  const randomizedKeys = QUIZ_RANDOM_MODE === "pure" ? shuffleArray(allKeys) : allKeys;
  const questionOrder = randomizedKeys.slice(0, count);
  return {
    setId: set.id,
    questionOrder,
    index: 0,
    answers: Array(count).fill(null),
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function getCurrentQuizQuestion(quiz) {
  const key = String(quiz.session.questionOrder[quiz.session.index]);
  return quiz.set.questions.find((question, index) => getQuestionKey(question, index) === key);
}

function getQuizScore(session) {
  return session.answers.reduce((total, answer) => total + (answer?.isCorrect ? 1 : 0), 0);
}

function startQuiz(setId) {
  const set = getQuizSets().find(item => item.id === setId);
  if (!set) return showToast("Không tìm thấy bộ câu hỏi.");

  // Auto-resume the stored session for this set. A new random sample is created only when none exists.
  let session = QUIZ_RESUME_MODE === "auto" ? getSavedQuizSession(setId, set) : null;
  if (!session) {
    session = createQuizSession(set);
    state.profile.quizSessions[setId] = session;
    saveProfile();
  } else {
    session.index = Math.min(Math.max(Number(session.index) || 0, 0), session.questionOrder.length - 1);
    session.answers = Array.from({ length: session.questionOrder.length }, (_, index) => session.answers[index] || null);
    state.profile.quizSessions[setId] = session;
  }

  state.activeQuiz = { setId, set, session, answered: false, score: getQuizScore(session) };
  state.lastQuizSetId = setId;
  renderQuizQuestion();
  renderPractice();
  renderHome();
  showPage("quiz", "practice");
}

function renderQuizQuestion() {
  const quiz = state.activeQuiz;
  if (!quiz) return;
  const session = quiz.session;
  const question = getCurrentQuizQuestion(quiz);
  if (!question) {
    delete state.profile.quizSessions[quiz.setId];
    saveProfile();
    state.activeQuiz = null;
    showToast("Không tìm thấy câu hỏi trong phiên học. Hãy bắt đầu lượt mới.");
    goToPractice();
    return;
  }

  const total = session.questionOrder.length;
  const answer = session.answers[session.index];
  const score = getQuizScore(session);
  quiz.answered = Boolean(answer);
  quiz.score = score;
  $("#quiz-set-title").textContent = quiz.set.title;
  $("#quiz-set-level").textContent = question.difficulty || question.level || quiz.set.level || "Practice";
  $("#quiz-counter").textContent = `${session.index + 1} / ${total}`;
  const completedSlots = session.index + (answer ? 1 : 0);
  $("#quiz-progress").style.width = `${completedSlots / total * 100}%`;
  $("#quiz-topic").textContent = `Quick practice · ${total} câu · Score: ${score}/${getAnsweredCount(session)}`;
  $("#quiz-save-note").textContent = "✓ Tiến độ được tự động lưu trên thiết bị này.";
  $("#quiz-question").textContent = question.question;

  const options = $("#quiz-options");
  options.replaceChildren();
  question.options.forEach((option, index) => {
    const button = makeElement("button", "choice-button quiz-option");
    button.type = "button";
    button.append(makeElement("span", "choice-letter", String.fromCharCode(65 + index)), makeElement("span", "choice-text", option));
    if (answer) {
      button.disabled = true;
      if (index === question.correctAnswer) button.classList.add("correct");
      if (index === answer.selectedIndex && !answer.isCorrect) button.classList.add("wrong");
    } else {
      button.addEventListener("click", () => answerQuiz(index));
    }
    options.appendChild(button);
  });

  const feedback = $("#quiz-feedback");
  feedback.classList.add("hidden");
  feedback.replaceChildren();
  if (answer) renderQuizFeedback(question, answer);
  saveActiveQuizSession();
}

function renderQuizFeedback(question, answer) {
  const feedback = $("#quiz-feedback");
  feedback.classList.remove("hidden");
  feedback.replaceChildren();
  const card = makeElement("div", "feedback-card");
  card.append(
    makeElement("div", `feedback-score ${answer.isCorrect ? "score-2" : "score-0"}`, answer.isCorrect ? "Correct answer" : `Correct: ${question.options[question.correctAnswer]}`),
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
  const next = makeElement("button", "button full", quizSessionIsLastQuestion() ? "Finish 10-question session →" : "Next question →");
  next.type = "button";
  next.style.marginTop = "13px";
  next.addEventListener("click", nextQuizQuestion);
  card.appendChild(next);
  feedback.appendChild(card);
}

function quizSessionIsLastQuestion() {
  const quiz = state.activeQuiz;
  return Boolean(quiz && quiz.session.index === quiz.session.questionOrder.length - 1);
}

function answerQuiz(selectedIndex) {
  const quiz = state.activeQuiz;
  if (!quiz || quiz.answered) return;
  const question = getCurrentQuizQuestion(quiz);
  if (!question || !Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > 2) return;
  const isCorrect = selectedIndex === question.correctAnswer;
  quiz.session.answers[quiz.session.index] = {
    questionId: getQuestionKey(question, quiz.set.questions.indexOf(question)),
    selectedIndex,
    isCorrect,
    answeredAt: new Date().toISOString()
  };
  quiz.answered = true;
  quiz.score = getQuizScore(quiz.session);
  saveActiveQuizSession();
  renderQuizQuestion();
  renderPractice();
  renderHome();
}

function nextQuizQuestion() {
  const quiz = state.activeQuiz;
  if (!quiz || !quiz.answered) return;
  if (quiz.session.index < quiz.session.questionOrder.length - 1) {
    quiz.session.index += 1;
    saveActiveQuizSession();
    renderQuizQuestion();
  } else {
    completeQuizSession();
  }
}

function completeQuizSession() {
  const quiz = state.activeQuiz;
  if (!quiz) return;
  const total = quiz.session.questionOrder.length;
  const score = getQuizScore(quiz.session);
  const percent = Math.round(score / total * 100);
  const record = {
    type: "quiz",
    setId: quiz.setId,
    title: quiz.set.title,
    category: quiz.set.title,
    score,
    maxScore: total,
    percent,
    totalQuestions: total,
    questionIds: [...quiz.session.questionOrder],
    completedAt: new Date().toISOString()
  };
  state.profile.history.unshift(record);
  state.profile.history = state.profile.history.slice(0, 100);
  delete state.profile.quizSessions[quiz.setId];
  state.lastQuizSetId = quiz.setId;
  state.activeQuiz = null;
  saveProfile();
  $("#quiz-final-score").textContent = `${score} / ${total}`;
  const caption = $("#quiz-result-caption");
  if (caption) caption.textContent = `10-question random session · ${percent}% accuracy`;
  renderProgress();
  renderHome();
  renderPractice();
  showPage("quiz-result", "practice");
}

function retryQuiz() {
  const setId = state.lastQuizSetId || state.activeQuiz?.setId;
  if (setId) startQuiz(setId);
}

function goToPractice() {
  renderPractice();
  showPage("practice", "practice");
}


// ==========================================
// WORD CHAIN — offline dictionary + local game
// ==========================================

const WORDCHAIN_START_WORDS = [
  "apple", "table", "orange", "house", "music", "friend", "book", "school", "water", "garden",
  "family", "travel", "happy", "people", "computer", "coffee", "bread", "dream", "story", "river",
  "energy", "yellow", "window", "flower", "night", "green", "earth", "team", "milk", "door"
];

function getWordChainProfile() {
  if (!state.profile.wordChain || typeof state.profile.wordChain !== "object") {
    state.profile.wordChain = { activeGame: null, gamesPlayed: 0, totalPlayerWords: 0, bestChain: 0, history: [] };
  }
  return state.profile.wordChain;
}

async function loadWordDictionary() {
  const response = await fetch("./words.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Không tải được words.json (HTTP ${response.status}).`);
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.words)) throw new Error("words.json thiếu mảng words.");

  const normalizedWords = [...new Set(payload.words
    .filter(word => typeof word === "string")
    .map(word => word.trim().toLowerCase())
    .filter(word => /^[a-z]{2,24}$/.test(word)))];

  if (normalizedWords.length < 1000) throw new Error("Từ điển có quá ít từ hợp lệ.");

  state.wordDictionary = new Set(normalizedWords);
  state.wordsByFirstLetter = new Map();
  for (const word of normalizedWords) {
    const letter = word[0];
    if (!state.wordsByFirstLetter.has(letter)) state.wordsByFirstLetter.set(letter, []);
    state.wordsByFirstLetter.get(letter).push(word);
  }
  state.wordDetails = payload.details && typeof payload.details === "object" ? payload.details : {};
  state.dictionaryDetailsCache = loadThichHocDetailCache();
  state.wordDictionaryReady = true;

  const status = $("#wordchain-dictionary-status");
  if (status) status.textContent = `Offline word validation ready · ${normalizedWords.length.toLocaleString("en-US")} words. Vietnamese meanings are looked up online on demand and cached on this device.`;
  const start = $("#wordchain-start");
  if (start) {
    start.disabled = false;
    start.textContent = "Start Word Chain →";
  }
}

// ---------------------------------------------------------------------------
// THICHHOC EN–VI DICTIONARY (lazy lookup; no 155k-entry download at startup)
// Source data: thichhoc-dict JSONL shards, CC BY-SA 4.0.
// The app keeps the original word list for offline gameplay and fetches only
// the relevant dictionary shards when a player asks for a word's meaning.
// ---------------------------------------------------------------------------
const THICHHOC_ENTRIES_BASE = "https://raw.githubusercontent.com/thichhoc-org/thichhoc-dict/main/dict-en-vi/data/entries/";
const THICHHOC_CACHE_KEY = "pinkEnglish.thichhocMeaningCache.v1";
const THICHHOC_CACHE_LIMIT = 1200;

const THICHHOC_POS_LABELS = {
  n: "Danh từ", v: "Động từ", adj: "Tính từ", adv: "Trạng từ",
  prep: "Giới từ", conj: "Liên từ", pron: "Đại từ", det: "Từ hạn định",
  intj: "Thán từ", abbr: "Từ viết tắt", phr: "Cụm từ"
};

// A small set of common irregular forms, plus regular suffix candidates below.
// These candidates help resolve entries whose inflection starts with a different
// letter from the dictionary headword (e.g. ran -> run).
const THICHHOC_IRREGULAR_BASES = {
  am: "be", is: "be", are: "be", was: "be", were: "be", been: "be", being: "be",
  has: "have", had: "have", having: "have",
  does: "do", did: "do", done: "do", doing: "do",
  went: "go", gone: "go", going: "go",
  ran: "run", running: "run",
  ate: "eat", eaten: "eat", eating: "eat",
  saw: "see", seen: "see", seeing: "see",
  spoke: "speak", spoken: "speak", speaking: "speak",
  wrote: "write", written: "write", writing: "write",
  took: "take", taken: "take", taking: "take",
  gave: "give", given: "give", giving: "give",
  came: "come", coming: "come",
  became: "become", become: "become",
  bought: "buy", buying: "buy",
  brought: "bring", bringing: "bring",
  thought: "think", thinking: "think",
  taught: "teach", teaching: "teach",
  caught: "catch", catching: "catch",
  made: "make", making: "make",
  knew: "know", known: "know", knowing: "know",
  found: "find", finding: "find",
  felt: "feel", feeling: "feel",
  left: "leave", leaving: "leave",
  kept: "keep", keeping: "keep",
  slept: "sleep", sleeping: "sleep",
  stood: "stand", standing: "stand",
  understood: "understand", understanding: "understand",
  broke: "break", broken: "break", breaking: "break",
  chose: "choose", chosen: "choose", choosing: "choose",
  drove: "drive", driven: "drive", driving: "drive",
  flew: "fly", flown: "fly", flying: "fly",
  grew: "grow", grown: "grow", growing: "grow",
  threw: "throw", thrown: "throw", throwing: "throw",
  drew: "draw", drawn: "draw", drawing: "draw",
  fell: "fall", fallen: "fall", falling: "fall",
  got: "get", gotten: "get", getting: "get",
  held: "hold", holding: "hold",
  met: "meet", meeting: "meet",
  paid: "pay", paying: "pay",
  read: "read", reading: "read",
  rode: "ride", ridden: "ride", riding: "ride",
  rose: "rise", risen: "rise", rising: "rise",
  sent: "send", sending: "send",
  shook: "shake", shaken: "shake", shaking: "shake",
  sang: "sing", sung: "sing", singing: "sing",
  sank: "sink", sunk: "sink", sinking: "sink",
  stole: "steal", stolen: "steal", stealing: "steal",
  swam: "swim", swum: "swim", swimming: "swim",
  wore: "wear", worn: "wear", wearing: "wear",
  won: "win", winning: "win",
  sold: "sell", selling: "sell",
  told: "tell", telling: "tell",
  sat: "sit", sitting: "sit",
  began: "begin", begun: "begin", beginning: "begin",
  drank: "drink", drunk: "drink", drinking: "drink",
  chose: "choose", chosen: "choose"
};

function loadThichHocDetailCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(THICHHOC_CACHE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.warn("Could not read cached dictionary meanings:", error);
    return {};
  }
}

function saveThichHocDetailCache(word, detail) {
  state.dictionaryDetailsCache[word] = detail;
  const keys = Object.keys(state.dictionaryDetailsCache);
  if (keys.length > THICHHOC_CACHE_LIMIT) {
    for (const oldKey of keys.slice(0, keys.length - THICHHOC_CACHE_LIMIT)) {
      delete state.dictionaryDetailsCache[oldKey];
    }
  }
  try {
    localStorage.setItem(THICHHOC_CACHE_KEY, JSON.stringify(state.dictionaryDetailsCache));
  } catch (error) {
    console.warn("Could not persist dictionary meaning cache:", error);
  }
}

async function fetchThichHocShard(filename) {
  if (state.dictionaryShardCache.has(filename)) return state.dictionaryShardCache.get(filename);

  const request = (async () => {
    const response = await fetch(`${THICHHOC_ENTRIES_BASE}${filename}`, { cache: "force-cache" });
    if (response.status === 404) return { missing: true, entries: [] };
    if (!response.ok) throw new Error(`Từ điển thichhoc trả về HTTP ${response.status} khi tải ${filename}.`);

    const text = await response.text();
    const entries = [];
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry && entry.lang === "en-vi" && entry.headword) entries.push(entry);
      } catch (error) {
        console.warn(`Bỏ qua một dòng JSONL không hợp lệ trong ${filename}.`, error);
      }
    }
    return { missing: false, entries };
  })();

  state.dictionaryShardCache.set(filename, request);
  try {
    return await request;
  } catch (error) {
    state.dictionaryShardCache.delete(filename); // Let the user retry after a transient network error.
    throw error;
  }
}

async function loadThichHocTierOneEntries() {
  const cacheKey = "__freq-tier1__";
  if (state.dictionaryGroupPromises.has(cacheKey)) return state.dictionaryGroupPromises.get(cacheKey);

  const promise = (async () => {
    const plain = await fetchThichHocShard("freq-tier1.jsonl");
    if (!plain.missing) return plain.entries;

    const all = [];
    for (let part = 1; part <= 10; part += 1) {
      const filename = `freq-tier1-${String(part).padStart(2, "0")}.jsonl`;
      const shard = await fetchThichHocShard(filename);
      if (shard.missing) break;
      all.push(...shard.entries);
    }
    return all;
  })();

  state.dictionaryGroupPromises.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    state.dictionaryGroupPromises.delete(cacheKey);
    throw error;
  }
}

async function loadThichHocGeneralLetter(letter) {
  const normalizedLetter = String(letter || "").toLowerCase();
  if (!/^[a-z]$/.test(normalizedLetter)) return [];
  const cacheKey = `general-${normalizedLetter}`;
  if (state.dictionaryGroupPromises.has(cacheKey)) return state.dictionaryGroupPromises.get(cacheKey);

  const promise = (async () => {
    const plain = await fetchThichHocShard(`${cacheKey}.jsonl`);
    if (!plain.missing) return plain.entries;

    const all = [];
    for (let part = 1; part <= 20; part += 1) {
      const filename = `${cacheKey}-${String(part).padStart(2, "0")}.jsonl`;
      const shard = await fetchThichHocShard(filename);
      if (shard.missing) break;
      all.push(...shard.entries);
    }
    return all;
  })();

  state.dictionaryGroupPromises.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    state.dictionaryGroupPromises.delete(cacheKey);
    throw error;
  }
}

function getDictionaryLookupCandidates(word) {
  const candidates = new Set([word]);
  const irregular = THICHHOC_IRREGULAR_BASES[word];
  if (irregular) candidates.add(irregular);

  if (word.length > 4) {
    if (/ies$/.test(word)) candidates.add(`${word.slice(0, -3)}y`);
    if (/ied$/.test(word)) candidates.add(`${word.slice(0, -3)}y`);
    if (/ves$/.test(word)) {
      candidates.add(`${word.slice(0, -3)}f`);
      candidates.add(`${word.slice(0, -3)}fe`);
    }
    if (/ing$/.test(word)) {
      const stem = word.slice(0, -3);
      candidates.add(stem);
      candidates.add(`${stem}e`);
      if (/(.)\1$/.test(stem)) candidates.add(stem.slice(0, -1));
    }
    if (/ed$/.test(word)) {
      const stem = word.slice(0, -2);
      candidates.add(stem);
      candidates.add(`${stem}e`);
      if (/(.)\1$/.test(stem)) candidates.add(stem.slice(0, -1));
    }
    if (/es$/.test(word)) candidates.add(word.slice(0, -2));
    if (/s$/.test(word)) candidates.add(word.slice(0, -1));
    if (/er$/.test(word)) {
      const stem = word.slice(0, -2);
      candidates.add(stem);
      candidates.add(`${stem}e`);
    }
    if (/est$/.test(word)) {
      const stem = word.slice(0, -3);
      candidates.add(stem);
      candidates.add(`${stem}e`);
    }
  }
  return [...candidates].filter(candidate => /^[a-z]{2,24}$/.test(candidate));
}

function entryMatchesWord(entry, word) {
  const headword = String(entry.headword || "").toLowerCase();
  if (headword === word) return true;
  const forms = [
    ...(Array.isArray(entry.inflections) ? entry.inflections : []),
    ...(Array.isArray(entry.variants) ? entry.variants : [])
  ].map(form => String(form).toLowerCase());
  // Never invent a relationship merely because a guessed stem exists:
  // the source entry must explicitly list the queried inflection/variant.
  return forms.includes(word);
}

function buildThichHocWordDetail(word, entries) {
  const uniqueEntries = [...new Map(entries.map(entry => [entry.id || `${entry.headword}:${entry.pos}`, entry])).values()];
  if (!uniqueEntries.length) return null;

  const meaningGroups = [];
  const byPos = new Map();
  const pronunciations = [];
  const examples = [];
  const englishGlosses = [];
  const matchedHeadwords = [];

  for (const entry of uniqueEntries) {
    const pos = String(entry.pos || "other");
    if (!byPos.has(pos)) {
      const group = { pos, label: THICHHOC_POS_LABELS[pos] || pos, senses: [] };
      byPos.set(pos, group);
      meaningGroups.push(group);
    }
    const group = byPos.get(pos);
    for (const sense of Array.isArray(entry.senses_vi) ? entry.senses_vi : []) {
      if (typeof sense === "string" && sense.trim() && !group.senses.includes(sense.trim())) group.senses.push(sense.trim());
    }
    if (entry.pron && !pronunciations.includes(entry.pron)) pronunciations.push(entry.pron);
    if (entry.headword && !matchedHeadwords.includes(entry.headword)) matchedHeadwords.push(entry.headword);
    for (const gloss of Array.isArray(entry.gloss_en) ? entry.gloss_en : []) {
      if (typeof gloss === "string" && gloss.trim() && !englishGlosses.includes(gloss.trim())) englishGlosses.push(gloss.trim());
    }
    for (const example of Array.isArray(entry.examples) ? entry.examples : []) {
      if (example && example.src && !examples.some(item => item.src === example.src)) {
        examples.push({ src: example.src, vi: example.vi || "" });
      }
    }
  }

  const allSenses = meaningGroups.flatMap(group => group.senses);
  if (!allSenses.length) return null;

  return {
    source: "thichhoc-dict",
    headword: matchedHeadwords[0] || word,
    query: word,
    pronunciation: pronunciations[0] || "",
    pronunciations,
    meaningGroups,
    englishGlosses: englishGlosses.slice(0, 3),
    examples: examples.slice(0, 2),
    reviewed: uniqueEntries.length > 0 && uniqueEntries.every(entry => entry.reviewed === true),
    isInflection: (matchedHeadwords[0] || word).toLowerCase() !== word,
    matchedHeadwords
  };
}

async function lookupThichHocWord(rawWord) {
  const word = String(rawWord || "").trim().toLowerCase();
  if (!/^[a-z]{2,24}$/.test(word)) return null;

  if (state.dictionaryDetailsCache[word]) return state.dictionaryDetailsCache[word];
  if (state.dictionaryLookupPromises.has(word)) return state.dictionaryLookupPromises.get(word);

  const promise = (async () => {
    const candidates = getDictionaryLookupCandidates(word);
    const matches = new Map();

    // Search the alphabetic group first. This keeps most lookups focused on
    // one or a few relevant letter shards instead of loading the common tier.
    const letters = [...new Set(candidates.map(candidate => candidate[0]))];
    const groups = await Promise.all(letters.map(letter => loadThichHocGeneralLetter(letter)));
    for (const entries of groups) {
      for (const entry of entries) {
        if (entryMatchesWord(entry, word)) matches.set(entry.id || `${entry.headword}:${entry.pos}`, entry);
      }
    }

    // Frequent headwords live in a separate tier-1 group. Only fetch it when
    // the relevant alphabetic group did not contain the requested word.
    if (!matches.size) {
      const tierOne = await loadThichHocTierOneEntries();
      for (const entry of tierOne) {
        if (entryMatchesWord(entry, word)) matches.set(entry.id || `${entry.headword}:${entry.pos}`, entry);
      }
    }

    const detail = buildThichHocWordDetail(word, [...matches.values()]);
    if (detail) saveThichHocDetailCache(word, detail);
    return detail;
  })();

  state.dictionaryLookupPromises.set(word, promise);
  try {
    return await promise;
  } finally {
    state.dictionaryLookupPromises.delete(word);
  }
}

function renderLegacyWordDetail(box, word, detail, listenButton) {
  box.append(
    makeElement("strong", "", detail?.meaning ? `${word} · ${detail.meaning}` : word),
    makeElement("p", "", detail?.example || "Từ hợp lệ trong danh sách offline.")
  );
  box.appendChild(listenButton);
}

async function renderWordChainWordDetail(word) {
  const box = $("#wordchain-word-detail");
  if (!box) return;
  const requestId = ++state.wordDetailRequestId;
  box.replaceChildren();
  box.classList.remove("hidden");

  const listen = makeElement("button", "wordchain-small-button", "▶ Listen");
  listen.type = "button";
  listen.addEventListener("click", () => speak(word));

  // Preserve the 61 hand-curated meanings already bundled with words.json.
  const localDetail = state.wordDetails[word];
  if (localDetail?.meaning) {
    renderLegacyWordDetail(box, word, localDetail, listen);
    return;
  }

  box.appendChild(makeElement("strong", "", word));
  box.appendChild(makeElement("p", "dictionary-loading", "Đang tra nghĩa tiếng Việt từ thichhoc-dict…"));
  box.appendChild(listen);

  try {
    const detail = await lookupThichHocWord(word);
    if (requestId !== state.wordDetailRequestId) return;
    box.replaceChildren();
    box.appendChild(makeElement("strong", "", detail?.headword || word));

    if (!detail) {
      box.appendChild(makeElement("p", "", "Từ này hợp lệ trong danh sách chơi offline, nhưng chưa tìm thấy mục từ tương ứng trong từ điển thichhoc-dict."));
      const retry = makeElement("button", "wordchain-small-button", "↻ Tra lại");
      retry.type = "button";
      retry.addEventListener("click", () => {
        delete state.dictionaryDetailsCache[word];
        state.dictionaryGroupPromises.clear();
        state.dictionaryShardCache.clear();
        renderWordChainWordDetail(word);
      });
      box.append(retry, listen);
      return;
    }

    if (detail.isInflection) {
      box.appendChild(makeElement("p", "dictionary-meta", `Dạng từ: ${word} → ${detail.headword}`));
    }
    const metaParts = [];
    if (detail.pronunciation) metaParts.push(detail.pronunciation);
    if (detail.meaningGroups?.length) metaParts.push(detail.meaningGroups.map(group => group.label).join(" · "));
    if (metaParts.length) box.appendChild(makeElement("p", "dictionary-meta", metaParts.join("  ·  ")));

    const sensesWrap = makeElement("div", "dictionary-senses");
    for (const group of detail.meaningGroups || []) {
      if (!group.senses.length) continue;
      const groupWrap = makeElement("div", "dictionary-sense-group");
      groupWrap.appendChild(makeElement("span", "dictionary-pos", group.label));
      groupWrap.appendChild(makeElement("p", "", group.senses.join("; ")));
      sensesWrap.appendChild(groupWrap);
    }
    if (sensesWrap.childElementCount) box.appendChild(sensesWrap);

    if (detail.englishGlosses?.length) {
      box.appendChild(makeElement("p", "dictionary-gloss", `English gloss: ${detail.englishGlosses.join("; ")}`));
    }
    if (detail.examples?.length) {
      const examplesWrap = makeElement("div", "dictionary-examples");
      examplesWrap.appendChild(makeElement("span", "dictionary-pos", "Ví dụ"));
      detail.examples.forEach(example => {
        const line = makeElement("p", "", example.src);
        examplesWrap.appendChild(line);
        if (example.vi) examplesWrap.appendChild(makeElement("p", "dictionary-example-vi", example.vi));
      });
      box.appendChild(examplesWrap);
    }

    box.appendChild(makeElement("p", "dictionary-quality-note", detail.reviewed
      ? "Nguồn từ điển: thichhoc-dict · mục từ đã được đánh dấu review."
      : "Bản dịch tham khảo từ thichhoc-dict; dữ liệu hiện ở trạng thái beta và chưa được con người kiểm duyệt."));
    box.appendChild(listen);
  } catch (error) {
    if (requestId !== state.wordDetailRequestId) return;
    console.warn("Thichhoc dictionary lookup failed:", error);
    box.replaceChildren();
    box.appendChild(makeElement("strong", "", word));
    box.appendChild(makeElement("p", "", "Từ đã hợp lệ trong danh sách offline, nhưng hiện chưa tải được nghĩa bổ sung. Hãy kết nối Internet rồi thử tra lại."));
    const retry = makeElement("button", "wordchain-small-button", "↻ Thử lại");
    retry.type = "button";
    retry.addEventListener("click", () => renderWordChainWordDetail(word));
    box.append(retry, listen);
  }
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function availableWordsFor(letter, usedWords) {
  const words = state.wordsByFirstLetter.get(letter) || [];
  return words.filter(word => !usedWords.has(word));
}

function makeWordChainGame(mode, difficulty) {
  const seeds = WORDCHAIN_START_WORDS.filter(word => state.wordDictionary.has(word) && availableWordsFor(word.at(-1), new Set([word])).length > 0);
  if (!seeds.length) throw new Error("Không tìm được từ bắt đầu phù hợp trong từ điển.");
  const seed = randomItem(seeds);
  return {
    id: `wc-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    mode,
    difficulty: mode === "solo" ? "solo" : difficulty,
    currentWord: seed,
    words: [{ word: seed, by: "start", at: new Date().toISOString() }],
    usedWords: [seed],
    currentTurn: "player",
    status: "playing",
    playerWords: 0,
    computerWords: 0,
    hintsUsed: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function startWordChainGame() {
  if (!state.wordDictionaryReady) return showToast("Từ điển chưa sẵn sàng. Hãy tải lại trang.");
  const mode = $("#wordchain-mode").value;
  const difficulty = $("#wordchain-difficulty").value;
  try {
    const game = makeWordChainGame(mode, difficulty);
    getWordChainProfile().activeGame = game;
    saveProfile();
    renderWordChainGame();
    showPage("wordchain", "wordchain");
  } catch (error) {
    showToast(error.message || "Không thể bắt đầu trò chơi.");
  }
}

function renderWordChainHome() {
  const profile = getWordChainProfile();
  const game = profile.activeGame;
  const resume = $("#wordchain-resume");
  if (resume) {
    resume.classList.toggle("hidden", !game || game.status !== "playing");
    if (game && game.status === "playing") {
      $("#wordchain-resume-title").textContent = game.mode === "computer" ? "Player vs Computer" : "Solo Practice";
      $("#wordchain-resume-meta").textContent = `${game.words.length} words in chain · Next letter: ${game.currentWord.at(-1).toUpperCase()} · Automatically saved`;
    }
  }
  $("#wordchain-games-played").textContent = String(profile.gamesPlayed);
  $("#wordchain-total-words").textContent = String(profile.totalPlayerWords);
  $("#wordchain-best-chain").textContent = String(profile.bestChain);

  const recent = $("#wordchain-recent");
  if (!recent) return;
  recent.replaceChildren();
  if (!profile.history.length) {
    recent.appendChild(makeElement("div", "empty-state", "Your completed Word Chain games will appear here."));
    return;
  }
  profile.history.slice(0, 5).forEach(record => {
    const row = makeElement("div", "saved-item");
    const copy = makeElement("div");
    const outcome = record.mode === "solo" ? "Solo practice" : record.winner === "player" ? "You won" : record.winner === "computer" ? "Computer won" : "Practice ended";
    copy.append(makeElement("strong", "", outcome), makeElement("p", "", `${record.totalWords} words · ${formatDate(record.completedAt)}`));
    row.append(copy, makeElement("span", "pill pink", `${record.playerWords} yours`));
    recent.appendChild(row);
  });
}

function resumeWordChainGame() {
  const game = getWordChainProfile().activeGame;
  if (!game || game.status !== "playing") return showToast("Không có ván chơi đang dở.");
  // Repair older or partial local states before rendering.
  if (!Array.isArray(game.words) || !Array.isArray(game.usedWords)) return showToast("Dữ liệu ván chơi không hợp lệ. Hãy bắt đầu ván mới.");
  renderWordChainGame();
  showPage("wordchain", "wordchain");
  if (game.currentTurn === "computer") scheduleWordChainBotMove();
}

function saveWordChainGame() {
  const profile = getWordChainProfile();
  if (state.wordChainTimer) {
    window.clearTimeout(state.wordChainTimer);
    state.wordChainTimer = null;
  }
  const game = profile.activeGame;
  if (!game || game.status !== "playing") return;
  game.updatedAt = new Date().toISOString();
  saveProfile();
}

function setWordChainMessage(message, type = "info") {
  const box = $("#wordchain-message");
  if (!box) return;
  box.className = `wordchain-feedback ${type}`;
  box.textContent = message;
}

function renderWordChainWordDetail(word) {
  const box = $("#wordchain-word-detail");
  if (!box) return;
  box.replaceChildren();
  const detail = state.wordDetails[word];
  box.classList.remove("hidden");
  const title = makeElement("strong", "", detail?.meaning ? `${word} · ${detail.meaning}` : word);
  const example = makeElement("p", "", detail?.example || "Từ này hợp lệ trong danh sách offline. Nghĩa chi tiết chưa có trong phần tra cứu rút gọn.");
  const tools = makeElement("div");
  tools.style.marginTop = "7px";
  const listen = makeElement("button", "wordchain-small-button", "▶ Listen");
  listen.type = "button";
  listen.addEventListener("click", () => speak(word));
  tools.appendChild(listen);
  box.append(title, example, tools);
}

function renderWordChainGame() {
  const game = getWordChainProfile().activeGame;
  if (!game) return;
  $("#wordchain-home").classList.add("hidden");
  $("#wordchain-game").classList.remove("hidden");
  $("#wordchain-result").classList.add("hidden");
  $("#wordchain-mode-label").textContent = game.mode === "computer" ? "PLAYER VS COMPUTER" : "SOLO PRACTICE";
  $("#wordchain-turn-label").textContent = game.currentTurn === "computer" ? "Computer is thinking…" : "Your turn.";
  $("#wordchain-difficulty-label").textContent = game.mode === "solo" ? "Solo" : game.difficulty[0].toUpperCase() + game.difficulty.slice(1);
  $("#wordchain-current-word").textContent = game.currentWord.toUpperCase();
  $("#wordchain-required-letter").textContent = game.currentWord.at(-1).toUpperCase();
  $("#wordchain-chain-count").textContent = `${game.words.length} ${game.words.length === 1 ? "word" : "words"} in the chain`;
  $("#wordchain-score-label").textContent = game.mode === "solo"
    ? `Your words: ${game.playerWords}`
    : `You: ${game.playerWords} · Computer: ${game.computerWords}`;

  const isPlayerTurn = game.currentTurn === "player";
  $("#wordchain-input").disabled = !isPlayerTurn;
  $("#wordchain-submit").disabled = !isPlayerTurn;
  $("#wordchain-hint").disabled = !isPlayerTurn;
  if (!isPlayerTurn) setWordChainMessage("Computer is choosing a word…", "info");
  else if (!$("#wordchain-message").textContent.trim()) setWordChainMessage(`Your word must start with ${game.currentWord.at(-1).toUpperCase()}.`, "info");

  const history = $("#wordchain-history");
  history.replaceChildren();
  game.words.forEach((entry, index) => {
    const token = makeElement("span", `wordchain-token ${entry.by}`, `${index + 1}. ${entry.word.toUpperCase()}`);
    history.appendChild(token);
  });
  const hints = $("#wordchain-hints");
  hints.classList.add("hidden");
  hints.replaceChildren();
  renderWordChainHome();
}

function validateWordChainInput(rawWord, game) {
  const word = String(rawWord || "").trim().toLowerCase();
  if (!word) return { valid: false, reason: "empty", message: "Enter a word to continue." };
  if (!/^[a-z]{2,24}$/.test(word)) return { valid: false, reason: "format", message: "Use 2–24 English letters only. No spaces, numbers or hyphens." };
  if (!state.wordDictionary.has(word)) return { valid: false, reason: "not-found", message: "This word is not in the built-in list. It may still be a valid English word; the offline list is not complete. Try another word for now." };
  const used = new Set(game.usedWords);
  if (used.has(word)) return { valid: false, reason: "duplicate", message: "That word has already been used in this chain." };
  const required = game.currentWord.at(-1);
  if (word[0] !== required) return { valid: false, reason: "letter", message: `The next word must start with ${required.toUpperCase()}.` };
  return { valid: true, word };
}

function submitWordChainWord(event) {
  event.preventDefault();
  const game = getWordChainProfile().activeGame;
  if (!game || game.status !== "playing" || game.currentTurn !== "player") return;
  const input = $("#wordchain-input");
  const result = validateWordChainInput(input.value, game);
  if (!result.valid) {
    setWordChainMessage(result.message, result.reason === "not-found" ? "warning" : "error");
    input.focus();
    return;
  }

  const word = result.word;
  game.words.push({ word, by: "player", at: new Date().toISOString() });
  game.usedWords.push(word);
  game.currentWord = word;
  game.playerWords += 1;
  input.value = "";
  const detail = state.wordDetails[word] || state.dictionaryDetailsCache[word];
  setWordChainMessage(detail?.meaning
    ? `Valid word! ${word} means “${detail.meaning}”.`
    : "Valid word! Looking up its Vietnamese meaning…", "success");
  renderWordChainWordDetail(word);
  saveWordChainGame();
  renderWordChainGame();

  if (game.mode === "computer") {
    const botCandidates = availableWordsFor(game.currentWord.at(-1), new Set(game.usedWords));
    if (!botCandidates.length) {
      finishWordChainGame("player", "The computer has no unused word for the required letter.");
      return;
    }
    game.currentTurn = "computer";
    saveWordChainGame();
    renderWordChainGame();
    scheduleWordChainBotMove();
  } else {
    const nextCandidates = availableWordsFor(game.currentWord.at(-1), new Set(game.usedWords));
    if (!nextCandidates.length) {
      finishWordChainGame("none", "No unused word in the built-in list starts with this letter. Your practice chain has reached its end.");
      return;
    }
    setWordChainMessage(detail ? `Valid word! ${detail.meaning}. Keep going — start with ${word.at(-1).toUpperCase()}.` : `Valid word! Next word starts with ${word.at(-1).toUpperCase()}.`, "success");
  }
}

function countNextMoves(word, usedWords) {
  // Fast count without filtering the full letter bucket for every bot candidate.
  const letter = word.at(-1);
  const bucket = state.wordsByFirstLetter.get(letter) || [];
  let usedCount = 0;
  for (const usedWord of usedWords) {
    if (usedWord[0] === letter) usedCount += 1;
  }
  return Math.max(0, bucket.length - usedCount);
}

function chooseComputerWord(candidates, difficulty, usedWords) {
  if (difficulty === "easy") return randomItem(candidates);
  const ranked = candidates.map(word => {
    const nextUsed = new Set(usedWords);
    nextUsed.add(word);
    return { word, nextMoves: countNextMoves(word, nextUsed) };
  }).sort((a, b) => a.nextMoves - b.nextMoves);

  if (difficulty === "hard") {
    // The hard bot chooses the tightest next-letter position, including a dead end when available.
    const best = ranked[0].nextMoves;
    return randomItem(ranked.filter(item => item.nextMoves === best)).word;
  }

  // Medium chooses from the lower half of continuation counts, but prefers leaving at least one move.
  const playable = ranked.filter(item => item.nextMoves > 0);
  const pool = playable.length ? playable : ranked;
  const topCount = Math.max(1, Math.ceil(pool.length * 0.4));
  return randomItem(pool.slice(0, topCount)).word;
}

function scheduleWordChainBotMove() {
  if (state.wordChainTimer) window.clearTimeout(state.wordChainTimer);
  state.wordChainTimer = window.setTimeout(playWordChainBotMove, 500);
}

function playWordChainBotMove() {
  state.wordChainTimer = null;
  const game = getWordChainProfile().activeGame;
  if (!game || game.status !== "playing" || game.currentTurn !== "computer") return;
  const candidates = availableWordsFor(game.currentWord.at(-1), new Set(game.usedWords));
  if (!candidates.length) {
    finishWordChainGame("player", "The computer could not find an unused word. You win!");
    return;
  }
  const word = chooseComputerWord(candidates, game.difficulty, new Set(game.usedWords));
  game.words.push({ word, by: "computer", at: new Date().toISOString() });
  game.usedWords.push(word);
  game.currentWord = word;
  game.computerWords += 1;
  game.currentTurn = "player";
  const playerCandidates = availableWordsFor(game.currentWord.at(-1), new Set(game.usedWords));
  saveWordChainGame();
  renderWordChainGame();
  if (!playerCandidates.length) {
    finishWordChainGame("computer", `The built-in list has no unused word beginning with ${word.at(-1).toUpperCase()}. The computer wins this round.`);
    return;
  }
  const detail = state.wordDetails[word] || state.dictionaryDetailsCache[word];
  setWordChainMessage(detail?.meaning
    ? `Computer played ${word.toUpperCase()} — ${detail.meaning}. Your turn: ${word.at(-1).toUpperCase()}.`
    : `Computer played ${word.toUpperCase()}. Looking up its meaning… Your turn: ${word.at(-1).toUpperCase()}.`, "info");
  renderWordChainWordDetail(word);
  saveWordChainGame();
}

function showWordChainHints() {
  const game = getWordChainProfile().activeGame;
  if (!game || game.currentTurn !== "player") return;
  const candidates = availableWordsFor(game.currentWord.at(-1), new Set(game.usedWords));
  const hints = $("#wordchain-hints");
  hints.replaceChildren();
  if (!candidates.length) {
    hints.classList.remove("hidden");
    hints.appendChild(makeElement("span", "wordchain-muted", "No unused word in the built-in list starts with this letter."));
    return;
  }
  game.hintsUsed += 1;
  const sample = shuffleArray(candidates).slice(0, Math.min(4, candidates.length));
  sample.forEach(word => {
    const button = makeElement("button", "wordchain-hint-chip", word.toUpperCase());
    button.type = "button";
    button.addEventListener("click", () => {
      $("#wordchain-input").value = word;
      $("#wordchain-input").focus();
    });
    hints.appendChild(button);
  });
  hints.classList.remove("hidden");
  setWordChainMessage("Here are a few possible words. Choose one or enter a different valid word.", "info");
}

function finishWordChainGame(winner, reason) {
  const profile = getWordChainProfile();
  const game = profile.activeGame;
  if (!game || game.status !== "playing") return;
  game.status = "finished";
  const record = {
    mode: game.mode,
    difficulty: game.difficulty,
    winner,
    reason,
    playerWords: game.playerWords,
    computerWords: game.computerWords,
    totalWords: game.words.length,
    chain: game.words.map(item => item.word),
    completedAt: new Date().toISOString()
  };
  profile.gamesPlayed += 1;
  profile.totalPlayerWords += game.playerWords;
  profile.bestChain = Math.max(profile.bestChain, game.words.length);
  profile.history.unshift(record);
  profile.history = profile.history.slice(0, 30);
  profile.activeGame = null;
  saveProfile();

  $("#wordchain-result-icon").textContent = winner === "player" ? "🏆" : winner === "computer" ? "✦" : "✓";
  $("#wordchain-result-title").textContent = winner === "player" ? "You win!" : winner === "computer" ? "Good game!" : "Nice practice!";
  $("#wordchain-result-copy").textContent = reason;
  $("#wordchain-result-score").textContent = `${game.playerWords} words`;
  $("#wordchain-result-caption").textContent = game.mode === "solo" ? `${game.words.length} words in your chain` : `${game.playerWords} yours · ${game.computerWords} computer`;
  const chain = $("#wordchain-result-chain");
  chain.replaceChildren();
  game.words.forEach((entry, index) => chain.appendChild(makeElement("span", `wordchain-token ${entry.by}`, `${index + 1}. ${entry.word.toUpperCase()}`)));

  $("#wordchain-game").classList.add("hidden");
  $("#wordchain-home").classList.add("hidden");
  $("#wordchain-result").classList.remove("hidden");
  renderWordChainHome();
}

function exitWordChainGame() {
  saveWordChainGame();
  $("#wordchain-game").classList.add("hidden");
  $("#wordchain-result").classList.add("hidden");
  $("#wordchain-home").classList.remove("hidden");
  renderWordChainHome();
  showPage("wordchain", "wordchain");
}

function endWordChainPractice() {
  const game = getWordChainProfile().activeGame;
  if (!game) return;
  finishWordChainGame("none", "You ended this practice session. Your word chain has been recorded.");
}

function goToWordChainHome() {
  $("#wordchain-game").classList.add("hidden");
  $("#wordchain-result").classList.add("hidden");
  $("#wordchain-home").classList.remove("hidden");
  renderWordChainHome();
  showPage("wordchain", "wordchain");
}



// ==========================================
// MEMORY MATCH — 3 banks × 60 pairs
// Fixed 140-second timer; difficulty changes pair count.
// ==========================================

const MEMORY_SECONDS_PER_ROUND = 140;
const MEMORY_DIFFICULTY_FALLBACK = [
  { id: "easy", title: "Easy", pairCount: 4, seconds: MEMORY_SECONDS_PER_ROUND, description: "4 cặp · 140 giây · Dễ bắt đầu" },
  { id: "medium", title: "Medium", pairCount: 8, seconds: MEMORY_SECONDS_PER_ROUND, description: "8 cặp · 140 giây · Thử thách vừa phải" },
  { id: "hard", title: "Hard", pairCount: 12, seconds: MEMORY_SECONDS_PER_ROUND, description: "12 cặp · 140 giây · Thử thách cao hơn" }
];

function getMemoryDifficultyOptions() {
  const configured = Array.isArray(state.memoryData?.difficulty) ? state.memoryData.difficulty : [];
  return configured.length ? configured : MEMORY_DIFFICULTY_FALLBACK;
}

function getMemoryPairCount(difficulty) {
  const count = Number(difficulty?.pairCount);
  return Number.isInteger(count) && count > 0 ? count : 4;
}

function validateMemoryData(data) {
  if (!data || !Array.isArray(data.modes) || data.modes.length < 3) {
    throw new Error("games.json cần có ít nhất 3 chế độ Memory Match.");
  }
  const configuredDifficulties = Array.isArray(data.difficulty) && data.difficulty.length
    ? data.difficulty
    : MEMORY_DIFFICULTY_FALLBACK;
  const maximumPairCount = Math.max(...configuredDifficulties.map(getMemoryPairCount));
  configuredDifficulties.forEach(difficulty => {
    if (!difficulty.id || !difficulty.title || getMemoryPairCount(difficulty) < 1) {
      throw new Error("Cấu hình độ khó Memory Match không hợp lệ.");
    }
  });
  data.modes.forEach(mode => {
    if (!mode.id || !mode.title || !Array.isArray(mode.pairs) || mode.pairs.length < maximumPairCount) {
      throw new Error(`Chế độ ${mode.title || "không tên"} cần ít nhất ${maximumPairCount} cặp dữ liệu.`);
    }
    const ids = new Set();
    mode.pairs.forEach(pair => {
      if (!pair.id || typeof pair.left !== "string" || typeof pair.right !== "string" || !pair.left.trim() || !pair.right.trim()) {
        throw new Error(`Một cặp trong chế độ ${mode.title} thiếu id/left/right.`);
      }
      if (ids.has(pair.id)) throw new Error(`ID cặp ${pair.id} bị trùng trong ${mode.title}.`);
      ids.add(pair.id);
    });
  });
}

async function loadMemoryGameData() {
  const status = $("#memory-match-status");
  const grid = $("#memory-mode-grid");
  if (grid) grid.replaceChildren(makeElement("p", "memory-muted", "Loading matching modes…"));
  try {
    const response = await fetch("./games.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Không tải được games.json (HTTP ${response.status}).`);
    const data = await response.json();
    validateMemoryData(data);
    state.memoryData = data;
    if (status) status.classList.add("hidden");
    renderMemoryMatchHome();
  } catch (error) {
    console.error("Memory Match data error:", error);
    if (status) {
      status.textContent = `Không thể tải games.json: ${error.message} Hãy kiểm tra file games.json đã được commit ở cùng thư mục với index.html chưa.`;
      status.classList.remove("hidden");
    }
    if (grid) grid.replaceChildren(makeElement("p", "memory-muted", "Memory Match data is unavailable."));
  }
}

function shuffleItems(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function getMemoryProfile() {
  if (!state.profile.memoryMatch) {
    state.profile.memoryMatch = { gamesPlayed: 0, totalPairsMatched: 0, bestMovesByMode: {}, history: [] };
  }
  return state.profile.memoryMatch;
}

function renderMemoryMatchHome() {
  const grid = $("#memory-mode-grid");
  if (!grid) return;
  grid.replaceChildren();
  if (!state.memoryData) {
    grid.appendChild(makeElement("p", "memory-muted", "Loading matching modes…"));
    return;
  }
  const icons = { "word-meaning": "Aa", "synonyms": "≈", "phrase-situation": "☷" };
  state.memoryData.modes.forEach(mode => {
    const button = makeElement("button", "memory-mode-card");
    button.type = "button";
    button.dataset.action = "memory-select-mode";
    button.dataset.modeId = mode.id;
    const symbol = makeElement("span", "memory-mode-symbol", icons[mode.id] || "✦");
    const title = makeElement("strong", "", mode.title);
    const description = makeElement("span", "", mode.description || "Match the related cards.");
    const count = makeElement("span", "pill pink", `${mode.pairs.length} pairs in bank · 4 / 8 / 12 per round`);
    button.append(symbol, title, description, count);
    grid.appendChild(button);
  });

  const profile = getMemoryProfile();
  $("#memory-games-played").textContent = String(profile.gamesPlayed);
  $("#memory-total-pairs").textContent = String(profile.totalPairsMatched);
  const bestValues = Object.values(profile.bestMovesByMode).filter(value => Number.isFinite(value) && value > 0);
  $("#memory-best-moves").textContent = bestValues.length ? String(Math.min(...bestValues)) : "—";
}

function selectMemoryMode(modeId) {
  if (!state.memoryData) return showToast("Memory Match data is still loading.");
  const mode = state.memoryData.modes.find(item => item.id === modeId);
  if (!mode) return showToast("Không tìm thấy chế độ này.");
  state.memorySelectedModeId = modeId;
  $("#memory-match-home").classList.add("hidden");
  $("#memory-match-play").classList.add("hidden");
  $("#memory-match-result").classList.add("hidden");
  $("#memory-match-difficulty").classList.remove("hidden");
  $("#memory-selected-mode-title").textContent = mode.title;
  $("#memory-selected-mode-description").textContent = `${mode.description || "Find all matching pairs."} Kho có ${mode.pairs.length} cặp; Easy chọn 4, Medium 8, Hard 12 cặp. Mỗi lượt có 140 giây.`;
  renderMemoryDifficultyOptions();
  showPage("memory-match", "home");
}

function renderMemoryDifficultyOptions() {
  const container = $("#memory-difficulty-grid");
  container.replaceChildren();
  const difficulties = getMemoryDifficultyOptions();
  difficulties.forEach(difficulty => {
    const button = makeElement("button", "memory-difficulty-card");
    button.type = "button";
    button.dataset.action = "memory-start";
    button.dataset.difficultyId = difficulty.id;
    button.append(
      makeElement("strong", "", difficulty.title),
      makeElement("span", "", difficulty.description || `${getMemoryPairCount(difficulty)} pairs · 140 seconds`)
    );
    container.appendChild(button);
  });
}

function startMemoryMatch(difficultyId) {
  const mode = state.memoryData?.modes.find(item => item.id === state.memorySelectedModeId);
  const difficulties = getMemoryDifficultyOptions();
  const difficulty = difficulties.find(item => item.id === difficultyId);
  if (!mode || !difficulty) return showToast("Không thể bắt đầu trò chơi. Vui lòng chọn lại chế độ.");
  const pairCount = getMemoryPairCount(difficulty);
  if (mode.pairs.length < pairCount) return showToast(`Chế độ này cần ít nhất ${pairCount} cặp từ.`);

  clearMemoryTimers();
  const selectedPairs = shuffleItems(mode.pairs).slice(0, pairCount);
  const cards = [];
  selectedPairs.forEach(pair => {
    cards.push({ cardId: `${pair.id}-left`, pairId: pair.id, side: "left", text: pair.left, pair });
    cards.push({ cardId: `${pair.id}-right`, pairId: pair.id, side: "right", text: pair.right, pair });
  });

  const seconds = MEMORY_SECONDS_PER_ROUND;
  state.memoryLastSetup = { modeId: mode.id, difficultyId: difficulty.id };
  state.memoryGame = {
    modeId: mode.id,
    modeTitle: mode.title,
    difficultyId: difficulty.id,
    difficultyTitle: difficulty.title,
    pairCount,
    seconds,
    deadline: Date.now() + seconds * 1000,
    startedAt: Date.now(),
    cards: shuffleItems(cards),
    matchedPairIds: new Set(),
    flippedCardIds: [],
    moves: 0,
    mismatches: 0,
    locked: false,
    ended: false
  };

  $("#memory-match-home").classList.add("hidden");
  $("#memory-match-difficulty").classList.add("hidden");
  $("#memory-match-result").classList.add("hidden");
  $("#memory-match-play").classList.remove("hidden");
  $("#memory-mode-label").textContent = mode.title.toUpperCase();
  $("#memory-game-title").textContent = "Memory Match";
  $("#memory-difficulty-label").textContent = difficulty.title;
  $("#memory-feedback").classList.add("hidden");
  $("#memory-feedback").replaceChildren();
  renderMemoryBoard();
  updateMemoryStats();
  showPage("memory-match", "home");
  tickMemoryTimer();
  state.memoryTimerId = window.setInterval(tickMemoryTimer, 250);
}

function renderMemoryBoard() {
  const game = state.memoryGame;
  const board = $("#memory-board");
  if (!game || !board) return;
  board.replaceChildren();
  game.cards.forEach(card => {
    const matched = game.matchedPairIds.has(card.pairId);
    const flipped = matched || game.flippedCardIds.includes(card.cardId);
    const button = makeElement("button", `memory-card${flipped ? " is-flipped" : ""}${matched ? " is-matched" : ""}`);
    button.type = "button";
    button.dataset.action = "memory-flip-card";
    button.dataset.cardId = card.cardId;
    button.disabled = matched || game.locked || game.flippedCardIds.includes(card.cardId);
    button.setAttribute("aria-label", flipped ? card.text : "Hidden memory card");
    const inner = makeElement("span", "memory-card-inner");
    const back = makeElement("span", "memory-card-face memory-card-back", "p.");
    const front = makeElement("span", "memory-card-face memory-card-front", card.text);
    inner.append(back, front);
    button.appendChild(inner);
    board.appendChild(button);
  });
}

function updateMemoryStats() {
  const game = state.memoryGame;
  if (!game) return;
  $("#memory-matched-count").textContent = `${game.matchedPairIds.size} / ${game.pairCount}`;
  $("#memory-moves-count").textContent = String(game.moves);
}

function formatClock(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safe / 60);
  const remaining = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function tickMemoryTimer() {
  const game = state.memoryGame;
  if (!game || game.ended) return;
  const remainingMs = Math.max(0, game.deadline - Date.now());
  const remaining = remainingMs / 1000;
  $("#memory-time-left").textContent = formatClock(remaining);
  const percent = Math.max(0, (remainingMs / (game.seconds * 1000)) * 100);
  const fill = $("#memory-timer-fill");
  fill.style.width = `${percent}%`;
  fill.classList.toggle("warning", remaining <= 15);
  if (remainingMs <= 0) finishMemoryMatch("timeout");
}

function showMemoryFeedback(pair, success) {
  const panel = $("#memory-feedback");
  panel.replaceChildren();
  panel.classList.remove("hidden", "success");
  if (success) panel.classList.add("success");
  panel.appendChild(makeElement("strong", "", success ? "✓ Match found!" : "Not a match — try again."));
  if (success) {
    const line = makeElement("p", "", `${pair.left}  ↔  ${pair.right}`);
    panel.appendChild(line);
    if (pair.explanation) panel.appendChild(makeElement("p", "", pair.explanation));
    if (pair.example) panel.appendChild(makeElement("p", "memory-example", pair.example));
    const listenButton = makeElement("button", "wordchain-small-button", "▶ Listen");
    listenButton.type = "button";
    listenButton.addEventListener("click", () => speak(pair.left));
    panel.appendChild(listenButton);
  } else {
    panel.appendChild(makeElement("p", "", "Hai thẻ chưa khớp. Hãy ghi nhớ vị trí và thử lại."));
  }
}

function flipMemoryCard(cardId) {
  const game = state.memoryGame;
  if (!game || game.ended || game.locked || game.flippedCardIds.length >= 2) return;
  const card = game.cards.find(item => item.cardId === cardId);
  if (!card || game.matchedPairIds.has(card.pairId) || game.flippedCardIds.includes(cardId)) return;

  game.flippedCardIds.push(cardId);
  renderMemoryBoard();
  if (game.flippedCardIds.length < 2) return;

  game.moves += 1;
  updateMemoryStats();
  const first = game.cards.find(item => item.cardId === game.flippedCardIds[0]);
  const second = game.cards.find(item => item.cardId === game.flippedCardIds[1]);

  if (first.pairId === second.pairId) {
    game.matchedPairIds.add(first.pairId);
    game.flippedCardIds = [];
    renderMemoryBoard();
    updateMemoryStats();
    showMemoryFeedback(first.pair, true);
    if (game.matchedPairIds.size === game.pairCount) {
      state.memoryFinishTimerId = window.setTimeout(() => finishMemoryMatch("completed"), 850);
    }
  } else {
    game.mismatches += 1;
    game.locked = true;
    showMemoryFeedback(null, false);
    state.memoryMismatchTimerId = window.setTimeout(() => {
      if (!state.memoryGame || state.memoryGame !== game || game.ended) return;
      game.flippedCardIds = [];
      game.locked = false;
      renderMemoryBoard();
    }, 850);
  }
}

function clearMemoryTimers() {
  if (state.memoryTimerId) window.clearInterval(state.memoryTimerId);
  if (state.memoryMismatchTimerId) window.clearTimeout(state.memoryMismatchTimerId);
  if (state.memoryFinishTimerId) window.clearTimeout(state.memoryFinishTimerId);
  state.memoryTimerId = null;
  state.memoryMismatchTimerId = null;
  state.memoryFinishTimerId = null;
}

function finishMemoryMatch(reason) {
  const game = state.memoryGame;
  if (!game || game.ended) return;
  game.ended = true;
  clearMemoryTimers();
  const matched = game.matchedPairIds.size;
  const completed = reason === "completed";
  const timeLeft = Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000));
  const accuracy = game.moves ? Math.round((matched / game.moves) * 100) : 0;
  const record = {
    modeId: game.modeId,
    difficultyId: game.difficultyId,
    pairsMatched: matched,
    totalPairs: game.pairCount,
    moves: game.moves,
    mismatches: game.mismatches,
    timeLeft,
    completed,
    playedAt: new Date().toISOString()
  };
  const profile = getMemoryProfile();
  profile.gamesPlayed += 1;
  profile.totalPairsMatched += matched;
  const previousBest = Number(profile.bestMovesByMode[game.modeId]);
  if (completed && (!previousBest || game.moves < previousBest)) {
    profile.bestMovesByMode[game.modeId] = game.moves;
  }
  profile.history.unshift(record);
  profile.history = profile.history.slice(0, 30);
  saveProfile();

  $("#memory-result-icon").textContent = completed ? "🏆" : "✦";
  $("#memory-result-title").textContent = completed ? "All pairs found!" : "Time's up!";
  $("#memory-result-copy").textContent = completed
    ? `Bạn đã ghép đủ ${game.pairCount} cặp trong chế độ ${game.modeTitle} (${game.difficultyTitle}).`
    : `Bạn đã ghép được ${matched} trên ${game.pairCount} cặp. Thử lại để cải thiện nhé!`;
  $("#memory-result-pairs").textContent = `${matched} / ${game.pairCount} pairs`;
  $("#memory-result-caption").textContent = completed ? "Completed before the timer ended" : "Matched pairs before time ran out";
  $("#memory-result-moves").textContent = String(game.moves);
  $("#memory-result-time").textContent = formatClock(timeLeft);
  $("#memory-result-accuracy").textContent = `${accuracy}%`;

  $("#memory-match-play").classList.add("hidden");
  $("#memory-match-result").classList.remove("hidden");
  renderMemoryMatchHome();
}

function showMemoryMatchHome() {
  clearMemoryTimers();
  state.memoryGame = null;
  $("#memory-match-home").classList.remove("hidden");
  $("#memory-match-difficulty").classList.add("hidden");
  $("#memory-match-play").classList.add("hidden");
  $("#memory-match-result").classList.add("hidden");
  renderMemoryMatchHome();
  showPage("memory-match", "home");
}

function exitMemoryMatch() {
  const game = state.memoryGame;
  if (game && !game.ended && (game.moves > 0 || game.flippedCardIds.length > 0)) {
    const leave = window.confirm("Exit this round? Your current matching progress will not be saved.");
    if (!leave) return;
  }
  showMemoryMatchHome();
}

function replayMemoryMatch() {
  if (!state.memoryLastSetup) return showMemoryMatchHome();
  state.memorySelectedModeId = state.memoryLastSetup.modeId;
  startMemoryMatch(state.memoryLastSetup.difficultyId);
}

function handleAction(action, actionButton = null) {
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
    case "go-wordchain":
      renderWordChainHome();
      $("#wordchain-home").classList.remove("hidden");
      $("#wordchain-game").classList.add("hidden");
      $("#wordchain-result").classList.add("hidden");
      showPage("wordchain", "wordchain");
      break;
    case "resume-wordchain": resumeWordChainGame(); break;
    case "exit-wordchain": exitWordChainGame(); break;
    case "end-wordchain": endWordChainPractice(); break;
    case "new-wordchain":
      goToWordChainHome();
      startWordChainGame();
      break;
    case "back-wordchain-home": goToWordChainHome(); break;
    case "go-memory-match":
      state.memoryGame = null;
      clearMemoryTimers();
      showMemoryMatchHome();
      break;
    case "memory-select-mode": selectMemoryMode(actionButton?.dataset.modeId); break;
    case "memory-start": startMemoryMatch(actionButton?.dataset.difficultyId); break;
    case "memory-flip-card": flipMemoryCard(actionButton?.dataset.cardId); break;
    case "memory-back-modes": showMemoryMatchHome(); break;
    case "memory-exit": exitMemoryMatch(); break;
    case "memory-replay": replayMemoryMatch(); break;
  }
}

document.addEventListener("click", event => {
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    handleAction(actionButton.dataset.action, actionButton);
    return;
  }
  const navButton = event.target.closest("[data-nav]");
  if (navButton) {
    const destination = navButton.dataset.nav;
    if (destination === "practice") goToPractice();
    else if (destination === "saved") { renderSaved(); showPage("saved", "saved"); }
    else if (destination === "progress") { renderProgress(); showPage("progress", "progress"); }
    else if (destination === "wordchain") {
      renderWordChainHome();
      $("#wordchain-home").classList.remove("hidden");
      $("#wordchain-game").classList.add("hidden");
      $("#wordchain-result").classList.add("hidden");
      showPage("wordchain", "wordchain");
    }
    else { renderHome(); showPage("home", "home"); }
  }
});

const wordChainForm = $("#wordchain-form");
if (wordChainForm) wordChainForm.addEventListener("submit", submitWordChainWord);
const wordChainStart = $("#wordchain-start");
if (wordChainStart) wordChainStart.addEventListener("click", startWordChainGame);
const wordChainHint = $("#wordchain-hint");
if (wordChainHint) wordChainHint.addEventListener("click", showWordChainHints);
const wordChainMode = $("#wordchain-mode");
if (wordChainMode) wordChainMode.addEventListener("change", () => {
  const difficulty = $("#wordchain-difficulty");
  difficulty.disabled = wordChainMode.value === "solo";
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    saveActiveQuizSession();
    saveWordChainGame();
  } else if (state.memoryGame) {
    tickMemoryTimer();
  }
});
window.addEventListener("pagehide", () => {
  saveActiveQuizSession();
  saveWordChainGame();
});

loadData();
