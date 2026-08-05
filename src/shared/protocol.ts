export const PROTOCOL_VERSION = "0.2.1";

export type ReviewType = "plan" | "questions";
export type UserDecision = "approve" | "request_changes" | "terminal";
export type RevisionStatus = "pending" | "decided" | "superseded" | "expired";
export type HookDecision = "allow" | "deny" | "ask";

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

export interface PlanPayload {
  plan: string;
}

export interface QuestionsPayload {
  questions: Question[];
}

export type ReviewPayload = PlanPayload | QuestionsPayload;

export interface CreateReviewRequest {
  type: ReviewType;
  sessionId: string;
  cwd: string;
  toolUseId?: string;
  payload: ReviewPayload;
}

export interface CreateReviewResponse {
  reviewId: string;
  revisionId: string;
  url: string;
}

export interface TextQuoteAnchor {
  exact: string;
  prefix: string;
  suffix: string;
  offsetHint: number;
}

export interface ReviewComment {
  id: string;
  anchor: TextQuoteAnchor;
  text: string;
  revisionIndex: number;
  orphaned?: boolean;
}

export interface QuestionAnswer {
  index: number;
  question: string;
  header?: string;
  selected: string[];
  notes?: string;
}

export interface DecisionRequest {
  decision: UserDecision;
  comments?: ReviewComment[];
  answers?: QuestionAnswer[];
  overallNotes?: string;
}

export interface DecisionResult {
  decision: HookDecision;
  reason?: string;
}

export interface ChatUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  model?: string;
  at: string;
  costUsd?: number;
  usage?: ChatUsage;
}

export interface Revision {
  id: string;
  index: number;
  status: RevisionStatus;
  payload: ReviewPayload;
  createdAt: string;
  lastPolledAt: string;
  result?: DecisionResult;
}

export interface ReviewThread {
  id: string;
  type: ReviewType;
  sessionId: string;
  cwd: string;
  projectName: string;
  revisions: Revision[];
  comments: ReviewComment[];
  overallNotes?: string;
  chat: {
    sdkSessionId?: string;
    model?: string;
    lastSeenRevision?: number;
    messages: ChatMessage[];
  };
  createdAt: string;
  updatedAt: string;
}

export interface ServerInfo {
  port: number;
  pid: number;
  version: string;
  token: string;
  startedAt: string;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
}
