import fs from "node:fs";
import { dataDir, configPath, serverInfoPath } from "../shared/paths.js";
import { loadConfig, DEFAULT_CONFIG } from "../shared/config.js";
import { isEnabled, setEnabled } from "../shared/toggles.js";
import type { ServerInfo, ReviewThread } from "../shared/protocol.js";

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const cwd = process.cwd();

  switch (command) {
    case "on":
      setEnabled(cwd, true);
      console.log(`Claude Oversee ON for ${cwd}`);
      console.log(
        "Plans and questions from Claude Code sessions in this project now open in the browser.",
      );
      break;
    case "off":
      setEnabled(cwd, false);
      console.log(`Claude Oversee OFF for ${cwd}. Normal CLI flow restored.`);
      break;
    case "status": {
      console.log(
        `Claude Oversee is ${isEnabled(cwd) ? "ON" : "OFF"} for ${cwd}`,
      );
      const info = readServerInfo();
      if (!info) {
        console.log("Server: not running.");
        break;
      }
      const health = await tryFetchJson(
        `http://127.0.0.1:${info.port}/api/health`,
      );
      if (!health?.ok) {
        console.log("Server: stale record (not responding).");
        break;
      }
      console.log(
        `Server: running on http://127.0.0.1:${info.port} (v${info.version})`,
      );
      const threads: ReviewThread[] | null = await tryFetchJson(
        `http://127.0.0.1:${info.port}/api/reviews?status=pending`,
      );
      for (const thread of threads ?? []) {
        console.log(
          `Pending ${thread.type}: http://127.0.0.1:${info.port}/review/${thread.id} (${thread.projectName})`,
        );
      }
      break;
    }
    case "config": {
      const [action, key, value] = rest;
      if (action === "get" || action === undefined) {
        console.log(JSON.stringify(loadConfig(), null, 2));
      } else if (action === "set" && key && value !== undefined) {
        if (!(key in DEFAULT_CONFIG)) {
          console.error(
            `Unknown key "${key}". Valid: ${Object.keys(DEFAULT_CONFIG).join(", ")}`,
          );
          process.exitCode = 1;
          break;
        }
        fs.mkdirSync(dataDir(), { recursive: true });
        let current: Record<string, unknown> = {};
        try {
          current = JSON.parse(fs.readFileSync(configPath(), "utf8"));
        } catch {}
        const numeric = Number(value);
        current[key] =
          key === "model" ? value : Number.isNaN(numeric) ? value : numeric;
        fs.writeFileSync(configPath(), JSON.stringify(current, null, 2));
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

function readServerInfo(): ServerInfo | null {
  try {
    return JSON.parse(fs.readFileSync(serverInfoPath(), "utf8"));
  } catch {
    return null;
  }
}

async function tryFetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

main();
