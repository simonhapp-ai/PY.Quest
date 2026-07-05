// Renders the quiz task types: mc (multiple choice), out (predict output), fill (fill blank).
// Content-agnostic: everything it needs comes from the `aufgabe` object per the schema.

function normalize(s) {
  return String(s).trim().toLowerCase().replace(/\s+/g, " ").replace(/'/g, '"');
}

export function renderQuizTask(container, aufgabe, { onDone }) {
  const kicker = { mc: "Multiple Choice", out: "Ausgabe vorhersagen", fill: "Lücke füllen" }[aufgabe.t];

  container.innerHTML = `
    <div class="task-kicker">${kicker}</div>
    <div class="task-q">${aufgabe.q}</div>
    ${aufgabe.code ? `<div class="task-code">${escapeHtml(aufgabe.code)}</div>` : ""}
    <div id="task-answer-area"></div>
    <div class="task-feedback" id="task-feedback"></div>
    <div class="task-footer">
      <button class="btn btn-primary" id="task-next" disabled>Weiter</button>
    </div>`;

  const feedbackEl = container.querySelector("#task-feedback");
  const nextBtn = container.querySelector("#task-next");
  const answerArea = container.querySelector("#task-answer-area");
  let answered = false;
  let result = null;

  function showFeedback(ok) {
    feedbackEl.classList.add("show", ok ? "ok" : "err");
    feedbackEl.textContent = (ok ? "✔ Richtig. " : "✘ Nicht ganz. ") + (aufgabe.ex || "");
    nextBtn.disabled = false;
    answered = true;
    result = ok ? "correct" : "wrong";
  }

  if (aufgabe.t === "mc") {
    answerArea.innerHTML = `
      <div class="opt-list">
        ${aufgabe.opts.map((opt, i) => `<button class="opt-btn" data-i="${i}">${opt}</button>`).join("")}
      </div>`;
    answerArea.querySelectorAll(".opt-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (answered) return;
        const i = Number(btn.dataset.i);
        const ok = i === aufgabe.a;
        answerArea.querySelectorAll(".opt-btn").forEach((b, bi) => {
          b.disabled = true;
          if (bi === aufgabe.a) b.classList.add("correct");
          else if (bi === i) b.classList.add("wrong");
        });
        showFeedback(ok);
      });
    });
  } else {
    // out | fill
    answerArea.innerHTML = `
      <div class="text-input-row">
        <input type="text" id="task-text-input" placeholder="Deine Antwort …" autocomplete="off" spellcheck="false" />
        <button class="btn" id="task-check">Prüfen</button>
      </div>`;
    const input = answerArea.querySelector("#task-text-input");
    const checkBtn = answerArea.querySelector("#task-check");
    const submit = () => {
      if (answered) return;
      const val = normalize(input.value);
      const ok = aufgabe.accept.some((a) => normalize(a) === val);
      input.classList.add(ok ? "correct" : "wrong");
      input.disabled = true;
      checkBtn.disabled = true;
      showFeedback(ok);
    };
    checkBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
  }

  nextBtn.addEventListener("click", () => onDone(result));
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
