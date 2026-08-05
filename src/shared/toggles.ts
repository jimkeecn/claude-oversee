import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dataDir, togglesPath } from "./paths.js";

interface ToggleEntry {
  cwd: string;
  enabled: boolean;
  updatedAt: string;
}

type Toggles = Record<string, ToggleEntry>;

export function projectKey(cwd: string): string {
  let normalized = path.resolve(cwd);
  if (process.platform === "win32") normalized = normalized.toLowerCase();
  return crypto.createHash("sha1").update(normalized).digest("hex");
}

function readToggles(): Toggles {
  try {
    return JSON.parse(fs.readFileSync(togglesPath(), "utf8"));
  } catch {
    return {};
  }
}

export function isEnabled(cwd: string): boolean {
  const entry = readToggles()[projectKey(cwd)];
  return entry?.enabled === true;
}

export function setEnabled(cwd: string, enabled: boolean) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const toggles = readToggles();
  toggles[projectKey(cwd)] = {
    cwd: path.resolve(cwd),
    enabled,
    updatedAt: new Date().toISOString(),
  };
  const tmp = togglesPath() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(toggles, null, 2));
  fs.renameSync(tmp, togglesPath());
}
