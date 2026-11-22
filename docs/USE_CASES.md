# JustRunMe in action: tested scenarios and proof

**Rehearse. Run. Recover.** From invisible PostgreSQL side effects to signed recovery evidence, these are working JustRunMe scenarios—not slides. Run the commands from the repository root after `npm ci`; Docker integration scenarios require a running Docker daemon.

| Scenario | Demonstrated result | Proof |
| --- | --- | --- |
| Hidden PostgreSQL trigger | Orders **3 → 2** in rehearsal; destructive plan denied | [Judge quickstart](JUDGE_QUICKSTART.md), [hidden demo](../test/demo-hidden.test.js) |
| Dangerous migration / safe alternative | Unsafe plan denied; additive plan **SAFE** and executed | [Demo A](../test/demo-a.test.js) |
| Failed real run / verified undo | Database, files and containers restored and checked | [Demo B](../test/demo-b.test.js) |
| Database privileges | Grants restored and verified | [Grant regression](../test/demo-undo-grants.test.js) |
| Dirty workspace rehearsal | Git worktree copies uncommitted changes | [Workspace implementation](../src/rehearsal/workspace.js) |
| Trigger bypass | **LOGIC BYPASS / DENIED** | [Bypass test](../test/demo-bypass.test.js) |
| Kiro hook | Dangerous shell command blocked, signed decision | [Hook test](../test/hook.test.js) |
| Exact-action approval | Approval tied to plan and SQL hashes | [Approval test](../test/demo-approval.test.js) |
| MCP agent workflow | Agent requests operations; approval stays separate | [MCP test](../test/demo-mcp.test.js) |
| Chaos Twin | DB killed with **SIGKILL**, recovery verified | [Chaos integration](../test/demo-chaos.test.js) |
| Gate health | **ACTIVE / INACTIVE** probe states | [Gate test](../test/gate.test.js) |
| Plan history | Changed or swapped archived evidence detected | [History test](../test/history.test.js) |
| Output and cleanup limits | Oversized output and incomplete cleanup fail closed | [Output tests](../test/exec-output-cap.test.js), [cleanup tests](../test/cleanup.test.js) |
| Console Proof chain | Saved hidden-trigger Judge report shows five steps (DATA LOSS → DENIED → SAFE plan → RECOVERED → VERIFIED); missing or malformed `--judge-report` refuses startup with `JUDGE_REPORT_INVALID`. Run `node src/cli/index.js judge --hidden-trigger > judge.json`, then `node src/cli/index.js console --judge-report judge.json` and open `proof_chain_url` (`#/proof`). | [Proof chain tests](../test/console-proof-chain.test.js), [saved Judge fixture](../test/fixtures/judge-hidden-trigger-report.json) |
| Signed chaos metadata | Git state, parameters and artifact hashes signed; tampering detected | [Chaos unit tests](../test/chaos.test.js) |

## Hidden trigger: data loss before production
**Situation:** A migration looks harmless but a database trigger silently deletes an order.

**What JustRunMe does:** Runs the proposed SQL against a disposable PostgreSQL copy, observes trigger effects, and refuses the destructive plan. A safe alternative can then be rehearsed and executed.

**Result:** In the documented judge run, orders fall from **3 to 2** in the unsafe rehearsal; the judge identifies **DATA LOSS**. The hidden-trigger mode has a **90-second** enforced budget when images are cached.

**Proof:** [Judge quickstart](JUDGE_QUICKSTART.md), [judge test](../test/demo-judge.test.js), [hidden-trigger test](../test/demo-hidden.test.js). Reproduce: `node src/cli/index.js judge --hidden-trigger --text`.

## Demo A: deny a dangerous migration, execute the safe plan
**Situation:** An agent proposes a migration that removes protected business data.

**What JustRunMe does:** Measures the destructive effects on a rehearsal database and denies authorization. A revised additive migration is rehearsed as SAFE, authorized, and run against the target.

**Result:** The test asserts the dangerous plan cannot be authorized (`NOT_SAFE`), and the revised migration receives **SAFE**.

**Proof:** [Demo A](../test/demo-a.test.js). Reproduce: `node --test test/demo-a.test.js`.

## Demo B: failed run, then verified recovery
**Situation:** A real execution fails after changing PostgreSQL data and workspace files.

**What JustRunMe does:** Restores captured database and file state, then checks schema, row counts, table checksums, file SHA-256, container image, privileges, and HTTP health.

**Result:** Recovery verification asserts all **7 check types** (`container_image`, `file_sha256`, `health`, `privileges`, `row_count`, `schema_hash`, `table_checksum`); the health probe returns **200**.

**Proof:** [Demo B](../test/demo-b.test.js). Reproduce: `node --test test/demo-b.test.js`.

## Database grants: recover permissions, not just rows
**Situation:** A database operation alters access grants and must be undone.

**What JustRunMe does:** Captures the relevant privileges before execution, restores them during undo, and checks them in recovery verification.

**Result:** The integration test verifies restored grant state rather than treating matching rows as sufficient.

**Proof:** [Grant regression](../test/demo-undo-grants.test.js). Reproduce: `node --test test/demo-undo-grants.test.js`.

## Dirty Git workspace: rehearse the actual local changes
**Situation:** An engineer has uncommitted edits that the next operation depends on.

**What JustRunMe does:** Builds a disposable Git worktree and applies the local binary diff before rehearsal, preserving the original working tree.

**Result:** The implementation carries the uncommitted diff into the isolated worktree; teardown checks the worktree is removed. This is not undo of Git commits.

**Proof:** [Workspace code](../src/rehearsal/workspace.js), [Demo A cleanup assertion](../test/demo-a.test.js). Reproduce: `node --test test/demo-a.test.js`.

## Trigger bypass: catch logic attacks that evade text filters
**Situation:** SQL manipulates trigger behavior while appearing innocuous to a text filter.

**What JustRunMe does:** Observes PostgreSQL behavior during rehearsal rather than relying solely on SQL string matching.

**Result:** The bypass test asserts `DENIED`, **LOGIC BYPASS**, `LOGIC_BYPASS`, and `REVISE_AND_REHEARSE`.

**Proof:** [Bypass integration](../test/demo-bypass.test.js), [recorded Kiro CLI session](agent-runs/2026-11-20-live2.md). Reproduce: `node --test test/demo-bypass.test.js`.

## Kiro hook: block destructive tool calls and sign the decision
**Situation:** A tool call attempts `rm -rf` or modifies a protected resource.

**What JustRunMe does:** With `JUSTRUNME_GATE=on` and an active mission contract, the PreToolUse hook evaluates the action and records signed `hook_decision` receipts.

**Result:** The test blocks `rm -rf demo` and verifies the decision is present in the signed chain; the hook is inactive by default.

**Proof:** [Hook tests](../test/hook.test.js), [live run 1](agent-runs/2026-11-20-live1.md). Reproduce: `node --test test/hook.test.js`.

## Approval: bind consent to the exact action
**Situation:** A safe rehearsal must not become blanket permission for modified SQL.

**What JustRunMe does:** Creates an approval request tied to the plan and report hashes; the separate approver path authorizes only that action.

**Result:** Changes to the approved content do not inherit the earlier authorization.

**Proof:** [Approval integration](../test/demo-approval.test.js). Reproduce: `node --test test/demo-approval.test.js`.

## MCP: let the agent work without approving itself
**Situation:** An agent needs to rehearse and request a real execution through MCP.

**What JustRunMe does:** Exposes rehearsal and operation-request tools, while keeping final approval outside the agent's MCP tool authority.

**Result:** The integration test exercises the MCP workflow without giving the agent an approval tool.

**Proof:** [MCP integration](../test/demo-mcp.test.js), [recorded operator session](agent-runs/2026-11-20-live2.md). Reproduce: `node --test test/demo-mcp.test.js`.

## Chaos Twin: prove recovery after a database crash
**Situation:** A database container dies midway through a recovery rehearsal.

**What JustRunMe does:** Kills the disposable database container using **SIGKILL**, restarts it, and checks recovery and cleanup.

**Result:** The integration test expects **RECOVERY PROVEN**, an unchanged real database, and no leftover twin resources.

**Proof:** [Chaos integration](../test/demo-chaos.test.js), [recorded evidence](evidence/chaos-live-2026-11-20/README.md). Reproduce: `node --test test/demo-chaos.test.js`.

## Gate probe: see whether the protection is active
**Situation:** An operator needs to know whether the hook is actually enforcing policy.

**What JustRunMe does:** Sends a narrowly defined canary probe and interprets the observed hook response.

**Result:** Tests distinguish **ACTIVE** and **INACTIVE** rather than assuming that a configuration file proves enforcement.

**Proof:** [Gate health tests](../test/gate.test.js). Reproduce: `node --test test/gate.test.js`.

## Plan history: detect changed evidence
**Situation:** A stored rehearsal report or SQL file is edited after authorization.

**What JustRunMe does:** Archives versioned plan evidence and checks it against the signed receipt chain.

**Result:** Tests detect a deleted, edited, or swapped archive file.

**Proof:** [History tests](../test/history.test.js). Reproduce: `node --test test/history.test.js`.

## Output and cleanup: fail closed under pressure
**Situation:** A subprocess emits excessive output, or teardown leaves resources behind.

**What JustRunMe does:** Enforces subprocess output caps, including explicit larger limits for database dumps and server logs, and refuses incomplete output. Cleanup tests exercise failure reporting.

**Result:** Tests reject output overflow instead of silently treating truncated data as complete; cleanup failures are reported rather than hidden.

**Proof:** [Exec cap tests](../test/exec-output-cap.test.js), [compose caps](../test/compose-output-cap.test.js), [cleanup tests](../test/cleanup.test.js). Reproduce: `node --test test/exec-output-cap.test.js test/compose-output-cap.test.js test/cleanup.test.js`.

## Signed Chaos run metadata: reproducible evidence
**Situation:** A recovery claim needs to be linked to the precise code and environment used.

**What JustRunMe does:** Includes Git commit, dirty-worktree flag, tool versions, scenario parameters, and result-file hashes in a signed Chaos receipt.

**Result:** Tests verify the receipt chain and detect tampering with a metadata field; unavailable metadata is reported as unavailable, not invented.

**Proof:** [Chaos metadata tests](../test/chaos.test.js). Reproduce: `node --test test/chaos.test.js`.

For supported resource boundaries and operational limitations, see [Details](DETAILS.md).
