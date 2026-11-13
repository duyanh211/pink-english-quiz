"use strict";

// ==========================================
// PINK ENGLISH QUIZ - GAME LOGIC
// Reads question data from questions.json.
// Displays a formula/structure card when a question includes grammarNote.
// ==========================================

const state = {
    sets: [],
    currentSet: null,
    currentQuestionIndex: 0,
    score: 0,
    answered: false
};

const elements = {
    homeScreen: document.getElementById("home-screen"),
    quizScreen: document.getElementById("quiz-screen"),
    resultScreen: document.getElementById("result-screen"),
    setList: document.getElementById("set-list"),
    questionNumber: document.getElementById("question-number"),
    score: document.getElementById("score"),
    progress: document.getElementById("progress"),
    question: document.getElementById("question"),
    options: document.getElementById("options"),
    explanation: document.getElementById("explanation"),
    explanationText: document.getElementById("explanation-text"),
    nextButton: document.getElementById("next-button"),
    finalScore: document.getElementById("final-score"),
    resultMessage: document.getElementById("result-message"),
    retryButton: document.getElementById("retry-button"),
    homeButton: document.getElementById("home-button")
};

async function loadQuestions() {
    try {
        const response = await fetch("./questions.json", { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Không tải được questions.json (HTTP ${response.status}).`);
        }

        const data = await response.json();
        if (!data || !Array.isArray(data.sets) || data.sets.length === 0) {
            throw new Error("File JSON không có danh sách sets hợp lệ.");
        }

        data.sets.forEach((set, setIndex) => {
            if (!set.id || !set.title || !Array.isArray(set.questions) || set.questions.length === 0) {
                throw new Error(`Bộ câu hỏi thứ ${setIndex + 1} bị thiếu id, title hoặc questions.`);
            }

            set.questions.forEach((q, questionIndex) => {
                const valid =
                    typeof q.question === "string" && q.question.trim() !== "" &&
                    Array.isArray(q.options) && q.options.length === 3 &&
                    q.options.every(option => typeof option === "string" && option.trim() !== "") &&
                    Number.isInteger(q.correctAnswer) && q.correctAnswer >= 0 && q.correctAnswer < 3 &&
                    typeof q.explanation === "string" && q.explanation.trim() !== "";

                if (!valid) {
                    throw new Error(`Câu ${questionIndex + 1} trong bộ "${set.title}" có dữ liệu không hợp lệ.`);
                }

                if (q.grammarNote && (
                    typeof q.grammarNote.formula !== "string" ||
                    typeof q.grammarNote.use !== "string"
                )) {
                    throw new Error(`Phần công thức của câu ${questionIndex + 1} trong bộ "${set.title}" không hợp lệ.`);
                }
            });
        });

        state.sets = data.sets;
        renderSetList();
    } catch (error) {
        console.error("Question loading error:", error);
        elements.setList.textContent = "Không thể tải câu hỏi. Hãy kiểm tra questions.json và tải lại trang.";
    }
}

function showScreen(screenId) {
    [elements.homeScreen, elements.quizScreen, elements.resultScreen].forEach(screen => {
        screen.classList.add("hidden");
    });
    document.getElementById(screenId).classList.remove("hidden");
}

function renderSetList() {
    elements.setList.replaceChildren();

    state.sets.forEach(set => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "set-card";

        const title = document.createElement("h3");
        title.textContent = set.title;

        const description = document.createElement("p");
        description.textContent = `${set.description || ""} · ${set.questions.length} câu · ${set.level || "A1–C1"}`;

        button.append(title, description);
        button.addEventListener("click", () => startQuiz(set));
        elements.setList.appendChild(button);
    });
}

function removeGrammarNote() {
    const oldNote = document.getElementById("grammar-note-card");
    if (oldNote) oldNote.remove();
}

function renderGrammarNote(question) {
    removeGrammarNote();

    if (!question.grammarNote) return;

    const note = question.grammarNote;
    const card = document.createElement("section");
    card.id = "grammar-note-card";
    Object.assign(card.style, {
        marginTop: "14px",
        padding: "15px",
        borderRadius: "12px",
        border: "1px solid #EBC9DA",
        background: "#FFFFFF",
        color: "#654D5D"
    });

    const heading = document.createElement("h4");
    heading.textContent = "📚 Công thức / cấu trúc cần nhớ";
    Object.assign(heading.style, {
        margin: "0 0 10px",
        color: "#A64F79",
        fontSize: "15px"
    });

    const formulaLabel = document.createElement("p");
    formulaLabel.textContent = "CÔNG THỨC";
    Object.assign(formulaLabel.style, {
        margin: "0 0 5px",
        fontSize: "11px",
        fontWeight: "700",
        letterSpacing: "0.5px",
        color: "#A64F79"
    });

    const formula = document.createElement("div");
    formula.textContent = note.formula;
    Object.assign(formula.style, {
        padding: "11px 12px",
        borderRadius: "8px",
        background: "#FFF3F8",
        color: "#594252",
        fontSize: "14px",
        lineHeight: "1.65",
        whiteSpace: "pre-line",
        overflowWrap: "anywhere",
        fontFamily: "Arial, sans-serif"
    });

    const useLabel = document.createElement("p");
    useLabel.textContent = "CÁCH DÙNG";
    Object.assign(useLabel.style, {
        margin: "12px 0 4px",
        fontSize: "11px",
        fontWeight: "700",
        letterSpacing: "0.5px",
        color: "#A64F79"
    });

    const use = document.createElement("p");
    use.textContent = note.use;
    Object.assign(use.style, {
        margin: "0",
        fontSize: "13px",
        lineHeight: "1.6"
    });

    card.append(heading, formulaLabel, formula, useLabel, use);

    if (note.signals) {
        const signalsLabel = document.createElement("p");
        signalsLabel.textContent = "DẤU HIỆU NHẬN BIẾT";
        Object.assign(signalsLabel.style, {
            margin: "12px 0 4px",
            fontSize: "11px",
            fontWeight: "700",
            letterSpacing: "0.5px",
            color: "#A64F79"
        });

        const signals = document.createElement("p");
        signals.textContent = note.signals;
        Object.assign(signals.style, {
            margin: "0",
            fontSize: "13px",
            lineHeight: "1.6"
        });
        card.append(signalsLabel, signals);
    }

    elements.explanation.appendChild(card);
}

function startQuiz(set) {
    state.currentSet = set;
    state.currentQuestionIndex = 0;
    state.score = 0;
    state.answered = false;
    elements.score.textContent = "Score: 0";
    showScreen("quiz-screen");
    renderQuestion();
}

function renderQuestion() {
    const questions = state.currentSet.questions;
    const currentQuestion = questions[state.currentQuestionIndex];
    const total = questions.length;
    const currentNumber = state.currentQuestionIndex + 1;

    state.answered = false;
    const difficultyText = currentQuestion.difficulty ? ` · ${currentQuestion.difficulty}` : "";
    elements.questionNumber.textContent = `Question ${currentNumber} / ${total}${difficultyText}`;
    elements.score.textContent = `Score: ${state.score}`;
    elements.progress.style.width = `${(state.currentQuestionIndex / total) * 100}%`;
    elements.question.textContent = currentQuestion.question;
    elements.options.replaceChildren();
    removeGrammarNote();

    const letters = ["A", "B", "C"];
    currentQuestion.options.forEach((option, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "option";
        button.textContent = `${letters[index]}. ${option}`;
        button.addEventListener("click", () => checkAnswer(index));
        elements.options.appendChild(button);
    });

    elements.explanation.style.display = "none";
    elements.explanationText.textContent = "";
    elements.nextButton.classList.add("hidden");
    elements.nextButton.textContent = "Next Question →";
}

function checkAnswer(selectedIndex) {
    if (state.answered) return;
    state.answered = true;

    const currentQuestion = state.currentSet.questions[state.currentQuestionIndex];
    const correctIndex = currentQuestion.correctAnswer;
    const isCorrect = selectedIndex === correctIndex;
    const optionButtons = elements.options.querySelectorAll(".option");

    optionButtons.forEach(button => { button.disabled = true; });
    optionButtons[correctIndex].classList.add("correct");

    const explanationTitle = elements.explanation.querySelector("h3");
    if (isCorrect) {
        state.score++;
        explanationTitle.textContent = "✓ Correct!";
        elements.explanationText.textContent = currentQuestion.explanation;
    } else {
        optionButtons[selectedIndex].classList.add("wrong");
        explanationTitle.textContent = "✗ Not quite!";
        const correctAnswer = currentQuestion.options[correctIndex];
        const selectedAnswer = currentQuestion.options[selectedIndex];
        elements.explanationText.textContent = `Your answer: ${selectedAnswer}. Correct answer: ${correctAnswer}. ${currentQuestion.explanation}`;
    }

    // Display a formula/structure teaching card for grammar questions.
    // It appears after either a correct or an incorrect answer.
    renderGrammarNote(currentQuestion);

    elements.score.textContent = `Score: ${state.score}`;
    const total = state.currentSet.questions.length;
    elements.progress.style.width = `${((state.currentQuestionIndex + 1) / total) * 100}%`;
    elements.explanation.style.display = "block";
    elements.nextButton.classList.remove("hidden");

    if (state.currentQuestionIndex === total - 1) {
        elements.nextButton.textContent = "See Results 🏆";
    }
}

function nextQuestion() {
    if (!state.answered) return;
    if (state.currentQuestionIndex < state.currentSet.questions.length - 1) {
        state.currentQuestionIndex++;
        renderQuestion();
    } else {
        showResult();
    }
}

function showResult() {
    const total = state.currentSet.questions.length;
    const percentage = Math.round((state.score / total) * 100);
    elements.finalScore.textContent = `${state.score} / ${total}`;

    if (percentage === 100) {
        elements.resultMessage.textContent = "Excellent! Perfect score! 🌟";
    } else if (percentage >= 80) {
        elements.resultMessage.textContent = "Excellent work! You have a strong understanding. 💗";
    } else if (percentage >= 60) {
        elements.resultMessage.textContent = "Great effort! Review the explanations and keep going. 🌸";
    } else if (percentage >= 40) {
        elements.resultMessage.textContent = "Good start! Practice these questions again to improve. 💪";
    } else {
        elements.resultMessage.textContent = "Keep practicing. Every question is a chance to learn! 🌱";
    }

    showScreen("result-screen");
}

function retryQuiz() {
    if (state.currentSet) startQuiz(state.currentSet);
}

function backToHome() {
    state.currentSet = null;
    state.currentQuestionIndex = 0;
    state.score = 0;
    state.answered = false;
    showScreen("home-screen");
}

elements.nextButton.addEventListener("click", nextQuestion);
elements.retryButton.addEventListener("click", retryQuiz);
elements.homeButton.addEventListener("click", backToHome);

loadQuestions();
