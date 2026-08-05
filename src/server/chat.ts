import type http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { loadConfig } from "../shared/config.js";
import type { ChatUsage, ReviewThread } from "../shared/protocol.js";
import * as store from "./store.js";

const inFlight = new Set<string>();

let cachedClaudeBin: string | null | undefined;

function resolveClaudeExecutable(): string | null {
  if (cachedClaudeBin !== undefined) return cachedClaudeBin;
  const candidates: string[] = [];
  if (process.env.CLAUDE_OVERSEE_CLAUDE_BIN)
    candidates.push(process.env.CLAUDE_OVERSEE_CLAUDE_BIN);
  try {
    const found = execSync(
      process.platform === "win32" ? "where claude" : "which claude",
      { stdio: ["ignore", "pipe", "ignore"] },
    )
      .toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    candidates.push(...found);
  } catch {}
  const ext = process.platform === "win32" ? ".exe" : "";
  candidates.push(path.join(os.homedir(), ".local", "bin", `claude${ext}`));
  cachedClaudeBin =
    candidates.find((candidate) => {
      try {
        return fs.statSync(candidate).isFile();
      } catch {
        return false;
      }
    }) ?? null;
  return cachedClaudeBin;
}

export function setThreadModel(
  threadId: string,
  model: string,
): ReviewThread | undefined {
  return store.updateChat(threadId, (thread) => {
    thread.chat.model = model || undefined;
  });
}

export function handleChatMessage(
  threadId: string,
  message: string,
  res: http.ServerResponse,
): void {
  const thread = store.getThread(threadId);
  const respond = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (!thread) return respond(404, { error: "review not found" });
  if (!message.trim()) return respond(400, { error: "empty message" });
  if (inFlight.has(threadId))
    return respond(409, { error: "a sidecar reply is already in progress" });

  inFlight.add(threadId);
  store.updateChat(threadId, (stored) => {
    stored.chat.messages.push({
      role: "user",
      content: message,
      at: new Date().toISOString(),
    });
  });
  store.events.emit("chat", threadId, { status: "thinking" });
  respond(202, { ok: true });

  runChatTurn(threadId, message)
    .catch((error) => {
      store.events.emit("chat", threadId, { error: String(error) });
    })
    .finally(() => inFlight.delete(threadId));
}

async function runChatTurn(threadId: string, message: string): Promise<void> {
  const thread = store.getThread(threadId);
  if (!thread) return;
  const config = loadConfig();
  const model = thread.chat.model || config.model;
  const latestRevision = thread.revisions[thread.revisions.length - 1];

  let prompt = message;
  if (!thread.chat.sdkSessionId) {
    prompt = `${primer(thread)}\n\nUser: ${message}`;
  } else if (thread.chat.lastSeenRevision !== latestRevision?.index) {
    prompt = `${revisionUpdate(thread)}\n\nUser: ${message}`;
  }

  const stream = query({
    prompt,
    options: {
      model,
      cwd: thread.cwd,
      allowedTools: ["Read", "Grep", "Glob"],
      resume: thread.chat.sdkSessionId,
      ...(resolveClaudeExecutable()
        ? { pathToClaudeCodeExecutable: resolveClaudeExecutable()! }
        : {}),
    },
  });

  let finalText = "";
  let costUsd: number | undefined;
  let usage: ChatUsage | undefined;
  for await (const sdkMessage of stream as AsyncIterable<any>) {
    if (sdkMessage.type === "system" && sdkMessage.subtype === "init") {
      store.updateChat(threadId, (stored) => {
        stored.chat.sdkSessionId = sdkMessage.session_id;
        stored.chat.lastSeenRevision = latestRevision?.index;
      });
      store.events.emit("chat", threadId, {
        status: "started",
        model: sdkMessage.model ?? model,
      });
    } else if (sdkMessage.type === "assistant") {
      for (const block of sdkMessage.message?.content ?? []) {
        if (block.type === "text" && block.text) {
          finalText += block.text;
          store.events.emit("chat", threadId, { delta: block.text });
        } else if (block.type === "tool_use") {
          store.events.emit("chat", threadId, {
            tool: block.name,
            input: summarizeToolInput(block.input),
          });
        }
      }
    } else if (sdkMessage.type === "result") {
      if (typeof sdkMessage.result === "string" && sdkMessage.result) {
        finalText = sdkMessage.result;
      }
      if (typeof sdkMessage.total_cost_usd === "number") {
        costUsd = sdkMessage.total_cost_usd;
      }
      if (sdkMessage.usage) {
        usage = {
          inputTokens: sdkMessage.usage.input_tokens ?? 0,
          outputTokens: sdkMessage.usage.output_tokens ?? 0,
          cacheReadTokens: sdkMessage.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: sdkMessage.usage.cache_creation_input_tokens ?? 0,
        };
      }
    }
  }

  const finishedAt = new Date().toISOString();
  store.updateChat(threadId, (stored) => {
    stored.chat.messages.push({
      role: "assistant",
      content: finalText,
      model,
      at: finishedAt,
      costUsd,
      usage,
    });
  });
  store.events.emit("chat", threadId, {
    done: true,
    content: finalText,
    model,
    costUsd,
    usage,
  });
}

function primer(thread: ReviewThread): string {
  const latest = thread.revisions[thread.revisions.length - 1];
  const subject =
    thread.type === "plan"
      ? `Claude proposed the following implementation plan:\n\n---\n${(latest?.payload as any)?.plan ?? ""}\n---`
      : `Claude asked the user these clarifying questions:\n\n${JSON.stringify(latest?.payload, null, 2)}`;
  return [
    `You are Claude Oversee's sidecar reviewer for the project at ${thread.cwd}.`,
    `You have read-only access (Read, Grep, Glob) to the project files.`,
    subject,
    `Help the user understand, verify, and critique this. Be concise and concrete; cite files when you look things up. When asked to draft feedback or comments, write them ready to paste.`,
  ].join("\n\n");
}

function revisionUpdate(thread: ReviewThread): string {
  const latest = thread.revisions[thread.revisions.length - 1];
  const body =
    thread.type === "plan"
      ? (latest?.payload as any)?.plan
      : JSON.stringify(latest?.payload, null, 2);
  return `Update: the ${thread.type === "plan" ? "plan" : "questions"} changed (revision ${latest?.index}). Current version:\n\n---\n${body}\n---`;
}

function summarizeToolInput(input: unknown): string {
  const text = JSON.stringify(input ?? {});
  return text.length > 120 ? text.slice(0, 119) + "…" : text;
}
