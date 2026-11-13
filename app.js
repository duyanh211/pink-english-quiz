
"use strict";

// ==========================================
// 1. KHAI BÁO BIẾN VÀ TRẠNG THÁI TRÒ CHƠI
// ==========================================

const state = {
    sets: [],
    currentSet: null,
    currentQuestionIndex: 0,
    score: 0,
    answered: false
};

// Lấy các phần tử giao diện từ HTML
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


// ==========================================
// 2. ĐỌC DỮ LIỆU TỪ FILE JSON
// ==========================================

async function loadQuestions() {
    try {
        const response = await fetch("./questions.json");

        if (!response.ok) {
            throw new Error("Không thể tải questions.json");
        }

        const data = await response.json();

        if (!data || !Array.isArray(data.sets)) {
            throw new Error("Cấu trúc JSON không hợp lệ.");
        }

        // Kiểm tra từng bộ câu hỏi
        for (const set of data.sets) {
            if (
                !set.id ||
                !set.title ||
                !Array.isArray(set.questions) ||
                set.questions.length === 0
            ) {
                throw new Error("Một bộ câu hỏi bị thiếu dữ liệu.");
            }

            // Kiểm tra từng câu hỏi
            for (const q of set.questions) {
                const valid =
                    typeof q.question === "string" &&
                    Array.isArray(q.options) &&
                    q.options.length === 3 &&
                    q.options.every(option => typeof option === "string") &&
                    Number.isInteger(q.correctAnswer) &&
                    q.correctAnswer >= 0 &&
                    q.correctAnswer < 3 &&
                    typeof q.explanation === "string";

                if (!valid) {
                    throw new Error(
                        `Dữ liệu câu hỏi không hợp lệ trong bộ ${set.title}`
                    );
                }
            }
        }

        state.sets = data.sets;

        // Hiển thị danh sách bộ câu hỏi
        renderSetList();

    } catch (error) {
        console.error("Question loading error:", error);

        elements.setList.textContent =
            "Không thể tải câu hỏi. Hãy kiểm tra file questions.json và tải lại trang.";
    }
}


// ==========================================
// 3. HIỂN THỊ VÀ CHUYỂN ĐỔI MÀN HÌNH
// ==========================================

function showScreen(screenId) {
    elements.homeScreen.classList.add("hidden");
    elements.quizScreen.classList.add("hidden");
    elements.resultScreen.classList.add("hidden");

    document.getElementById(screenId).classList.remove("hidden");
}


// ==========================================
// 4. HIỂN THỊ DANH SÁCH BỘ CÂU HỎI
// ==========================================

function renderSetList() {

    elements.setList.replaceChildren();

    state.sets.forEach(set => {

        const button = document.createElement("button");
        button.className = "set-card";
        button.type = "button";

        const title = document.createElement("h3");
        title.textContent = set.title;

        const description = document.createElement("p");
        description.textContent =
            `${set.description || ""} | ${set.questions.length} questions | Level ${set.level || "N/A"}`;

        button.append(title, description);

        button.addEventListener("click", () => {
            startQuiz(set);
        });

        elements.setList.appendChild(button);
    });
}


// ==========================================
// 5. BẮT ĐẦU TRÒ CHƠI
// ==========================================

function startQuiz(set) {

    state.currentSet = set;
    state.currentQuestionIndex = 0;
    state.score = 0;
    state.answered = false;

    elements.score.textContent = "Score: 0";

    showScreen("quiz-screen");

    renderQuestion();
}


// ==========================================
// 6. HIỂN THỊ CÂU HỎI VÀ ĐÁP ÁN
// ==========================================

function renderQuestion() {

    const questions = state.currentSet.questions;

    const currentQuestion =
        questions[state.currentQuestionIndex];

    const total = questions.length;
    const currentNumber = state.currentQuestionIndex + 1;

    state.answered = false;

    // Hiển thị số câu hỏi
    elements.questionNumber.textContent =
        `Question ${currentNumber} / ${total}`;

    // Hiển thị điểm
    elements.score.textContent =
        `Score: ${state.score}`;

    // Thanh tiến độ
    const progressPercentage =
        (state.currentQuestionIndex / total) * 100;

    elements.progress.style.width =
        `${progressPercentage}%`;

    // Hiển thị nội dung câu hỏi
    elements.question.textContent =
        currentQuestion.question;

    // Xóa các đáp án cũ
    elements.options.replaceChildren();

    // Tạo 3 nút trả lời
    const letters = ["A", "B", "C"];

    currentQuestion.options.forEach((option, index) => {

        const button = document.createElement("button");

        button.type = "button";
        button.className = "option";

        button.textContent =
            `${letters[index]}. ${option}`;

        button.dataset.index = index;

        button.addEventListener("click", () => {
            checkAnswer(index);
        });

        elements.options.appendChild(button);
    });

    // Ẩn lời giải và nút Next
    elements.explanation.style.display = "none";

    elements.explanationText.textContent = "";

    elements.nextButton.classList.add("hidden");

    // Đặt lại tên nút
    elements.nextButton.textContent = "Next Question →";
}


// ==========================================
// 7. KIỂM TRA ĐÁP ÁN
// ==========================================

function checkAnswer(selectedIndex) {

    // Không cho chọn nhiều lần
    if (state.answered) return;

    state.answered = true;

    const currentQuestion =
        state.currentSet.questions[state.currentQuestionIndex];

    const correctIndex =
        currentQuestion.correctAnswer;

    const isCorrect =
        selectedIndex === correctIndex;

    const optionButtons =
        elements.options.querySelectorAll(".option");

    // Khóa tất cả các đáp án
    optionButtons.forEach(button => {
        button.disabled = true;
    });

    // Đánh dấu đáp án đúng màu xanh
    optionButtons[correctIndex].classList.add("correct");

    if (isCorrect) {

        // Trả lời đúng
        state.score++;

    } else {

        // Trả lời sai: đáp án đã chọn sẽ màu cam
        optionButtons[selectedIndex].classList.add("wrong");
    }

    // Cập nhật điểm
    elements.score.textContent =
        `Score: ${state.score}`;

    // Cập nhật thanh tiến độ
    const total = state.currentSet.questions.length;

    const progressPercentage =
        ((state.currentQuestionIndex + 1) / total) * 100;

    elements.progress.style.width =
        `${progressPercentage}%`;

    // Hiển thị phần giải thích
    const explanationTitle =
        elements.explanation.querySelector("h3");

    if (isCorrect) {

        explanationTitle.textContent = "✓ Correct!";

        elements.explanationText.textContent =
            currentQuestion.explanation;

    } else {

        explanationTitle.textContent = "✗ Not quite!";

        const correctAnswer =
            currentQuestion.options[correctIndex];

        const selectedAnswer =
            currentQuestion.options[selectedIndex];

        elements.explanationText.textContent =
            `Your answer: ${selectedAnswer}. ` +
            `Correct answer: ${correctAnswer}. ` +
            currentQuestion.explanation;
    }

    elements.explanation.style.display = "block";

    // Hiện nút chuyển câu
    elements.nextButton.classList.remove("hidden");

    // Nếu là câu cuối thì đổi tên nút
    if (state.currentQuestionIndex === total - 1) {

        elements.nextButton.textContent =
            "See Results 🏆";
    }
}


// ==========================================
// 8. CHUYỂN SANG CÂU HỎI TIẾP THEO
// ==========================================

function nextQuestion() {

    if (!state.answered) return;

    const total = state.currentSet.questions.length;

    if (state.currentQuestionIndex < total - 1) {

        state.currentQuestionIndex++;

        renderQuestion();

    } else {

        showResult();
    }
}


// ==========================================
// 9. HIỂN THỊ KẾT QUẢ
// ==========================================

function showResult() {

    const total = state.currentSet.questions.length;

    const score = state.score;

    const percentage =
        Math.round((score / total) * 100);

    elements.finalScore.textContent =
        `${score} / ${total}`;

    if (percentage === 100) {

        elements.resultMessage.textContent =
            "Excellent! Perfect score! 🌟";

    } else if (percentage >= 70) {

        elements.resultMessage.textContent =
            "Great job! Keep improving your English! 💗";

    } else if (percentage >= 50) {

        elements.resultMessage.textContent =
            "Good effort! Practice makes perfect! 🌸";

    } else {

        elements.resultMessage.textContent =
            "Don't give up! Try again and learn more! 💪";
    }

    showScreen("result-screen");
}


// ==========================================
// 10. CHƠI LẠI
// ==========================================

function retryQuiz() {

    if (state.currentSet) {
        startQuiz(state.currentSet);
    }
}


// ==========================================
// 11. QUAY VỀ MÀN HÌNH CHỌN BỘ CÂU HỎI
// ==========================================

function backToHome() {

    state.currentSet = null;
    state.currentQuestionIndex = 0;
    state.score = 0;
    state.answered = false;

    showScreen("home-screen");
}


// ==========================================
// 12. GẮN SỰ KIỆN CHO CÁC NÚT
// ==========================================

elements.nextButton.addEventListener(
    "click",
    nextQuestion
);

elements.retryButton.addEventListener(
    "click",
    retryQuiz
);

elements.homeButton.addEventListener(
    "click",
    backToHome
);


// ==========================================
// 13. KHỞI ĐỘNG ỨNG DỤNG
// ==========================================

loadQuestions();
