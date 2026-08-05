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

// src/cli/main.ts
var import_node_fs3 = __toESM(require("node:fs"), 1);

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
function setEnabled(cwd, enabled) {
  import_node_fs2.default.mkdirSync(dataDir(), { recursive: true });
  const toggles = readToggles();
  toggles[projectKey(cwd)] = {
    cwd: import_node_path2.default.resolve(cwd),
    enabled,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const tmp = togglesPath() + ".tmp";
  import_node_fs2.default.writeFileSync(tmp, JSON.stringify(toggles, null, 2));
  import_node_fs2.default.renameSync(tmp, togglesPath());
}

// src/cli/main.ts
async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const cwd = process.cwd();
  switch (command) {
    case "on":
      setEnabled(cwd, true);
      console.log(`Claude Oversee ON for ${cwd}`);
      console.log(
        "Plans and questions from Claude Code sessions in this project now open in the browser."
      );
      break;
    case "off":
      setEnabled(cwd, false);
      console.log(`Claude Oversee OFF for ${cwd}. Normal CLI flow restored.`);
      break;
    case "status": {
      console.log(
        `Claude Oversee is ${isEnabled(cwd) ? "ON" : "OFF"} for ${cwd}`
      );
      const info = readServerInfo();
      if (!info) {
        console.log("Server: not running.");
        break;
      }
      const health = await tryFetchJson(
        `http://127.0.0.1:${info.port}/api/health`
      );
      if (!health?.ok) {
        console.log("Server: stale record (not responding).");
        break;
      }
      console.log(
        `Server: running on http://127.0.0.1:${info.port} (v${info.version})`
      );
      const threads = await tryFetchJson(
        `http://127.0.0.1:${info.port}/api/reviews?status=pending`
      );
      for (const thread of threads ?? []) {
        console.log(
          `Pending ${thread.type}: http://127.0.0.1:${info.port}/review/${thread.id} (${thread.projectName})`
        );
      }
      break;
    }
    case "config": {
      const [action, key, value] = rest;
      if (action === "get" || action === void 0) {
        console.log(JSON.stringify(loadConfig(), null, 2));
      } else if (action === "set" && key && value !== void 0) {
        if (!(key in DEFAULT_CONFIG)) {
          console.error(
            `Unknown key "${key}". Valid: ${Object.keys(DEFAULT_CONFIG).join(", ")}`
          );
          process.exitCode = 1;
          break;
        }
        import_node_fs3.default.mkdirSync(dataDir(), { recursive: true });
        let current = {};
        try {
          current = JSON.parse(import_node_fs3.default.readFileSync(configPath(), "utf8"));
        } catch {
        }
        const numeric = Number(value);
        current[key] = key === "model" ? value : Number.isNaN(numeric) ? value : numeric;
        import_node_fs3.default.writeFileSync(configPath(), JSON.stringify(current, null, 2));
        console.log(`Set ${key} = ${current[key]}`);
      } else {
        console.error("Usage: config get | config set <key> <value>");
        process.exitCode = 1;
      }
      break;
    }
    default:
      console.log("Usage: claude-oversee <on|off|status|config>");
      process.exitCode = command ? 1 : 0;
  }
}
function readServerInfo() {
  try {
    return JSON.parse(import_node_fs3.default.readFileSync(serverInfoPath(), "utf8"));
  } catch {
    return null;
  }
}
async function tryFetchJson(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2e3) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
main();
