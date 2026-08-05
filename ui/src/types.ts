export type ReviewType = "plan" | "questions";
export type UserDecision = "approve" | "request_changes" | "terminal";
export type RevisionStatus = "pending" | "decided" | "superseded" | "expired";

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
  payload: { plan?: string; questions?: Question[] };
  createdAt: string;
  lastPolledAt: string;
  result?: { decision: string; reason?: string };
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
