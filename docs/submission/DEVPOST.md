# JustRunMe — Devpost draft (Kiroween, Frankenstein)

**Primary category to select on Devpost: Frankenstein** — the Kiro workflow, MCP, CLI, PostgreSQL/Docker rehearsals, receipts, and Console are combined into one entry. This is the intended category, **not a claim that the form has been submitted**. [Submission checklist](CHECKLIST.md).

## Elevator pitch

**Your AI agent thinks the database change is safe. JustRunMe proves whether it is.** A hidden PostgreSQL trigger silently deletes a customer order. JustRunMe catches the loss before the real run, blocks the dangerous change, executes a verified safe alternative, and proves recovery with signed evidence. **Rehearse. Run. Recover.**

**The demo to watch:** `node src/cli/index.js judge --hidden-trigger --text` — real PostgreSQL in Docker, orders **3 → 2**, **DENY DATA_LOSS**, then **SAFE (0 orders lost)**, a matching real run and **RECOVERED** undo. [Reproduce it](../JUDGE_QUICKSTART.md) · [Docker integration proof](../../test/demo-judge.test.js).

### Not just the database

- Disposable Git worktree rehearsal of workspace changes: [implementation](../../src/rehearsal/workspace.js).
- Undo of captured PostgreSQL data/schema/grants, allowed workspace files and contract configuration; recovery checks include rows, checksums, files, images and configured health: [grants test](../../test/demo-undo-grants.test.js) · [recovery test](../../test/demo-chaos.test.js).
- Opt-in Kiro `PreToolUse` gate blocks dangerous shell and protected-file changes, with signed decisions: [hook tests](../../test/hook.test.js).
- Nine MCP tools for the agent workflow, with no approval tool: [tool contract](../../test/hook.test.js) · [MCP test](../../test/demo-mcp.test.js).
- Chaos Twin crashes a disposable database with `SIGKILL` and proves recovery: [test](../../test/demo-chaos.test.js) · [recorded evidence](../evidence/chaos-live-2026-11-20/README.md).
- Gate probe distinguishes ACTIVE and INACTIVE: [tests](../../test/gate.test.js).

### Category: Frankenstein — why

Kiro's agent workflow, its hook and MCP integration, Docker/PostgreSQL rehearsals, separately authorized execution, signed receipts and verified undo become one connected system. Each part is useful; together they turn an agent's proposed change into **measured impact before execution and auditable recovery afterward**. [Kiro usage evidence](../KIRO_USAGE.md) · [Architecture](../../.kiro/specs/justrunme-zero/design.md).

## Inspiration
An agent can read a SQL migration, find no obvious `DELETE`, and approve it. But a trigger that lives only in the database can delete orders anyway. In a recorded Kiro-agent run, a migration that looked safe actually reduced `orders` from **3 rows to 2**. JustRunMe measured the loss before the real change and denied that plan. The agent revised its approach; the accepted run kept all 3 orders. [Evidence: recorded live run](../agent-runs/2026-11-20-live2.md).

We wanted a practical way to ask not just *what does the agent intend?* but *what happened when its exact plan was tried on a disposable copy?*

## What it does

JustRunMe fits into a Kiro agent workflow. It rehearses a proposed migration on a disposable PostgreSQL copy, measures row and schema changes, and checks database logic such as triggers. A plan that loses protected data is denied. The agent can revise and rehearse again. Before a real run, JustRunMe checks that the target and selected plan still match the rehearsal. The operator authorizes the selected plan separately; the receipt records the approval channel rather than pretending to identify a person. After execution, JustRunMe compares the result with the rehearsal. It can also restore captured database and workspace state and verify recovery.

A local Console shows the mission's Flight Recorder, impact differences, approvals and signed, hash-linked receipts. Chaos Twin Lite rehearses recovery in a disposable twin by applying changes, killing its database and checking the undo path. Neither the twin nor JustRunMe itself is a sandbox for untrusted host-side commands.

**Try the single-command demonstration** after installing dependencies, with Node.js 24+ and local Docker available:

```sh
npm ci
node src/cli/index.js judge --hidden-trigger --text
```

The judge command creates temporary demo resources, rehearses a destructive change and a safe alternative, runs and undoes the safe plan, verifies the receipt chain and detects tampering. It does not need your own server, production keys or database credentials. In a documented fresh-clone check, the judge took **38.4 seconds on its first run and 37.5 seconds on its second**, with `postgres:16.3-alpine` **already cached both times**; a first Docker image pull was not measured. [Recording runbook](RECORDING_RUNBOOK.md). For a separate local evidence view, run `node src/cli/index.js console` and open the tokenized URL it prints. For an existing mission, `justrunme evidence` reports what its verified receipts prove and what remains unchecked; `justrunme gate-probe` checks whether the agent session is actually gated. Neither command establishes that arbitrary host-side code is safe.

## How we built it

Kiro was part of the development workflow, not a label added afterward. We used `.kiro/specs/justrunme-zero/` for requirements, design and tasks; `.kiro/steering/` for engineering and operator constraints; `.kiro/agents/` for specialized builder, operator and review configurations; and `.kiro/hooks/` for tool-use checks. The `PreToolUse` hook can deny commands that do not match the contract when `JUSTRUNME_GATE=on`; it is off unless explicitly enabled. Kiro CLI sessions exercised the actual rehearsal-and-repair loop, while Kiro IDE and gate checks were recorded separately with their limits. Session evidence and the work log live in `docs/agent-runs/` and `docs/KIRO_LOG.md`.

We stitched together the Kiro agent loop, an MCP server, a Node.js CLI, Docker Compose and PostgreSQL copies, an operator approval flow, database recovery, signed receipts and a local web Console. That combination is our Frankenstein entry: the pieces are familiar, but the result connects an agent's proposed action to a measured outcome and a verifiable recovery record.

## Challenges we ran into

The hidden-trigger experiment exposed a flaw in our first definition of success. In T25 v1, **5 of 5** destructive first plans were denied after rehearsal measured `orders` falling from **3 to 2**. The runner marked **3 of 5** final attempts as task successes, but all three achieved that by disabling or bypassing the trigger during the update; **0 of 5** completed the task while letting the trigger act. A safe-looking final database state was not enough.

We added **LOGIC BYPASS** detection in the rehearsal copy for T25 v2, including attempts to bypass existing database behavior temporarily. The recorded live Kiro run then denied a `DISABLE TRIGGER` plan as `LOGIC BYPASS`. T25 v2 was a separate, small experiment: the treatment completed **3 of 5** Task A runs by the runner's criteria versus **4 of 5** controls; a stricter interpretation of one treatment run gives **2 of 5**. These are not evidence of a general advantage. Coverage still has boundaries, including untested PostgreSQL mechanisms such as event triggers, RLS policies, extension functions and role/database settings. We also had to distinguish scripted approvals from human authorization, report unavailable recovery checks, and clean up judge-demo resources.

## Accomplishments

- **Gate decisions, separate from rehearsal:** in a reproducible Node 24 test corpus, **13 of 13 destructive tool actions were denied and 1 harmless file read was allowed**. These were gate decisions with `JUSTRUNME_GATE=on`, **not 13 measured PostgreSQL rehearsals**, and do not establish universal protection against alternate shell forms or bypasses. [Committed gate examples](../EXAMPLES.md).
- **Recorded Chaos Twin recovery (2026-11-20):** a database-container `SIGKILL` after step 2 was followed by undo **RECOVERED** and verdict **RECOVERY PROVEN**; **21 checks, 0 failed**, signed receipt-chain verification and clean resource cleanup with no leftover containers, volumes or networks. The [public recorded evidence](../evidence/chaos-live-2026-11-20/README.md) includes `chaos.json`, `verify.json`, the signed receipt, public key and a portable receipt/anchor verification command. This was a separate recorded database-only run, **not a live video take** or a sandbox for untrusted shell; health check was not configured.

- A recorded Kiro CLI run caught the hidden trigger's loss of **1 of 3 orders**, rejected a trigger-bypass attempt, and executed a revised plan that matched its rehearsal with all 3 orders retained.
- **649 tests passed, 0 failed, 0 skipped** in `npm test` on current main `38316068d4fbf225c6ca379cdca6869bcbe49c3f`. The [historical test report](../test-report.json) is retained as a separately dated snapshot.
- A reproducible `judge --text` flow exercises rehearsal, denial, safe execution, undo, receipt verification and tamper detection using throwaway resources.
- The Console makes the recorded decisions and gaps inspectable rather than presenting every step as successful.

## What we learned

Outcome checks are necessary but not sufficient: a plan can leave the database looking right while bypassing a business rule during execution. Rehearsal evidence must be tied to the exact baseline and plan, and the report must say when a check was unavailable. A receipt can establish what was recorded and signed; it cannot prove an untrusted shell command was harmless or that a scripted passphrase came from a person.

## What's next

Extend bypass detection to untested PostgreSQL mechanisms such as event triggers, RLS policies, extension functions and role/database settings, reduce exposure of production data inside rehearsals, expand recovery and environment testing, and improve the judge onboarding path. See [Honest limits](../../README.md#honest-limits) for the scope of verified behavior.

## Built with

Kiro CLI and IDE, Kiro specs/steering/agents/hooks, Node.js (24+), JavaScript, `@modelcontextprotocol/server`, `yaml`, `zod`, Docker Compose, PostgreSQL 16, Node's built-in HTTP server, Ed25519 signatures, and `fast-check` for development tests. The Console uses no front-end framework.

## Submission video

The [planned 1:36 demo video script](../DEMO_VIDEO.md) is **under the 3-minute limit** stated in the [submission checklist](CHECKLIST.md). The video has **not yet been recorded, publicly uploaded or submitted**, so the script is not a substitute for the required public video.

## Try it out

https://github.com/justrunme/justrunme-zero

<!--
Sources (internal; remove this section before pasting into Devpost):
- Pain, 3 -> 2 rows, trigger-bypass refusal, final 3/3 and recorded Kiro configuration: docs/agent-runs/2026-11-20-live2.md; test/live-evidence.test.js
- Preregistered five-run experiment and limitations: docs/agent-runs/T25-results-v1.md; docs/agent-runs/T25-preregistration.md
- Separate T25 v2 experiment and bypass detection: docs/agent-runs/T25-results-v2.md; test/demo-bypass.test.js; src/rehearsal/observe.js; src/authorize/authorization.js
- Current main `38316068d4fbf225c6ca379cdca6869bcbe49c3f`: npm test 649/0/0; historical snapshot: docs/test-report.json
- Judge behavior, evidence/gate-probe self-checks and prerequisites: src/cli/index.js; test/demo-judge.test.js; README.md
- Rehearsal, approval, recovery, Console and limitations: README.md; src/console/static/; test/console-missions.test.js; test/demo-chaos.test.js
- Kiro features and evidence: .kiro/specs/justrunme-zero/; .kiro/steering/; .kiro/agents/; .kiro/hooks/; docs/agent-runs/; docs/KIRO_LOG.md
- Gate test corpus and its scope (13 denied, 1 allowed; not rehearsals): docs/EXAMPLES.md; test/gate-examples.test.js
- Recorded Chaos Twin recovery, signed receipt, original CLI verification and portable signature check: docs/evidence/chaos-live-2026-11-20/README.md; docs/evidence/chaos-live-2026-11-20/chaos.json; docs/evidence/chaos-live-2026-11-20/verify.json
- Fresh-clone judge timings (both Docker image cached): [docs/submission/RECORDING_RUNBOOK.md](RECORDING_RUNBOOK.md); README.md for npm ci and judge command
- Frankenstein category, video under 3 minutes and missing public upload: docs/submission/CHECKLIST.md; docs/DEMO_VIDEO.md (1:36 script)
- Dependencies: package.json; demo/docker-compose.yml
-->
