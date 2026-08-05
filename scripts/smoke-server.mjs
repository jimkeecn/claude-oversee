import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-oversee-smoke-"));
const env = {
  ...process.env,
  CLAUDE_OVERSEE_DATA_DIR: dataDir,
  CLAUDE_OVERSEE_PORT: "43210",
};

let failures = 0;
const assert = (condition, label) => {
  console.log(`${condition ? "PASS" : "FAIL"}: ${label}`);
  if (!condition) failures++;
};

const server = spawn(process.execPath, [path.join(root, "dist/server.mjs")], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(d));

const base = await waitForServer();
assert(!!base, "server starts and reports healthy");
if (!base) {
  server.kill();
  process.exit(1);
}

const created = await api("POST", `${base}/api/reviews`, {
  type: "plan",
  sessionId: "smoke-1",
  cwd: root,
  payload: { plan: "# Smoke plan\n\nDo the thing." },
});
assert(created?.reviewId && created?.revisionId, "review created");

const immediate = await fetch(
  `${base}/api/reviews/${created.reviewId}/revisions/${created.revisionId}/decision`,
);
assert(immediate.status === 204, "undecided poll returns 204");

const pollPromise = fetch(
  `${base}/api/reviews/${created.reviewId}/revisions/${created.revisionId}/decision?wait=10`,
);
await new Promise((r) => setTimeout(r, 300));
const decisionResponse = await api(
  "POST",
  `${base}/api/reviews/${created.reviewId}/decision`,
  {
    decision: "request_changes",
    comments: [
      {
        id: "c1",
        revisionIndex: 1,
        anchor: {
          exact: "Do the thing.",
          prefix: "",
          suffix: "",
          offsetHint: 15,
        },
        text: "Too vague — spell out the steps.",
      },
    ],
    overallNotes: "Keep it minimal.",
  },
);
assert(decisionResponse?.decision === "deny", "decision maps to deny");

const polled = await pollPromise;
assert(polled.status === 200, "long-poll resolves on decision");
const result = await polled.json();
assert(
  result.decision === "deny" &&
    result.reason?.includes("Too vague") &&
    result.reason?.includes("Keep it minimal"),
  "reason composed with comment + notes",
);

const second = await api("POST", `${base}/api/reviews`, {
  type: "plan",
  sessionId: "smoke-1",
  cwd: root,
  payload: { plan: "# Smoke plan v2\n\nDo the thing, in two steps." },
});
assert(second?.reviewId === created.reviewId, "revision joins same thread");
const thread = await api("GET", `${base}/api/reviews/${created.reviewId}`);
assert(thread?.revisions?.length === 2, "thread has two revisions");

const questions = await api("POST", `${base}/api/reviews`, {
  type: "questions",
  sessionId: "smoke-1",
  cwd: root,
  payload: {
    questions: [
      { question: "A or B?", header: "Choice", options: [{ label: "A" }] },
    ],
  },
});
const answered = await api(
  "POST",
  `${base}/api/reviews/${questions.reviewId}/decision`,
  {
    decision: "request_changes",
    answers: [
      { index: 0, question: "A or B?", header: "Choice", selected: ["A"] },
    ],
  },
);
assert(
  answered?.decision === "deny" && answered?.reason?.includes("A: A"),
  "question answers composed",
);

const info = JSON.parse(
  fs.readFileSync(path.join(dataDir, "server.json"), "utf8"),
);
const shutdown = await api("POST", `${base}/api/shutdown`, {
  token: info.token,
});
assert(shutdown?.ok === true, "token shutdown accepted");
await new Promise((r) => setTimeout(r, 500));
assert(
  !fs.existsSync(path.join(dataDir, "server.json")),
  "server.json removed on shutdown",
);

server.kill();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log(
  failures === 0
    ? "\nsmoke-server: ALL PASS"
    : `\nsmoke-server: ${failures} FAILURES`,
);
process.exit(failures === 0 ? 0 : 1);

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
