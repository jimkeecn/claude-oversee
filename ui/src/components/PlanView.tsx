import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  applyHighlight,
  captureAnchor,
  clearHighlights,
  findAnchor,
  plainTextOf,
} from "../anchors";
import type { ReviewComment, TextQuoteAnchor } from "../types";

interface PlanViewProps {
  plan: string;
  comments: ReviewComment[];
  activeCommentId: string | null;
  readOnly: boolean;
  onAddComment: (anchor: TextQuoteAnchor, text: string) => void;
  onSelectComment: (id: string | null) => void;
  onOrphans: (ids: string[]) => void;
}

interface PopoverState {
  anchor: TextQuoteAnchor;
  x: number;
  y: number;
}

export function PlanView({
  plan,
  comments,
  activeCommentId,
  readOnly,
  onAddComment,
  onSelectComment,
  onOrphans,
}: PlanViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [draft, setDraft] = useState("");
  const prevActiveRef = useRef<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    clearHighlights(container);
    const text = plainTextOf(container);
    const orphaned: string[] = [];
    for (const comment of comments) {
      const match = findAnchor(text, comment.anchor);
      if (match) {
        applyHighlight(
          container,
          comment.id,
          match.start,
          match.end,
          comment.id === activeCommentId,
        );
      } else {
        orphaned.push(comment.id);
      }
    }
    onOrphans(orphaned);
    if (activeCommentId && activeCommentId !== prevActiveRef.current) {
      container
        .querySelector(`mark[data-comment-id="${CSS.escape(activeCommentId)}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    prevActiveRef.current = activeCommentId;
  }, [plan, comments, activeCommentId, onOrphans]);

  const handleMouseUp = () => {
    if (readOnly) return;
    const selection = window.getSelection();
    const container = containerRef.current;
    if (!selection || selection.isCollapsed || !container) return;
    const range = selection.getRangeAt(0);
    const anchor = captureAnchor(container, range);
    if (!anchor || !anchor.exact.trim()) return;
    const rect = range.getBoundingClientRect();
    setPopover({
      anchor,
      x: rect.left + rect.width / 2 + window.scrollX,
      y: rect.bottom + window.scrollY,
    });
    setDraft("");
  };

  const handleClick = (event: React.MouseEvent) => {
    const mark = (event.target as HTMLElement).closest("mark[data-comment-id]");
    onSelectComment(mark ? (mark as HTMLElement).dataset.commentId! : null);
  };

  return (
    <div className="plan-wrap">
      <div
        ref={containerRef}
        className="plan-view"
        onMouseUp={handleMouseUp}
        onClick={handleClick}
      >
        <Markdown remarkPlugins={[remarkGfm]}>{plan}</Markdown>
      </div>
      {popover && (
        <div
          className="comment-popover"
          style={{ left: popover.x, top: popover.y + 6 }}
        >
          <blockquote>{truncate(popover.anchor.exact, 120)}</blockquote>
          <textarea
            autoFocus
            placeholder="Comment on this passage…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                confirm();
              }
              if (event.key === "Escape") setPopover(null);
            }}
          />
          <div className="popover-actions">
            <button
              className="btn primary"
              disabled={!draft.trim()}
              onClick={confirm}
            >
              Add comment
            </button>
            <button className="btn" onClick={() => setPopover(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );

  function confirm() {
    if (!popover || !draft.trim()) return;
    onAddComment(popover.anchor, draft.trim());
    setPopover(null);
    window.getSelection()?.removeAllRanges();
  }
}

export function truncate(text: string, max: number) {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}
