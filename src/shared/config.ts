import fs from "node:fs";
import { configPath } from "./paths.js";

export interface ClaudeOverseeConfig {
  port: number;
  model: string;
  hookDeadlineSec: number;
  idleShutdownMin: number;
}

export const DEFAULT_CONFIG: ClaudeOverseeConfig = {
  port: 43110,
  model: "claude-haiku-4-5-20251001",
  hookDeadlineSec: 3300,
  idleShutdownMin: 30,
};

export function loadConfig(): ClaudeOverseeConfig {
  let fileConfig: Partial<ClaudeOverseeConfig> = {};
  try {
    fileConfig = JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {}
  const env = process.env;
  return {
    port: intOr(env.CLAUDE_OVERSEE_PORT, fileConfig.port, DEFAULT_CONFIG.port),
    model: env.CLAUDE_OVERSEE_MODEL || fileConfig.model || DEFAULT_CONFIG.model,
    hookDeadlineSec: intOr(
      env.CLAUDE_OVERSEE_DEADLINE,
      fileConfig.hookDeadlineSec,
      DEFAULT_CONFIG.hookDeadlineSec,
    ),
    idleShutdownMin: intOr(
      env.CLAUDE_OVERSEE_IDLE_MIN,
      fileConfig.idleShutdownMin,
      DEFAULT_CONFIG.idleShutdownMin,
    ),
  };
}

function intOr(
  envValue: string | undefined,
  fileValue: number | undefined,
  fallback: number,
): number {
  if (envValue !== undefined) {
    const parsed = parseInt(envValue, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (typeof fileValue === "number" && Number.isFinite(fileValue))
    return fileValue;
  return fallback;
}
