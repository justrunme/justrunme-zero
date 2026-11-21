# JustRunMe — Kiroween video script (2:00)

**Format:** English voice-over and screen capture. Start on the working product, not installation. Distinguish recorded Kiro sessions from a live judge execution; cut waiting time visibly and never fabricate a result. [Recording runbook](submission/RECORDING_RUNBOOK.md).

| Time | Screen / action | Spoken narration | Proof |
| --- | --- | --- | --- |
| 0:00–0:10 | **Real hidden-trigger judge result**: `orders 3 → 2`, `DENY DATA_LOSS`. Capture actual completed output; mark any cut. | “Your AI agent thinks this migration is safe. A hidden PostgreSQL trigger deletes a customer order. JustRunMe catches it before the real run.” | [Hidden-trigger test](../test/demo-judge.test.js) · [Quickstart](JUDGE_QUICKSTART.md) |
| 0:10–0:20 | Same run: `SAFE`, zero lost, real run, `RECOVERED`. | “The dangerous change is blocked. The safe alternative preserves all three orders. Recovery is verified.” | [Judge scenario](../src/judge/scenario.js) |
| 0:20–0:38 | Show **recorded Kiro CLI/IDE evidence**, agent proposing, rehearsing, receiving feedback and revising. Clearly label **RECORDED KIRO SESSION**. | “We built this with Kiro specs, steering, agents, hooks and MCP. Here the agent sees measured database impact, repairs the plan and rehearses again.” | [Recorded live Kiro run](agent-runs/2026-11-20-live2.md) · [Kiro usage](KIRO_USAGE.md) |
| 0:38–0:56 | Show terminal command `node src/cli/index.js judge --hidden-trigger --text`, then completed result with visible time cut. | “One command runs the judge against disposable real PostgreSQL in Docker. It checks the dangerous and safe plans, execution, undo and signed evidence.” | [Judge quickstart](JUDGE_QUICKSTART.md) |
| 0:56–1:12 | Show the Git worktree rehearsal and recovered database/files evidence. | “It is more than a SQL check: rehearsal includes workspace files; undo restores captured database state and allowed files, then verifies the result.” | [Workspace](../src/rehearsal/workspace.js) · [Recovery test](../test/demo-chaos.test.js) |
| 1:12–1:28 | Hook denial `rm -rf` and nine MCP tools; label hook transcript recorded. | “The Kiro gate can deny dangerous tool calls with signed receipts. The MCP workflow can request approval but cannot approve itself.” | [Hook test](../test/hook.test.js) · [MCP test](../test/demo-mcp.test.js) |
| 1:28–1:45 | **RECORDED CHAOS TWIN** evidence, SIGKILL then RECOVERY PROVEN. | “Chaos Twin kills a disposable database mid-run. Undo recovers it; twenty-one recorded checks passed with zero failures.” | [Recorded Chaos evidence](evidence/chaos-live-2026-11-20/README.md) |
| 1:45–2:00 | Return to `DENY DATA_LOSS → SAFE → RECOVERED` and JustRunMe logo. | “Before an agent changes your database, prove what it will do. JustRunMe. Rehearse. Run. Recover.” | [Judge integration test](../test/demo-judge.test.js) |

## Recording setup

1. From repo root, run `unset DOCKER_DEFAULT_PLATFORM`, then `npm ci`, `node --version` and `docker info`; Docker must be available and Node 24+ installed. Cache `postgres:16.3-alpine` before timing; do not call a cached image a cold pull.
2. Run `node src/cli/index.js judge --hidden-trigger --text` off camera; verify the actual exit code, order counts, verdicts and cleanup. Keep the full run for audit; edit waiting time only with an explicit on-screen time cut.
3. Prepare the first shot on **actual completed judge output**. For Kiro, show the original recorded session with an unmistakable label, not a staged live exchange.
4. For the Chaos Twin shot, show [committed evidence](evidence/chaos-live-2026-11-20/README.md) labeled **RECORDED**, not a live claim. Keep the demo and Chaos run separate.
5. Keep secrets, Console tokens and personal information out of the frame. Stop any local Console after recording and verify cleanup. No upload or submission is authorized by this script.

The judge is a reproducible demo using disposable resources, not a sandbox for untrusted host shell commands. Recovery covers captured database state and specified files, not arbitrary external effects.
