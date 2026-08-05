import { useEffect, useState } from "react";
import { fetchThreads } from "../api";
import { ThemeToggle } from "../components/ThemeToggle";
import type { ReviewThread } from "../types";

function threadStatus(thread: ReviewThread): string {
  const latest = thread.revisions[thread.revisions.length - 1];
  if (!latest) return "empty";
  if (latest.status === "pending") return "waiting";
  if (latest.status === "decided")
    return latest.result?.decision === "allow" ? "approved" : "answered";
  return latest.status;
}

export function ReviewList() {
  const [threads, setThreads] = useState<ReviewThread[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchThreads()
      .then(setThreads)
      .catch((error) => setError(String(error)));
    const timer = setInterval(
      () =>
        fetchThreads()
          .then(setThreads)
          .catch(() => undefined),
      5000,
    );
    return () => clearInterval(timer);
  }, []);

  return (
    <main className="list-page">
      <header className="list-header">
        <div className="list-top">
          <h1>Claude Oversee</h1>
          <ThemeToggle />
        </div>
        <p className="muted">
          Plans and questions from your Claude Code sessions.
        </p>
      </header>
      {error && <div className="banner error">{error}</div>}
      {threads?.length === 0 && (
        <p className="muted">
          No reviews yet. Run <code>/claude-oversee on</code> in a project, then
          let Claude present a plan.
        </p>
      )}
      <div className="thread-rows">
        {threads?.map((thread) => {
          const status = threadStatus(thread);
          return (
            <a
              key={thread.id}
              className="thread-row"
              href={`/review/${thread.id}`}
            >
              <span className={`pill type-${thread.type}`}>{thread.type}</span>
              <span className="thread-title">
                {thread.type === "plan"
                  ? firstLine(thread) || "Plan review"
                  : `${countQuestions(thread)} questions`}
              </span>
              <span className="muted mono">
                {thread.projectName} · rev {thread.revisions.length} ·{" "}
                <span className={`status status-${status}`}>{status}</span>
              </span>
            </a>
          );
        })}
      </div>
    </main>
  );
}

function firstLine(thread: ReviewThread): string {
  const plan =
    thread.revisions[thread.revisions.length - 1]?.payload.plan ?? "";
  return plan.split("\n")[0]?.replace(/^#+\s*/, "") ?? "";
}

function countQuestions(thread: ReviewThread): number {
  return (
    thread.revisions[thread.revisions.length - 1]?.payload.questions?.length ??
    0
  );
}
