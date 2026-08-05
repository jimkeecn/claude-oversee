import type { DecisionRequest, ReviewThread } from "../shared/protocol.js";

export function composeReason(
  thread: ReviewThread,
  request: DecisionRequest,
): string {
  if (thread.type === "questions") return composeAnswers(request);
  return composePlanFeedback(request);
}

function composePlanFeedback(request: DecisionRequest): string {
  const parts: string[] = [
    "The user reviewed this plan in Claude Oversee (web review) and requests changes before approval.",
  ];
  const comments = request.comments ?? [];
  if (comments.length > 0) {
    parts.push("\nInline comments on specific passages:");
    for (const comment of comments) {
      const excerpt = truncate(comment.anchor.exact, 240);
      const orphanNote = comment.orphaned
        ? " (the quoted passage was removed in a later revision)"
        : "";
      parts.push(
        `\n> ${excerpt.replace(/\n/g, "\n> ")}\n— ${comment.text}${orphanNote}`,
      );
    }
  }
  if (request.overallNotes?.trim()) {
    parts.push(`\nOverall notes:\n${request.overallNotes.trim()}`);
  }
  parts.push(
    "\nRevise the plan to address every comment above, then present the updated plan again with ExitPlanMode.",
  );
  return parts.join("\n");
}

function composeAnswers(request: DecisionRequest): string {
  const parts: string[] = [
    "The user answered these questions in Claude Oversee (web review). Treat the following as their definitive answers, do not re-ask:",
  ];
  for (const answer of request.answers ?? []) {
    const label = answer.header ? `${answer.header} — ` : "";
    parts.push(`\nQ: ${label}${answer.question}`);
    parts.push(`A: ${answer.selected.join(", ") || "(no option selected)"}`);
    if (answer.notes?.trim()) parts.push(`Notes: ${answer.notes.trim()}`);
  }
  if (request.overallNotes?.trim()) {
    parts.push(`\nAdditional notes:\n${request.overallNotes.trim()}`);
  }
  parts.push("\nContinue with these answers.");
  return parts.join("\n");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}
