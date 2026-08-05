"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/hook/main.ts
var import_node_fs3 = __toESM(require("node:fs"), 1);
var import_node_path3 = __toESM(require("node:path"), 1);
var import_node_child_process = require("node:child_process");

// src/shared/paths.ts
var import_node_os = __toESM(require("node:os"), 1);
var import_node_path = __toESM(require("node:path"), 1);
function dataDir() {
  return process.env.CLAUDE_OVERSEE_DATA_DIR || import_node_path.default.join(import_node_os.default.homedir(), ".claude-oversee");
}
var serverInfoPath = () => import_node_path.default.join(dataDir(), "server.json");
var togglesPath = () => import_node_path.default.join(dataDir(), "toggles.json");
var configPath = () => import_node_path.default.join(dataDir(), "config.json");

// src/shared/config.ts
var import_node_fs = __toESM(require("node:fs"), 1);
var DEFAULT_CONFIG = {
  port: 43110,
  model: "claude-haiku-4-5-20251001",
  hookDeadlineSec: 3300,
  idleShutdownMin: 30
};
function loadConfig() {
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(import_node_fs.default.readFileSync(configPath(), "utf8"));
  } catch {
  }
  const env = process.env;
  return {
    port: intOr(env.CLAUDE_OVERSEE_PORT, fileConfig.port, DEFAULT_CONFIG.port),
    model: env.CLAUDE_OVERSEE_MODEL || fileConfig.model || DEFAULT_CONFIG.model,
    hookDeadlineSec: intOr(
      env.CLAUDE_OVERSEE_DEADLINE,
      fileConfig.hookDeadlineSec,
      DEFAULT_CONFIG.hookDeadlineSec
    ),
    idleShutdownMin: intOr(
      env.CLAUDE_OVERSEE_IDLE_MIN,
      fileConfig.idleShutdownMin,
      DEFAULT_CONFIG.idleShutdownMin
    )
  };
}
function intOr(envValue, fileValue, fallback) {
  if (envValue !== void 0) {
    const parsed = parseInt(envValue, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (typeof fileValue === "number" && Number.isFinite(fileValue))
    return fileValue;
  return fallback;
}

// src/shared/toggles.ts
var import_node_fs2 = __toESM(require("node:fs"), 1);
var import_node_path2 = __toESM(require("node:path"), 1);
var import_node_crypto = __toESM(require("node:crypto"), 1);
function projectKey(cwd) {
  let normalized = import_node_path2.default.resolve(cwd);
  if (process.platform === "win32") normalized = normalized.toLowerCase();
  return import_node_crypto.default.createHash("sha1").update(normalized).digest("hex");
}
function readToggles() {
  try {
    return JSON.parse(import_node_fs2.default.readFileSync(togglesPath(), "utf8"));
  } catch {
    return {};
  }
}
function isEnabled(cwd) {
  const entry = readToggles()[projectKey(cwd)];
  return entry?.enabled === true;
}

// src/shared/protocol.ts
var PROTOCOL_VERSION = "0.2.1";

// src/hook/main.ts
async function main() {
  const input = JSON.parse(await readStdin());
  if (input.tool_name !== "ExitPlanMode" && input.tool_name !== "AskUserQuestion") {
    return;
  }
  if (!isEnabled(input.cwd)) return;
  let type;
  let payload;
  if (input.tool_name === "ExitPlanMode") {
    const plan = String(input.tool_input?.plan ?? "");
    if (!plan) return;
    type = "plan";
    payload = { plan };
  } else {
    const questions = input.tool_input?.questions ?? [];
    if (!questions.length) return;
    type = "questions";
    payload = { questions };
  }
  const config = loadConfig();
  let baseUrl = await ensureServer();
  if (!baseUrl) return;
  const createRequest = {
    type,
    sessionId: input.session_id,
    cwd: input.cwd,
    toolUseId: input.tool_use_id,
    payload
  };
  const created = await postJson(`${baseUrl}/api/reviews`, createRequest);
  if (!created?.url) return;
  openBrowser(created.url);
  process.stderr.write(`Claude Oversee review ready: ${created.url}
`);
  const deadline = Date.now() + config.hookDeadlineSec * 1e3;
  let failures = 0;
  let respawned = false;
  while (Date.now() < deadline) {
    const pollUrl = `${baseUrl}/api/reviews/${created.reviewId}/revisions/${created.revisionId}/decision?wait=25`;
    let response;
    try {
      response = await fetch(pollUrl, { signal: AbortSignal.timeout(3e4) });
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
          createRequest
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
      return emit(await response.json());
    }
    if (response.status === 204) continue;
    return emit({ decision: "ask" });
  }
  return emit({ decision: "ask" });
}
function emit(result) {
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: result.decision,
      ...result.reason ? { permissionDecisionReason: result.reason } : result.decision === "ask" ? {
        permissionDecisionReason: "Claude Oversee handed this back to the terminal. Answer here."
      } : {}
    }
  };
  process.stdout.write(JSON.stringify(output));
}
async function ensureServer() {
  const existing = await healthyBaseUrl();
  if (existing) return existing;
  if (process.env.CLAUDE_OVERSEE_NO_SPAWN === "1") return null;
  const serverBundle = import_node_path3.default.join(__dirname, "server.mjs");
  if (!import_node_fs3.default.existsSync(serverBundle)) return null;
  try {
    const child = (0, import_node_child_process.spawn)(process.execPath, [serverBundle], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
  } catch {
    return null;
  }
  const spawnDeadline = Date.now() + 5e3;
  while (Date.now() < spawnDeadline) {
    await sleep(250);
    const baseUrl = await healthyBaseUrl();
    if (baseUrl) return baseUrl;
  }
  return null;
}
async function healthyBaseUrl() {
  let info;
  try {
    info = JSON.parse(import_node_fs3.default.readFileSync(serverInfoPath(), "utf8"));
  } catch {
    return null;
  }
  const baseUrl = `http://127.0.0.1:${info.port}`;
  try {
    const response = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(1500)
    });
    if (!response.ok) return null;
    const health = await response.json();
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
async function postJson(url, body) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5e3)
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}
function openBrowser(url) {
  if (process.env.CLAUDE_OVERSEE_NO_BROWSER === "1") return;
  try {
    const [command, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
    const child = (0, import_node_child_process.spawn)(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
  } catch {
  }
}
function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => data += chunk);
    process.stdin.on("end", () => resolve(data));
  });
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
main().catch((error) => {
  process.stderr.write(`claude-oversee hook error: ${String(error)}
`);
}).finally(() => process.exit(0));
