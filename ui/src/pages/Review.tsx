import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchThread, submitDecision, subscribe } from "../api";
import type { ChatEvent } from "../api";
import { ChatPanel } from "../components/ChatPanel";
import { DiffView } from "../components/DiffView";
import { PlanView, truncate } from "../components/PlanView";
import { QuestionCards } from "../components/QuestionCards";
import { ThemeToggle } from "../components/ThemeToggle";
import type {
  QuestionAnswer,
  ReviewComment,
  ReviewThread,
  TextQuoteAnchor,
  UserDecision,
} from "../types";

export function Review({ threadId }: { threadId: string }) {
  const [thread, setThread] = useState<ReviewThread | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [answers, setAnswers] = useState<QuestionAnswer[]>([]);
  const [overallNotes, setOverallNotes] = useState("");
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [chatEvent, setChatEvent] = useState<ChatEvent | null>(null);
  const [submitBanner, setSubmitBanner] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [orphanIds, setOrphanIds] = useState<Set<string>>(new Set());
  const seededRef = useRef(false);

  const handleOrphans = useCallback((ids: string[]) => {
    setOrphanIds((current) => {
      const next = new Set(ids);
      if (
        next.size === current.size &&
        [...next].every((id) => current.has(id))
      )
        return current;
      return next;
    });
  }, []);

  useEffect(() => {
    fetchThread(threadId)
      .then((loaded) => {
        setThread(loaded);
        if (!seededRef.current) {
          seededRef.current = true;
          setComments(loaded.comments ?? []);
          setOverallNotes(loaded.overallNotes ?? "");
        }
      })
      .catch((error) => setLoadError(String(error)));
    return subscribe(threadId, {
      onThread: (updated) => {
        setThread(updated);
        setViewIndex(null);
      },
      onChat: setChatEvent,
    });
  }, [threadId]);

  const latest = thread?.revisions[thread.revisions.length - 1];
  const shown =
    thread && viewIndex !== null
      ? (thread.revisions.find((rev) => rev.index === viewIndex) ?? latest)
      : latest;
  const previous = useMemo(() => {
    if (!thread || !shown || shown.index <= 1) return null;
    return (
      thread.revisions.find((rev) => rev.index === shown.index - 1) ?? null
    );
  }, [thread, shown]);
  const readOnly = latest?.status !== "pending";

  const addComment = useCallback(
    (anchor: TextQuoteAnchor, text: string) => {
      setComments((current) => [
        ...current,
        {
          id: `c_${Date.now().toString(36)}_${current.length}`,
          anchor,
          text,
          revisionIndex: shown?.index ?? 1,
        },
      ]);
    },
    [shown?.index],
  );

  const insertFeedback = useCallback((text: string) => {
    setOverallNotes((current) =>
      current.trim() ? `${current.trimEnd()}\n\n${text}` : text,
    );
  }, []);

  const submit = async (decision: UserDecision) => {
    if (!thread) return;
    const finalComments = comments.map((comment) => ({
      ...comment,
      orphaned: orphanIds.has(comment.id),
    }));
    const result = await submitDecision(thread.id, {
      decision,
      comments: thread.type === "plan" ? finalComments : undefined,
      answers: thread.type === "questions" ? sortedAnswers(answers) : undefined,
      overallNotes: overallNotes.trim() || undefined,
    });
    if (result.ok) {
      setSubmitBanner({
        kind: "ok",
        text:
          decision === "approve"
            ? "Approved. Claude is executing the plan in your terminal."
            : decision === "terminal"
              ? "Handed back to the terminal."
              : thread.type === "plan"
                ? "Feedback sent. Claude is revising the plan; this page updates when the new revision arrives."
                : "Answers sent. The session continues in your terminal.",
      });
    } else {
      setSubmitBanner({
        kind: "error",
        text:
          result.status === 410
            ? "This review went stale (the session moved on or timed out). Answer in the terminal."
            : (result.error ?? "Submit failed."),
      });
    }
  };

  if (loadError)
    return (
      <main className="review-page">
        <div className="banner error">{loadError}</div>
      </main>
    );
  if (!thread || !shown)
    return (
      <main className="review-page">
        <p className="muted">Loading…</p>
      </main>
    );

  return (
    <main className="review-page">
      <header className="review-head">
        <a className="back" href="/">
          ← Claude Oversee
        </a>
        <h1>
          {thread.type === "plan"
            ? planTitle(shown.payload.plan ?? "")
            : `Claude asks ${shown.payload.questions?.length ?? 0} question${
                (shown.payload.questions?.length ?? 0) === 1 ? "" : "s"
              }`}
        </h1>
        <span className={`pill status-${latest?.status}`}>
          {latest?.status === "pending" ? "awaiting review" : latest?.status}
        </span>
        <span className="muted mono small">
          {thread.projectName} · session {thread.sessionId.slice(0, 8)}
        </span>
        <ThemeToggle />
        {thread.revisions.length > 1 && (
          <div className="rev-tabs">
            {thread.revisions.map((rev) => (
              <button
                key={rev.id}
                className={`rev-tab ${rev.index === shown.index ? "active" : ""}`}
                onClick={() => {
                  setViewIndex(rev.index);
                  setShowDiff(false);
                }}
              >
                rev {rev.index}
              </button>
            ))}
            {previous && (
              <button
                className={`rev-tab ${showDiff ? "active" : ""}`}
                onClick={() => setShowDiff((value) => !value)}
              >
                diff
              </button>
            )}
          </div>
        )}
      </header>

      {submitBanner && (
        <div
          className={`banner ${submitBanner.kind === "ok" ? "ok" : "error"}`}
        >
          {submitBanner.text}
        </div>
      )}
      {readOnly && !submitBanner && (
        <div className="banner">
          This revision is {latest?.status}, so no further input is expected
          here.
        </div>
      )}

      <div className="review-columns">
        <section className="main-col">
          {thread.type === "plan" ? (
            showDiff && previous ? (
              <DiffView
                before={previous.payload.plan ?? ""}
                after={shown.payload.plan ?? ""}
              />
            ) : (
              <PlanView
                plan={shown.payload.plan ?? ""}
                comments={comments}
                activeCommentId={activeCommentId}
                readOnly={readOnly || shown.index !== latest?.index}
                onAddComment={addComment}
                onSelectComment={setActiveCommentId}
                onOrphans={handleOrphans}
              />
            )
          ) : (
            <QuestionCards
              questions={shown.payload.questions ?? []}
              answers={answers}
              readOnly={readOnly}
              onChange={setAnswers}
            />
          )}

          <div className="composer">
            <textarea
              className="notes-input"
              placeholder={
                thread.type === "plan"
                  ? "Overall notes for Claude (optional)…"
                  : "Additional notes for Claude (optional)…"
              }
              value={overallNotes}
              disabled={readOnly}
              onChange={(event) => setOverallNotes(event.target.value)}
            />
            <div className="btn-row">
              {thread.type === "plan" ? (
                <>
                  <button
                    className="btn primary"
                    disabled={readOnly}
                    onClick={() => submit("approve")}
                  >
                    Approve plan
                  </button>
                  <button
                    className="btn secondary"
                    disabled={
                      readOnly ||
                      (comments.length === 0 && !overallNotes.trim())
                    }
                    onClick={() => submit("request_changes")}
                  >
                    Request changes
                    {comments.length > 0 ? ` (${comments.length})` : ""}
                  </button>
                </>
              ) : (
                <button
                  className="btn primary"
                  disabled={
                    readOnly ||
                    answers.every(
                      (answer) =>
                        !answer.selected.length && !answer.notes?.trim(),
                    )
                  }
                  onClick={() => submit("request_changes")}
                >
                  Submit answers
                </button>
              )}
              <button
                className="btn"
                disabled={readOnly}
                onClick={() => submit("terminal")}
              >
                Answer in terminal
              </button>
            </div>
          </div>
        </section>

        <aside className="side-col">
          {thread.type === "plan" && (
            <div className="comment-list">
              <h3>Comments</h3>
              {comments.length === 0 && (
                <p className="muted small">
                  Select text in the plan to attach a comment.
                </p>
              )}
              {comments.map((comment) => (
                <div
                  key={comment.id}
                  className={`comment-card ${comment.id === activeCommentId ? "active" : ""} ${orphanIds.has(comment.id) ? "orphaned" : ""}`}
                  onClick={() => setActiveCommentId(comment.id)}
                >
                  <blockquote>{truncate(comment.anchor.exact, 100)}</blockquote>
                  <p>{comment.text}</p>
                  {orphanIds.has(comment.id) && (
                    <span className="orphan-tag">
                      orphaned (rev {comment.revisionIndex})
                    </span>
                  )}
                  {!readOnly && (
                    <button
                      className="delete-btn"
                      onClick={(event) => {
                        event.stopPropagation();
                        setComments((current) =>
                          current.filter((entry) => entry.id !== comment.id),
                        );
                      }}
                    >
                      remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <ChatPanel
            thread={thread}
            liveEvent={chatEvent}
            onInsertFeedback={insertFeedback}
          />
        </aside>
      </div>
    </main>
  );
}

function planTitle(plan: string): string {
  const heading = plan.split("\n").find((line) => line.trim());
  return heading?.replace(/^#+\s*/, "") ?? "Plan review";
}

function sortedAnswers(answers: QuestionAnswer[]): QuestionAnswer[] {
  return [...answers].sort((a, b) => a.index - b.index);
}
