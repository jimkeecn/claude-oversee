import type { Question, QuestionAnswer } from "../types";

interface QuestionCardsProps {
  questions: Question[];
  answers: QuestionAnswer[];
  readOnly: boolean;
  onChange: (answers: QuestionAnswer[]) => void;
}

export function QuestionCards({
  questions,
  answers,
  readOnly,
  onChange,
}: QuestionCardsProps) {
  const answerFor = (index: number): QuestionAnswer =>
    answers.find((answer) => answer.index === index) ?? {
      index,
      question: questions[index].question,
      header: questions[index].header,
      selected: [],
    };

  const update = (next: QuestionAnswer) => {
    onChange([
      ...answers.filter((answer) => answer.index !== next.index),
      next,
    ]);
  };

  const toggle = (index: number, label: string, multiSelect: boolean) => {
    if (readOnly) return;
    const current = answerFor(index);
    const selected = multiSelect
      ? current.selected.includes(label)
        ? current.selected.filter((entry) => entry !== label)
        : [...current.selected, label]
      : [label];
    update({ ...current, selected });
  };

  return (
    <div className="question-cards">
      {questions.map((question, index) => {
        const answer = answerFor(index);
        return (
          <div className="qcard" key={index}>
            {question.header && <span className="qtag">{question.header}</span>}
            <p className="qtext">{question.question}</p>
            {question.options?.map((option) => {
              const selected = answer.selected.includes(option.label);
              return (
                <button
                  key={option.label}
                  className={`opt ${selected ? "sel" : ""}`}
                  onClick={() =>
                    toggle(index, option.label, question.multiSelect === true)
                  }
                  disabled={readOnly}
                >
                  <span className={question.multiSelect ? "checkbox" : "radio"}>
                    {selected ? "●" : ""}
                  </span>
                  <span>
                    {option.label}
                    {option.description && (
                      <span className="opt-desc">{option.description}</span>
                    )}
                  </span>
                </button>
              );
            })}
            <input
              className="qnotes"
              placeholder="Optional note for this answer…"
              value={answer.notes ?? ""}
              disabled={readOnly}
              onChange={(event) =>
                update({ ...answer, notes: event.target.value })
              }
            />
          </div>
        );
      })}
    </div>
  );
}
