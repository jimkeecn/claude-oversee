import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { dataDir, serverInfoPath } from "../shared/paths.js";
import { loadConfig } from "../shared/config.js";
import { PROTOCOL_VERSION } from "../shared/protocol.js";
import type {
  CreateReviewRequest,
  DecisionRequest,
  ServerInfo,
} from "../shared/protocol.js";
import * as store from "./store.js";
import { handleChatMessage, setThreadModel } from "./chat.js";

const config = loadConfig();
const token = crypto.randomBytes(16).toString("hex");
const bundleDir = path.dirname(fileURLToPath(import.meta.url));
const uiDir = path.join(bundleDir, "ui");

let lastActivity = Date.now();
let sseClients = 0;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".map": "application/json",
  ".woff2": "font/woff2",
};

function json(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(data);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  lastActivity = Date.now();
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const route = url.pathname;
  try {
    if (route === "/api/health") {
      return json(res, 200, { ok: true, version: PROTOCOL_VERSION });
    }

    if (route === "/api/shutdown" && req.method === "POST") {
      const body = await readBody(req);
      if (body.token !== token) return json(res, 403, { error: "bad token" });
      json(res, 200, { ok: true });
      shutdown("shutdown requested");
      return;
    }

    if (route === "/api/reviews" && req.method === "POST") {
      const body = (await readBody(req)) as CreateReviewRequest;
      if (!body.sessionId || !body.type || !body.payload) {
        return json(res, 400, { error: "sessionId, type, payload required" });
      }
      const { thread, revision } = store.createOrAppend(body);
      const port = (server.address() as { port: number }).port;
      return json(res, 200, {
        reviewId: thread.id,
        revisionId: revision.id,
        url: `http://127.0.0.1:${port}/review/${thread.id}`,
      });
    }

    if (route === "/api/reviews" && req.method === "GET") {
      let threads = store.listThreads();
      if (url.searchParams.get("status") === "pending") {
        threads = threads.filter((thread) =>
          thread.revisions.some((rev) => rev.status === "pending"),
        );
      }
      return json(res, 200, threads);
    }

    const decisionMatch = route.match(
      /^\/api\/reviews\/([^/]+)\/revisions\/([^/]+)\/decision$/,
    );
    if (decisionMatch && req.method === "GET") {
      const [, threadId, revisionId] = decisionMatch;
      const waitSec = Math.min(
        parseInt(url.searchParams.get("wait") ?? "0", 10) || 0,
        25,
      );
      return waitForDecision(res, threadId, revisionId, waitSec);
    }

    const threadMatch = route.match(/^\/api\/reviews\/([^/]+)$/);
    if (threadMatch && req.method === "GET") {
      const thread = store.getThread(threadMatch[1]);
      return thread
        ? json(res, 200, thread)
        : json(res, 404, { error: "not found" });
    }

    const decideMatch = route.match(/^\/api\/reviews\/([^/]+)\/decision$/);
    if (decideMatch && req.method === "POST") {
      const body = (await readBody(req)) as DecisionRequest;
      const outcome = store.decide(decideMatch[1], body);
      if ("error" in outcome)
        return json(res, outcome.code, { error: outcome.error });
      return json(res, 200, outcome.result);
    }

    const eventsMatch = route.match(/^\/api\/reviews\/([^/]+)\/events$/);
    if (eventsMatch && req.method === "GET") {
      return streamEvents(res, eventsMatch[1]);
    }

    const chatMatch = route.match(/^\/api\/reviews\/([^/]+)\/chat$/);
    if (chatMatch && req.method === "POST") {
      const body = await readBody(req);
      return handleChatMessage(chatMatch[1], String(body.message ?? ""), res);
    }

    const modelMatch = route.match(/^\/api\/reviews\/([^/]+)\/chat\/model$/);
    if (modelMatch && req.method === "POST") {
      const body = await readBody(req);
      const thread = setThreadModel(modelMatch[1], String(body.model ?? ""));
      return thread
        ? json(res, 200, { ok: true, model: thread.chat.model })
        : json(res, 404, { error: "not found" });
    }

    if (route.startsWith("/api/")) {
      return json(res, 404, { error: "unknown endpoint" });
    }

    return serveStatic(route, res);
  } catch (error) {
    return json(res, 500, { error: String(error) });
  }
});

function waitForDecision(
  res: http.ServerResponse,
  threadId: string,
  revisionId: string,
  waitSec: number,
): void {
  const check = (): boolean => {
    const revision = store.findRevision(threadId, revisionId);
    if (!revision) {
      json(res, 404, { error: "not found" });
      return true;
    }
    store.touchPoll(threadId, revisionId);
    if (revision.status === "decided" && revision.result) {
      json(res, 200, revision.result);
      return true;
    }
    if (revision.status === "superseded" || revision.status === "expired") {
      json(res, 410, { error: revision.status });
      return true;
    }
    return false;
  };
  if (check()) return;
  if (waitSec <= 0) {
    res.writeHead(204);
    res.end();
    return;
  }
  const listener = (changedThreadId: string) => {
    if (changedThreadId !== threadId) return;
    if (check()) cleanup();
  };
  const timer = setTimeout(() => {
    cleanup();
    store.touchPoll(threadId, revisionId);
    res.writeHead(204);
    res.end();
  }, waitSec * 1000);
  const cleanup = () => {
    clearTimeout(timer);
    store.events.off("decision", listener);
    store.events.off("revision", listener);
  };
  store.events.on("decision", listener);
  store.events.on("revision", listener);
  res.on("close", cleanup);
}

function streamEvents(res: http.ServerResponse, threadId: string) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  sseClients++;
  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  send("hello", { threadId });
  const onRevision = (changedId: string) => {
    if (changedId === threadId)
      send("thread", store.getThread(threadId) ?? null);
  };
  const onDecision = onRevision;
  const onChat = (changedId: string, chunk: unknown) => {
    if (changedId === threadId) send("chat", chunk);
  };
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 20000);
  store.events.on("revision", onRevision);
  store.events.on("decision", onDecision);
  store.events.on("chat", onChat);
  res.on("close", () => {
    sseClients--;
    clearInterval(heartbeat);
    store.events.off("revision", onRevision);
    store.events.off("decision", onDecision);
    store.events.off("chat", onChat);
  });
}

function serveStatic(route: string, res: http.ServerResponse) {
  let relative = route === "/" ? "index.html" : route.slice(1);
  let filePath = path.join(uiDir, relative);
  if (!filePath.startsWith(uiDir) || !fs.existsSync(filePath)) {
    filePath = path.join(uiDir, "index.html");
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(503, { "content-type": "text/plain" });
    res.end("Claude Oversee UI not built. Run: npm run build");
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[path.extname(filePath)] ?? "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(res);
}

function shutdown(why: string) {
  try {
    const info = readServerInfo();
    if (info && info.pid === process.pid) fs.unlinkSync(serverInfoPath());
  } catch {}
  console.log(`claude-oversee server exiting: ${why}`);
  server.close();
  setTimeout(() => process.exit(0), 200).unref();
}

function readServerInfo(): ServerInfo | null {
  try {
    return JSON.parse(fs.readFileSync(serverInfoPath(), "utf8"));
  } catch {
    return null;
  }
}

function listen(portIndex: number) {
  if (portIndex >= 10) {
    console.error("claude-oversee: no free port in range");
    process.exit(1);
  }
  const port = config.port + portIndex;
  server.once("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE" || error.code === "EACCES") {
      listen(portIndex + 1);
    } else {
      console.error(`claude-oversee server error: ${error.message}`);
      process.exit(1);
    }
  });
  server.listen(port, "127.0.0.1", () => {
    fs.mkdirSync(dataDir(), { recursive: true });
    const info: ServerInfo = {
      port,
      pid: process.pid,
      version: PROTOCOL_VERSION,
      token,
      startedAt: new Date().toISOString(),
    };
    const tmp = serverInfoPath() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(info, null, 2));
    fs.renameSync(tmp, serverInfoPath());
    console.log(`claude-oversee server listening on http://127.0.0.1:${port}`);
  });
}

store.loadThreads();
listen(0);

setInterval(() => store.sweepExpired(120_000), 30_000).unref();

setInterval(() => {
  const idleMs = Date.now() - lastActivity;
  if (
    idleMs > config.idleShutdownMin * 60_000 &&
    !store.hasPendingRevisions() &&
    sseClients === 0
  ) {
    shutdown("idle");
  }
}, 60_000).unref();

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
