# Claude Oversee

A Claude Code plugin that moves plan reviews and clarifying questions out of the terminal and into a local web app.

## Why

In plan mode, Claude Code shows you a wall of terminal text and one freeform reply box. For a long plan that's not enough:

- You can't comment on a specific paragraph, only reply to the whole thing.
- When Claude revises, there's no diff. You re-read the whole plan to find what changed.
- If you don't fully understand part of the plan, asking Claude about it burns main-session tokens and pollutes the context you're about to execute with.

Claude Oversee intercepts `ExitPlanMode` and `AskUserQuestion` with a PreToolUse hook and opens a review page on `127.0.0.1` instead. There you can:

- Read the plan as rendered markdown, highlight any passage, and attach an inline comment.
- See a diff between revisions when Claude updates the plan.
- Answer question cards with options and free-text notes.
- Chat with a cheap sidecar model (Haiku by default) that has read-only access to your project. Comprehension questions cost Haiku tokens in a separate session, not main-session tokens.
- Submit one decision: **Approve**, **Request changes** (your comments go back as one structured message), or **Answer in terminal**.

If the server is down, the browser is blocked, or you ignore the review, it falls back to the normal CLI flow. The hook always exits 0, so a broken review can't block a session.

As of July 2026 (Claude Code with Ultraplan in research preview): Ultraplan offers browser plan review with inline comments, but it is cloud-hosted and needs a GitHub repo. Claude Oversee runs entirely on localhost, shows revision diffs, and adds the sidecar chat. None of those three exist natively in the CLI today; if Anthropic ships them, use theirs.

## Install

```
/plugin marketplace add jimkeecn/claude-oversee     # or a local path to this repo
/plugin install claude-oversee@claude-oversee-marketplace
```

Local-path installs: install from a clean clone without `node_modules/`, because the installer copies the whole directory. No build step is needed; `dist/` is committed.

## Use

Opt in per project:

```
/claude-oversee on       # plans & questions in this project open in the browser
/claude-oversee off      # back to the normal CLI flow
/claude-oversee status   # toggle state, server status, pending review URLs
```

Then enter plan mode as usual. When Claude presents its plan, your browser opens `http://127.0.0.1:43110/review/...`.

The sidecar model is switchable per review (haiku / sonnet / opus). The sidecar reads your project once; later messages resume the same session, so it stays prompt-cache friendly. The sidecar shares your Claude Code login and spends your Claude tokens (Haiku-priced by default), so treat each question as a paid API call.

## Configuration

Data lives in `~/.claude-oversee` (override with `CLAUDE_OVERSEE_DATA_DIR`). `~/.claude-oversee/config.json`:

| key             | default                   | meaning                                  |
| --------------- | ------------------------- | ---------------------------------------- |
| port            | 43110                     | server port base (scans +1..+9 if taken) |
| model           | claude-haiku-4-5-20251001 | default sidecar model                    |
| hookDeadlineSec | 3300                      | hook gives up and falls back to CLI      |
| idleShutdownMin | 30                        | server exits after idle period           |

Env overrides: `CLAUDE_OVERSEE_PORT`, `CLAUDE_OVERSEE_MODEL`, `CLAUDE_OVERSEE_DEADLINE`, `CLAUDE_OVERSEE_DATA_DIR`. Manage via `node dist/cli.cjs config get|set <key> <value>`.

## How it works

```
Claude calls ExitPlanMode/AskUserQuestion
  → PreToolUse hook (dist/hook.cjs)
    → toggle off? exit 0 (normal CLI)
    → ensure local server (127.0.0.1, auto-spawn, dist/server.mjs)
    → POST review, open browser, long-poll decision
  → decision maps back:
      approve          → permissionDecision "allow"   (skips CLI wall)
      request_changes  → "deny" + structured feedback (Claude revises → new revision, same thread)
      answer in terminal / timeout → "ask"            (normal CLI prompt)
```

The sidecar chat is a headless Agent SDK session (`@anthropic-ai/claude-agent-sdk`) with `cwd` set to your project and tools restricted to Read/Grep/Glob. It shares your Claude Code login, so no API key is needed.

## Known issues and limits

Built and tested on Windows 11 with the Claude Code CLI. macOS/Linux code paths exist but have not been exercised. Treat this repo as a working build log, not a hardened product.

- **Desktop app:** in one test the hook fired twice for a single `AskUserQuestion` and the detached server died about 2.5 minutes after spawn, killing the review. Suspected cause: the desktop app reaps the hook's process tree. The terminal CLI is unaffected. Unresolved.
- The review server writes no log file, which makes issues like the above hard to diagnose. Planned.
- A review tab left open holds an SSE connection, which keeps the idle server alive past `idleShutdownMin` until the tab closes.
- Endpoints other than shutdown are unauthenticated. The server binds to 127.0.0.1 only, but any local process can reach it. The shutdown token in `~/.claude-oversee/server.json` is written with default file permissions.
- Per-project toggle, not per-session (the `/claude-oversee` command can't see the session id).
- Answers to `AskUserQuestion` travel via the hook's deny reason. Claude treats them as answers, but may occasionally re-ask.
- `claude -p` (headless) sessions don't expose `ExitPlanMode`, so Claude Oversee only activates in interactive sessions.

## Development

```
npm install && cd ui && npm install
npm run build        # esbuild bundles + vite UI → dist/ (committed)
npm run smoke:server # server API + reason composer tests
npm run smoke:hook   # hook lifecycle tests against fixtures (no tokens)
npm run typecheck
npm run format
```

Notes from building this, in case they save you a day:

- Marketplace installs are directory copies that never run `npm install`, hence the committed `dist/`.
- npm workspaces break local-directory installs on Windows: the `node_modules` workspace symlink can't be recreated without Developer Mode, so the installer fails with EPERM. This repo installs `ui/` dependencies separately instead of using workspaces.
- Hook rule: always exit 0. Any non-zero exit or hang in a PreToolUse hook degrades the whole session, so every failure path here maps to "fall back to the terminal".

## License

MIT
