import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { serverInfoPath } from "../shared/paths.js";
import { loadConfig } from "../shared/config.js";
import { isEnabled } from "../shared/toggles.js";
import { PROTOCOL_VERSION } from "../shared/protocol.js";
import type {
  CreateReviewRequest,
  DecisionResult,
  HealthResponse,
  Question,
  ReviewPayload,
  ReviewType,
  ServerInfo,
} from "../shared/protocol.js";

interface HookInput {
  session_id: string;
  cwd: string;
  tool_name: string;
  tool_use_id?: string;
  tool_input: any;
}

async function main(): Promise<void> {
  const input = JSON.parse(await readStdin()) as HookInput;

  if (
    input.tool_name !== "ExitPlanMode" &&
    input.tool_name !== "AskUserQuestion"
  ) {
    return;
  }
  if (!isEnabled(input.cwd)) return;

  let type: ReviewType;
  let payload: ReviewPayload;
  if (input.tool_name === "ExitPlanMode") {
    const plan = String(input.tool_input?.plan ?? "");
    if (!plan) return;
    type = "plan";
    payload = { plan };
  } else {
    const questions: Question[] = input.tool_input?.questions ?? [];
    if (!questions.length) return;
    type = "questions";
    payload = { questions };
  }

  const config = loadConfig();
  let baseUrl = await ensureServer();
  if (!baseUrl) return;

  const createRequest: CreateReviewRequest = {
    type,
    sessionId: input.session_id,
    cwd: input.cwd,
    toolUseId: input.tool_use_id,
    payload,
  };
  const created = await postJson(`${baseUrl}/api/reviews`, createRequest);
  if (!created?.url) return;

  openBrowser(created.url);
  process.stderr.write(`Claude Oversee review ready: ${created.url}\n`);

  const deadline = Date.now() + config.hookDeadlineSec * 1000;
  let failures = 0;
  let respawned = false;
  while (Date.now() < deadline) {
    const pollUrl = `${baseUrl}/api/reviews/${created.reviewId}/revisions/${created.revisionId}/decision?wait=25`;
    let response: Response;
    try {
      response = await fetch(pollUrl, { signal: AbortSignal.timeout(30_000) });
    } catch {
      failures++;
      if (failures >= 3) {
        if (respawned) return emit({ decision: "ask" });
        respawned = true;
        failures = 0;
        const revived = await ensureServer();
        if (!revived) return emit({ decision: "ask" });
        baseUrl = revived;
        const recreated = await postJson(
          `${baseUrl}/api/reviews`,
          createRequest,
        );
        if (!recreated?.url) return emit({ decision: "ask" });
        created.reviewId = recreated.reviewId;
        created.revisionId = recreated.revisionId;
        openBrowser(recreated.url);
      }
      continue;
    }
    failures = 0;
    if (response.status === 200) {
      return emit((await response.json()) as DecisionResult);
    }
    if (response.status === 204) continue;
    return emit({ decision: "ask" });
  }
  return emit({ decision: "ask" });
}

function emit(result: DecisionResult) {
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: result.decision,
      ...(result.reason
        ? { permissionDecisionReason: result.reason }
        : result.decision === "ask"
          ? {
              permissionDecisionReason:
                "Claude Oversee handed this back to the terminal. Answer here.",
            }
          : {}),
    },
  };
  process.stdout.write(JSON.stringify(output));
}

async function ensureServer(): Promise<string | null> {
  const existing = await healthyBaseUrl();
  if (existing) return existing;
  if (process.env.CLAUDE_OVERSEE_NO_SPAWN === "1") return null;

  const serverBundle = path.join(__dirname, "server.mjs");
  if (!fs.existsSync(serverBundle)) return null;
  try {
    const child = spawn(process.execPath, [serverBundle], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch {
    return null;
  }
  const spawnDeadline = Date.now() + 5000;
  while (Date.now() < spawnDeadline) {
    await sleep(250);
    const baseUrl = await healthyBaseUrl();
    if (baseUrl) return baseUrl;
  }
  return null;
}

async function healthyBaseUrl(): Promise<string | null> {
  let info: ServerInfo;
  try {
    info = JSON.parse(fs.readFileSync(serverInfoPath(), "utf8"));
  } catch {
    return null;
  }
  const baseUrl = `http://127.0.0.1:${info.port}`;
  try {
    const response = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return null;
    const health = (await response.json()) as HealthResponse;
    if (!health.ok) return null;
    if (health.version !== PROTOCOL_VERSION) {
      await postJson(`${baseUrl}/api/shutdown`, { token: info.token });
      await sleep(500);
      return null;
    }
    return baseUrl;
  } catch {
    return null;
  }
}

async function postJson(url: string, body: unknown): Promise<any | null> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function openBrowser(url: string) {
  if (process.env.CLAUDE_OVERSEE_NO_BROWSER === "1") return;
  try {
    const [command, args] =
      process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : process.platform === "darwin"
          ? ["open", [url]]
          : ["xdg-open", [url]];
    const child = spawn(command, args as string[], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } catch {
    // URL already printed to stderr
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

main()
  .catch((error) => {
    process.stderr.write(`claude-oversee hook error: ${String(error)}\n`);
  })
  .finally(() => process.exit(0));
