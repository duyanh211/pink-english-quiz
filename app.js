"use strict";

// ==========================================
// PINK ENGLISH QUIZ - GAME LOGIC
// Supports question sets with 3 options per question.
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
