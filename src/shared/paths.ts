import os from "node:os";
import path from "node:path";

export function dataDir(): string {
  return (
    process.env.CLAUDE_OVERSEE_DATA_DIR ||
    path.join(os.homedir(), ".claude-oversee")
  );
}

export const serverInfoPath = () => path.join(dataDir(), "server.json");
export const togglesPath = () => path.join(dataDir(), "toggles.json");
export const configPath = () => path.join(dataDir(), "config.json");
export const reviewsDir = () => path.join(dataDir(), "reviews");
