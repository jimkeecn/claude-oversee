import type {
  ChatUsage,
  QuestionAnswer,
  ReviewComment,
  ReviewThread,
  UserDecision,
} from "./types";

export async function fetchThreads(): Promise<ReviewThread[]> {
  const res = await fetch("/api/reviews");
  if (!res.ok) throw new Error(`list failed: ${res.status}`);
  return res.json();
}

export async function fetchThread(id: string): Promise<ReviewThread> {
  const res = await fetch(`/api/reviews/${id}`);
  if (!res.ok) throw new Error(`load failed: ${res.status}`);
  return res.json();
}

export interface DecisionBody {
  decision: UserDecision;
  comments?: ReviewComment[];
  answers?: QuestionAnswer[];
  overallNotes?: string;
}

export async function submitDecision(
  id: string,
  body: DecisionBody,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const res = await fetch(`/api/reviews/${id}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return { ok: true, status: res.status };
  const payload = await res.json().catch(() => ({}));
  return { ok: false, status: res.status, error: payload.error };
}

export async function sendChatMessage(
  id: string,
  message: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/reviews/${id}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (res.ok) return { ok: true };
  const payload = await res.json().catch(() => ({}));
  return { ok: false, error: payload.error ?? `status ${res.status}` };
}

export async function setChatModel(id: string, model: string): Promise<void> {
  await fetch(`/api/reviews/${id}/chat/model`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model }),
  });
}

export interface ChatEvent {
  status?: string;
  model?: string;
  delta?: string;
  tool?: string;
  input?: string;
  done?: boolean;
  content?: string;
  error?: string;
  costUsd?: number;
  usage?: ChatUsage;
}

export function subscribe(
  id: string,
  handlers: {
    onThread: (thread: ReviewThread) => void;
    onChat: (event: ChatEvent) => void;
  },
): () => void {
  const source = new EventSource(`/api/reviews/${id}/events`);
  source.addEventListener("thread", (event) => {
    const data = JSON.parse((event as MessageEvent).data);
    if (data) handlers.onThread(data);
  });
  source.addEventListener("chat", (event) => {
    handlers.onChat(JSON.parse((event as MessageEvent).data));
  });
  return () => source.close();
}
