import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "claude-oversee-hooksmoke-"),
);
const baseEnv = {
  ...process.env,
  CLAUDE_OVERSEE_DATA_DIR: dataDir,
  CLAUDE_OVERSEE_PORT: "43220",
  CLAUDE_OVERSEE_NO_BROWSER: "1",
};
const fixture = fs.readFileSync(
  path.join(root, "fixtures/exit-plan-mode.json"),
  "utf8",
);

let failures = 0;
const assert = (condition, label) => {
  console.log(`${condition ? "PASS" : "FAIL"}: ${label}`);
  if (!condition) failures++;
};

// Case A: toggle off → silent exit 0
{
  const { code, stdout, elapsed } = await runHook(fixture, baseEnv);
  assert(code === 0 && stdout === "", "toggle off: silent exit 0");
  assert(elapsed < 3000, "toggle off: fast");
}

// Enable toggle for the fixture's cwd
{
  const { code } = await run(
    process.execPath,
    [path.join(root, "dist/cli.cjs"), "on"],
    { env: baseEnv, cwd: JSON.parse(fixture).cwd },
  );
  assert(code === 0, "cli on succeeds");
}

// Case B: no server, spawn disabled → exit 0, no output, under 6s
{
  const { code, stdout, elapsed } = await runHook(fixture, {
    ...baseEnv,
    CLAUDE_OVERSEE_NO_SPAWN: "1",
  });
  assert(code === 0 && stdout === "", "no server + no spawn: silent exit 0");
  assert(elapsed < 6000, "no server + no spawn: under 6s");
}

// Case C: live server, scripted approve → allow JSON
{
  const server = spawn(process.execPath, [path.join(root, "dist/server.mjs")], {
    env: baseEnv,
    stdio: "ignore",
  });
  const base = await waitForServer();
  assert(!!base, "test server up");

  const hookPromise = runHook(fixture, {
    ...baseEnv,
    CLAUDE_OVERSEE_NO_SPAWN: "1",
  });
  const reviewId = await waitForReview(base);
  assert(!!reviewId, "hook registered review");
  await api("POST", `${base}/api/reviews/${reviewId}/decision`, {
    decision: "approve",
  });
  const { code, stdout } = await hookPromise;
  const parsed = safeParse(stdout);
  assert(
    code === 0 && parsed?.hookSpecificOutput?.permissionDecision === "allow",
    "approve flows back as allow JSON",
  );

  // Case D: request changes → deny with reason
  const hookPromise2 = runHook(fixture, {
    ...baseEnv,
    CLAUDE_OVERSEE_NO_SPAWN: "1",
  });
  await new Promise((r) => setTimeout(r, 500));
  await api("POST", `${base}/api/reviews/${reviewId}/decision`, {
    decision: "request_changes",
    overallNotes: "Split into two PRs.",
  });
  const second = await hookPromise2;
  const parsed2 = safeParse(second.stdout);
  assert(
    parsed2?.hookSpecificOutput?.permissionDecision === "deny" &&
      parsed2?.hookSpecificOutput?.permissionDecisionReason?.includes(
        "Split into two PRs.",
      ),
    "request_changes flows back as deny + reason",
  );

  server.kill();
}

fs.rmSync(dataDir, { recursive: true, force: true });
console.log(
  failures === 0
    ? "\nsmoke-hook: ALL PASS"
    : `\nsmoke-hook: ${failures} FAILURES`,
);
process.exit(failures === 0 ? 0 : 1);

function runHook(stdinData, env) {
  return run(process.execPath, [path.join(root, "dist/hook.cjs")], {
    env,
    stdinData,
  });
}

function run(command, args, { env, cwd, stdinData } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, {
      env,
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    if (stdinData) child.stdin.write(stdinData);
    child.stdin.end();
    child.on("close", (code) =>
      resolve({ code, stdout, stderr, elapsed: Date.now() - started }),
    );
  });
}

async function waitForServer() {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const info = JSON.parse(
        fs.readFileSync(path.join(dataDir, "server.json"), "utf8"),
      );
      const res = await fetch(`http://127.0.0.1:${info.port}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return `http://127.0.0.1:${info.port}`;
    } catch {
      // not up yet
    }
  }
  return null;
}

async function waitForReview(base) {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const threads = await api("GET", `${base}/api/reviews?status=pending`);
    if (threads?.length) return threads[0].id;
  }
  return null;
}

async function api(method, url, body) {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
