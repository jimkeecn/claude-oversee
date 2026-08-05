import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { sendChatMessage, setChatModel } from "../api";
import type { ChatEvent } from "../api";
import type { ChatMessage, ChatUsage, ReviewThread } from "../types";

const MODEL_OPTIONS = [
  { value: "", label: "default (haiku)" },
  { value: "haiku", label: "haiku" },
  { value: "sonnet", label: "sonnet" },
  { value: "opus", label: "opus" },
];

function formatCost(costUsd: number): string {
  return costUsd >= 0.01 ? `$${costUsd.toFixed(2)}` : `$${costUsd.toFixed(4)}`;
}

function formatTokens(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

function usageTooltip(usage: ChatUsage): string {
  const totalInput =
    usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const cachedShare =
    totalInput > 0 ? Math.round((usage.cacheReadTokens / totalInput) * 100) : 0;
  return [
    `input ${formatTokens(usage.inputTokens)}`,
    `cache read ${formatTokens(usage.cacheReadTokens)} (${cachedShare}%)`,
    `cache write ${formatTokens(usage.cacheWriteTokens)}`,
    `output ${formatTokens(usage.outputTokens)}`,
  ].join(" · ");
}

function CostBadge({ message }: { message: ChatMessage }) {
  if (message.costUsd === undefined && !message.usage) return null;
  const parts: string[] = [];
  if (message.costUsd !== undefined) parts.push(formatCost(message.costUsd));
  if (message.usage) {
    const totalInput =
      message.usage.inputTokens +
      message.usage.cacheReadTokens +
      message.usage.cacheWriteTokens;
    parts.push(
      `${formatTokens(totalInput)} in · ${formatTokens(message.usage.outputTokens)} out`,
    );
  }
  return (
    <span
      className="chat-cost mono"
      title={message.usage ? usageTooltip(message.usage) : undefined}
    >
      {parts.join(" · ")}
    </span>
  );
}

interface ChatPanelProps {
  thread: ReviewThread;
  liveEvent: ChatEvent | null;
  onInsertFeedback: (text: string) => void;
}

export function ChatPanel({
  thread,
  liveEvent,
  onInsertFeedback,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [busy, setBusy] = useState(false);
  const [toolLine, setToolLine] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!liveEvent) return;
    if (liveEvent.status === "thinking") {
      setBusy(true);
      setStreaming("");
      setToolLine(null);
      setError(null);
    }
    if (liveEvent.delta) setStreaming((prev) => prev + liveEvent.delta);
    if (liveEvent.tool)
      setToolLine(`${liveEvent.tool} ${liveEvent.input ?? ""}`);
    if (liveEvent.done) {
      setBusy(false);
      setStreaming("");
      setToolLine(null);
    }
    if (liveEvent.error) {
      setBusy(false);
      setError(liveEvent.error);
    }
  }, [liveEvent]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [thread.chat.messages.length, streaming]);

  const send = async () => {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setError(null);
    const result = await sendChatMessage(thread.id, message);
    if (!result.ok) setError(result.error ?? "send failed");
  };

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <span className="chat-title">Sidecar</span>
        <select
          className="model-picker"
          value={thread.chat.model ?? ""}
          onChange={(event) => setChatModel(thread.id, event.target.value)}
          title="Sidecar model for this review"
        >
          {MODEL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="muted mono small">
          read-only · {thread.projectName}
        </span>
      </div>
      <div className="chat-scroll" ref={scrollRef}>
        {thread.chat.messages.length === 0 && !busy && (
          <p className="muted chat-empty">
            Ask the sidecar anything about this{" "}
            {thread.type === "plan" ? "plan" : "question set"}. It can read the
            project files.
          </p>
        )}
        {thread.chat.messages.map((message, index) => (
          <div key={index} className={`chat-msg ${message.role}`}>
            <span className="chat-who">
              {message.role === "user" ? "you" : (message.model ?? "sidecar")}
            </span>
            <div className="chat-body">
              <Markdown>{message.content}</Markdown>
            </div>
            {message.role === "assistant" && (
              <div className="chat-msg-foot">
                <button
                  className="insert-btn"
                  onClick={() => onInsertFeedback(message.content)}
                >
                  ↳ insert into feedback
                </button>
                <CostBadge message={message} />
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="chat-msg assistant">
            <span className="chat-who">sidecar</span>
            <div className="chat-body">
              {streaming ? (
                <Markdown>{streaming}</Markdown>
              ) : (
                <span className="muted">thinking…</span>
              )}
              {toolLine && <div className="tool-line mono">{toolLine}</div>}
            </div>
          </div>
        )}
        {error && <div className="banner error">{error}</div>}
      </div>
      <div className="chat-input-row">
        <textarea
          placeholder="Ask the sidecar… (Enter to send, Shift+Enter for newline)"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <button
          className="btn primary"
          disabled={busy || !input.trim()}
          onClick={send}
        >
          Send
        </button>
      </div>
    </div>
  );
}
