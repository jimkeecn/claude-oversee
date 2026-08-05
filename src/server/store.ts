import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { reviewsDir } from "../shared/paths.js";
import type {
  CreateReviewRequest,
  DecisionRequest,
  DecisionResult,
  Revision,
  ReviewThread,
} from "../shared/protocol.js";
import { composeReason } from "./reason.js";

export const events = new EventEmitter();
events.setMaxListeners(100);

const threads = new Map<string, ReviewThread>();

const randomId = (prefix: string) =>
  `${prefix}_${crypto.randomBytes(5).toString("hex")}`;

export function loadThreads() {
  let files: string[] = [];
  try {
    files = fs
      .readdirSync(reviewsDir())
      .filter((name) => name.endsWith(".json"));
  } catch {
    return;
  }
  for (const file of files) {
    try {
      const thread: ReviewThread = JSON.parse(
        fs.readFileSync(path.join(reviewsDir(), file), "utf8"),
      );
      threads.set(thread.id, thread);
    } catch {}
  }
}

function persist(thread: ReviewThread) {
  thread.updatedAt = new Date().toISOString();
  fs.mkdirSync(reviewsDir(), { recursive: true });
  const target = path.join(reviewsDir(), `${thread.id}.json`);
  const tmp = target + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(thread, null, 2));
  fs.renameSync(tmp, target);
}

export function listThreads(): ReviewThread[] {
  return [...threads.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function getThread(id: string): ReviewThread | undefined {
  return threads.get(id);
}

export function hasPendingRevisions(): boolean {
  return listThreads().some((thread) =>
    thread.revisions.some((rev) => rev.status === "pending"),
  );
}

export function createOrAppend(request: CreateReviewRequest): {
  thread: ReviewThread;
  revision: Revision;
} {
  const now = new Date().toISOString();
  let thread = [...threads.values()].find(
    (candidate) =>
      candidate.sessionId === request.sessionId &&
      candidate.type === request.type,
  );
  if (!thread) {
    thread = {
      id: randomId(request.type === "plan" ? "pln" : "qst"),
      type: request.type,
      sessionId: request.sessionId,
      cwd: request.cwd,
      projectName: path.basename(request.cwd) || request.cwd,
      revisions: [],
      comments: [],
      chat: { messages: [] },
      createdAt: now,
      updatedAt: now,
    };
    threads.set(thread.id, thread);
  }
  for (const rev of thread.revisions) {
    if (rev.status === "pending") {
      rev.status = "superseded";
      events.emit("revision", thread.id, rev);
    }
  }
  const revision: Revision = {
    id: randomId("rev"),
    index: thread.revisions.length + 1,
    status: "pending",
    payload: request.payload,
    createdAt: now,
    lastPolledAt: now,
  };
  thread.revisions.push(revision);
  persist(thread);
  events.emit("revision", thread.id, revision);
  return { thread, revision };
}

export function decide(
  threadId: string,
  request: DecisionRequest,
):
  | { revision: Revision; result: DecisionResult }
  | { error: string; code: number } {
  const thread = threads.get(threadId);
  if (!thread) return { error: "review not found", code: 404 };
  const revision = [...thread.revisions]
    .reverse()
    .find((rev) => rev.status === "pending");
  if (!revision)
    return { error: "no pending revision, answer in the terminal", code: 410 };

  if (request.comments) thread.comments = request.comments;
  if (request.overallNotes !== undefined)
    thread.overallNotes = request.overallNotes;

  const result: DecisionResult =
    request.decision === "approve"
      ? { decision: "allow" }
      : request.decision === "terminal"
        ? { decision: "ask" }
        : { decision: "deny", reason: composeReason(thread, request) };

  revision.status = "decided";
  revision.result = result;
  persist(thread);
  events.emit("decision", thread.id, revision);
  return { revision, result };
}

export function findRevision(
  threadId: string,
  revisionId: string,
): Revision | undefined {
  return threads.get(threadId)?.revisions.find((rev) => rev.id === revisionId);
}

export function touchPoll(threadId: string, revisionId: string) {
  const revision = findRevision(threadId, revisionId);
  if (revision) revision.lastPolledAt = new Date().toISOString();
}

export function sweepExpired(staleMs: number) {
  const cutoff = Date.now() - staleMs;
  for (const thread of threads.values()) {
    let changed = false;
    for (const revision of thread.revisions) {
      if (
        revision.status === "pending" &&
        Date.parse(revision.lastPolledAt) < cutoff
      ) {
        revision.status = "expired";
        changed = true;
        events.emit("revision", thread.id, revision);
      }
    }
    if (changed) persist(thread);
  }
}

export function updateChat(
  threadId: string,
  mutate: (thread: ReviewThread) => void,
): ReviewThread | undefined {
  const thread = threads.get(threadId);
  if (!thread) return undefined;
  mutate(thread);
  persist(thread);
  // sync connected UIs: chat messages and model changes ride the same
  // full-thread SSE channel as revision updates
  events.emit("revision", thread.id, null);
  return thread;
}
