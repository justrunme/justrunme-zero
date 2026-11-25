# JustRunMe — Requirements

Format: EARS (Easy Approach to Requirements Syntax).
Every requirement is `WHEN <trigger> THE SYSTEM SHALL <response>`.
IDs are stable; do not renumber existing IDs when adding new ones.

---

## R1 — Mission Contract

**R1.1** WHEN an agent submits a mission contract (file `justrunme.mission.yaml` at the repository root), THE SYSTEM SHALL parse the YAML contract and reject with a structured error if any required field (`id`, `objective`, `allowed_paths`, `protected_tables`, `time_limit_seconds`, `irreversible_actions`, `plan`, `resources`, and `reversibility` on every plan step) is absent or malformed. Unknown fields are rejected.

**R1.2** WHEN a mission contract fails validation, THE SYSTEM SHALL block all execution and return an error that names the failing field and position, with no partial execution having occurred.

**R1.3** WHEN a validated contract is accepted, THE SYSTEM SHALL record the contract hash (SHA-256 of the canonical serialized bytes) and bind all subsequent receipts to that hash.

**R1.4** WHEN an agent attempts to execute a tool call not covered by the active contract, THE SYSTEM SHALL block the call, emit a denial receipt, and log the mismatch.

**R1.5** WHEN no contract is active and `JUSTRUNME_GATE=on`, THE SYSTEM SHALL block every tool call and return an error stating that no active contract exists.

**R1.6** WHEN the contract specifies `allowed_paths`, `protected_tables` or `time_limit_seconds`, THE SYSTEM SHALL block any file write outside the allowed paths, any SQL statement that drops, truncates or deletes from a protected table without an approved irreversible-action entry, and any run that exceeds the time limit.

---

## R2 — Rehearsal and Impact Report

**R2.1** WHEN a validated contract is submitted, THE SYSTEM SHALL create a git worktree at a temporary path that is isolated from the main working tree before beginning rehearsal.

**R2.2** WHEN rehearsal begins, THE SYSTEM SHALL start a Docker Compose project with a unique `COMPOSE_PROJECT_NAME` derived from the mission ID, isolating it from any other running Compose project.

**R2.3** WHEN rehearsal completes, THE SYSTEM SHALL emit a structured impact report containing: list of files changed with line-delta counts, database table row counts before and after, schema delta (added/removed tables and columns), container images used, and wall-clock rehearsal duration in milliseconds.

**R2.4** WHEN a rehearsal environment cannot be created (worktree or Compose failure), THE SYSTEM SHALL fail the rehearsal, clean up any partially created resources, and report the failure reason without blocking the operator from retrying.

**R2.5** WHEN rehearsal finishes (success or failure), THE SYSTEM SHALL remove the worktree and stop and remove the isolated Compose project, leaving no dangling volumes or networks.

**R2.6** WHEN the impact report is built, THE SYSTEM SHALL also include the count of failing tests from the rehearsal test run and a verdict of `SAFE` or `DATA LOSS`. The verdict SHALL be `DATA LOSS` if any protected table loses rows, any table or column is dropped, or any row count in a protected table decreases, as measured in the disposable database.

**R2.7** WHEN the verdict is `DATA LOSS`, THE SYSTEM SHALL refuse to start the real run and SHALL return the measured evidence (table, before and after counts, failing statement) to the agent so that it can replan.

---

## R3 — Simulation Fidelity

**R3.1** WHEN rehearsal completes successfully, THE SYSTEM SHALL record a fidelity fingerprint comprising: git HEAD commit SHA, SHA-256 of tracked-file tree, SHA-256 of the uncommitted changes (diff of tracked files plus the names and content hashes of untracked files not ignored by git), Postgres row counts per table, a content checksum per table (hash of rows in primary-key order, so an UPDATE that keeps the row count is detected), Postgres schema hash, Docker image digests for all services in the contract, the contract hash, and the plan hash. The demo seed SHALL use fixed values so the fingerprint is reproducible.

**R3.2** WHEN a real run is requested after rehearsal, THE SYSTEM SHALL recompute the fidelity fingerprint of the current source state and compare it against the rehearsal fingerprint before allowing any real tool call to execute.

**R3.3** WHEN the fidelity check detects a mismatch in any fingerprint component, THE SYSTEM SHALL block the real run, report which components differ and their before/after values, and require the operator to either re-rehearse or submit a signed override justification.

**R3.4** WHEN the operator submits a signed override justification, THE SYSTEM SHALL record the override in the receipt chain, include the diff of mismatched fingerprint components, and proceed with the real run only after the receipt is written.

**R3.5** WHEN the fidelity check passes, THE SYSTEM SHALL record the pass result in the mission log and proceed with the pre-run capture step.

**R3.6** WHEN the fidelity check passes, THE SYSTEM SHALL issue a run authorization (the rehearsed-action allowlist). Each allowlist entry SHALL bind: the canonical action (tool name and normalized arguments), the SHA-256 of the executable script or file the action runs (for example the content of `migrate.js` when the action is `node migrate.js`), the fidelity fingerprint hash, the mission ID, and an expiry time. An action is allowed only if every bound value matches at the moment the hook evaluates it.

**R3.7** WHEN the content of a script referenced by an allowlist entry differs from the hash recorded at rehearsal, or the authorization has expired, or the fingerprint has changed since the check, THE SYSTEM SHALL block the action with exit 2 and write a denial receipt naming which bound value differed. Actions not on the allowlist are blocked by default.

---

## R4 — Undo Mission

**R4.1** WHEN a real run is authorized and the fidelity check passes, THE SYSTEM SHALL capture pre-run state before any tool call executes: a git stash (or worktree snapshot) of tracked files, a `pg_dump` of every Postgres database named in the contract, container image tags and volume export paths, and the contents of every config file listed in the contract.

**R4.2** WHEN a pre-run capture fails for any named resource, THE SYSTEM SHALL abort the real run, leave all captured resources in place for inspection, and report which resource failed.

**R4.3** WHEN the operator invokes `justrunme undo <mission-id>`, THE SYSTEM SHALL restore all captured resources in reverse capture order: config files first, then containers and volumes, then Postgres databases, then tracked files last.

**R4.4** WHEN restoring a resource during undo, THE SYSTEM SHALL report progress per resource (started, succeeded, failed) and continue restoring remaining resources even if one fails, collecting all failures into the final report.

**R4.5** WHEN undo completes, THE SYSTEM SHALL emit an undo receipt signed with the operator's Ed25519 key, recording mission ID, resources restored, resources failed, and timestamp.

**R4.6** WHEN the operator requests undo for a resource type not in the supported set (tracked git files, Postgres databases, Docker Compose services, named config files), THE SYSTEM SHALL reject the request with an explicit message stating the resource type is not supported for undo.

---

## R5 — Recovery Verification

**R5.1** WHEN undo completes, THE SYSTEM SHALL automatically run a verification pass that computes SHA-256 checksums of restored files and compares them to the pre-run capture manifest.

**R5.2** WHEN verification runs, THE SYSTEM SHALL query Postgres row counts and schema hash and compare them to the pre-run capture values.

**R5.3** WHEN verification runs and the demo application exposes a `GET /health` endpoint, THE SYSTEM SHALL poll the endpoint with exponential back-off (maximum 30 seconds) and record the HTTP status.

**R5.4** WHEN a configurable integration test suite is specified in the contract, THE SYSTEM SHALL execute it and record pass/fail counts.

**R5.5** WHEN all verification checks pass, THE SYSTEM SHALL emit a verification receipt with status `PASS` signed by the operator key.

**R5.6** WHEN any verification check fails, THE SYSTEM SHALL emit a verification receipt with status `FAIL`, listing every failing check with its expected and actual values, signed by the operator key.

**R5.7** WHEN any verification check fails, THE SYSTEM SHALL exit with a non-zero status and print the failing checks. A zero exit status from `pg_restore` or any other restore tool SHALL NOT be treated as proof of recovery; only the verification checks (row counts, per-table content checksums, schema hash, file checksums, `/health`) decide PASS.

---

## R6 — Irreversible Action Approval

**R6.1** WHEN a contract lists an action with `reversibility: false`, THE SYSTEM SHALL mark it as irreversible in the impact report and require out-of-band approval before the action executes.

**R6.2** WHEN any rehearsed action has a measured impact that exceeds a configured threshold (e.g. rows deleted > 1000, external API calls > 0), THE SYSTEM SHALL escalate the action to irreversible and require out-of-band approval even if the contract did not flag it. WHEN rehearsal measures a breach of `max_rows_deleted`, THE SYSTEM SHALL return `THRESHOLD EXCEEDED` and deny the plan until a revised plan stays within the limit.

**R6.3** WHEN out-of-band approval is required, THE SYSTEM SHALL issue a WebAuthn challenge whose value is the SHA-256 hash of the exact canonical serialized action payload.

**R6.4** WHEN the operator provides a WebAuthn assertion, THE SYSTEM SHALL verify the assertion against the registered credential and the exact challenge hash before allowing the action to execute.

**R6.5** WHEN the WebAuthn assertion fails verification, THE SYSTEM SHALL block the action, emit a denial receipt, and not retry automatically.

**R6.6** WHEN an irreversible action is approved and executes, THE SYSTEM SHALL record the approval assertion reference in the signed receipt so the approval is auditable offline.

**R6.7** (Priority P1, before any WebAuthn work) WHEN an irreversible action is flagged, THE SYSTEM SHALL block it until the operator approves it through a local one-time approval: a random nonce and an expiry time are added to the canonical action payload, the approval is bound to the SHA-256 of that payload, and an approval is accepted once. Replay, expiry and a payload mismatch SHALL each be rejected.

**R6.8** (Priority P2) The WebAuthn passkey assertion in R6.3 to R6.6, including approval from a phone, is deferred to P2. It SHALL reuse the payload hash, nonce and expiry from R6.7 as the challenge input. Until it is implemented and tested, no document may claim passkey approval works.

---

## R7 — Ed25519-Signed Receipts

**R7.1** WHEN any action is resolved (approved, denied, or undone), THE SYSTEM SHALL emit a receipt containing: action hash (SHA-256 of canonical payload), verdict (`allow`/`deny`/`undo`), mission ID, timestamp (ISO 8601 UTC), operator public key (hex), and a signature over the canonical receipt bytes.

**R7.1a** WHEN an allowed action finishes, THE SYSTEM SHALL emit a second, linked result receipt containing the decision receipt's hash, the actual outcome (exit status, and for database actions the measured row-count change), and the same signature fields as R7.1.

**R7.2** WHEN a receipt is emitted, THE SYSTEM SHALL append it to the hash-chained mission log: each log entry stores the SHA-256 hash of the previous entry, and the genesis entry hashes a fixed well-known constant.

**R7.3** WHEN the mission log is read, THE SYSTEM SHALL verify the hash chain from genesis to head and report any broken links before returning log entries.

**R7.4** WHEN a receipt's Ed25519 signature is verified, THE SYSTEM SHALL check the signature against the operator's public key on file; a mismatch must be reported and the entry flagged as tampered.

**R7.5** WHEN receipts are stored or transmitted, THE SYSTEM SHALL not include secrets, home-directory paths, email addresses, or credential material in any receipt field.

---

## R8 — Mission Replay and Judge Mode

**R8.1** WHEN the operator invokes judge mode for a mission ID, THE SYSTEM SHALL re-verify every receipt in the mission log, recompute action hashes from stored payloads, and report any hash or signature mismatches.

**R8.2** WHEN judge mode runs, THE SYSTEM SHALL complete within 60 seconds and use no production credentials or live external services.

**R8.3** WHEN judge mode detects a policy violation (an action that the contract should have blocked but did not), THE SYSTEM SHALL report it as a `POLICY_VIOLATION` finding with the action ID and contract rule that was breached.

**R8.4** WHEN judge mode completes, THE SYSTEM SHALL emit a structured judge report with counts of receipts verified, mismatches found, policy violations found, and overall status (`PASS` or `FAIL`).

---

## R9 — MCP Server

**R9.1** WHEN the MCP server is started, THE SYSTEM SHALL expose the following tools: `rehearse`, `get_impact_report`, `request_approval`, `get_receipt`, `undo_mission`, `verify_recovery`, `replay_mission`.

**R9.2** WHEN an MCP tool call arrives without a valid mission ID or contract reference, THE SYSTEM SHALL return a structured error with an error code and human-readable message.

**R9.3** WHEN an MCP tool call would trigger an irreversible action, THE SYSTEM SHALL apply the same approval gate as the CLI path; MCP callers cannot bypass the approval requirement.

**R9.4** WHEN an MCP tool returns a receipt, THE SYSTEM SHALL include the receipt's signature and public key so the caller can verify it offline.

---

## R10 — Kiro Hook Enforcement

**R10.1** WHEN `JUSTRUNME_GATE=on` is set and the Kiro `PreToolUse` hook fires, THE SYSTEM SHALL evaluate the incoming tool call against the active contract before allowing Kiro to execute it.

**R10.2** WHEN the hook detects a tool call routed through an inline interpreter (Python `exec`, Node `eval`, shell heredoc, or equivalent), THE SYSTEM SHALL block the call and emit a denial receipt with bypass category `INLINE_INTERPRETER`.

**R10.3** WHEN the hook detects a tool call that invokes an external script not declared in the contract, THE SYSTEM SHALL block the call and emit a denial receipt with bypass category `UNDECLARED_SCRIPT`.

**R10.4** WHEN the hook detects an MCP tool call that re-enters the JustRunMe gate from a different server identity, THE SYSTEM SHALL block the call and emit a denial receipt with bypass category `MCP_REENTRY`.

**R10.5** WHEN the hook blocks a call, THE SYSTEM SHALL exit with code 2 (the documented Kiro exit code that blocks a `PreToolUse` tool call) and include the denial receipt reference in the hook output.

**R10.6** WHEN the hook cannot parse its stdin event, cannot read the contract or the run authorization, throws, or times out internally, THE SYSTEM SHALL fail closed: exit 2 with a reason on stderr. Only exit 0 with a matching allowlist entry allows a call. The hook reads `tool_name` and `tool_input` from the event JSON, and MCP tools appear as `mcp_<server>_<tool>`.

**R10.7** WHEN `JUSTRUNME_GATE=on` and a shell call contains command substitution, pipes to an interpreter, redirection to an executable path, `eval`, or an interpreter flag (`-c`, `-e`, `--eval`), THE SYSTEM SHALL block it. A dangerous construct is allowed only if all of the following hold: the exact canonical command was executed during rehearsal and is on the run allowlist (R3.6); the rehearsal ran in a disposable environment with the same declared resources (same contract, same images, same database schema) as the real run; and the construct touches only resources declared in the contract. If any condition is unknown or unverifiable, the call is blocked. The hook is default-deny: it does not try to enumerate bad commands. Full shell sandboxing remains out of scope, so this is a gate on declared actions, not isolation of the real run.

**R10.8** (Early integration check, done in T13) THE SYSTEM SHALL include a test that runs the hook with a recorded `PreToolUse` event and asserts exit 2 for a blocked call and exit 0 for an allowed call. In T13 the operator also confirms once, in a real Kiro session, that the hook receives events and that exit 2 stops the tool call, and records the result in `docs/KIRO_LOG.md`.

---

## R11 — Privacy

**R11.1** WHEN writing any log entry, receipt, impact report, or audit artifact, THE SYSTEM SHALL not include email addresses, home-directory absolute paths, or credential material.

**R11.2** WHEN a file path in a log or report would expose a home-directory prefix, THE SYSTEM SHALL replace it with a placeholder (e.g. `$HOME`) before writing.

**R11.3** WHEN test fixtures or seed data are generated, THE SYSTEM SHALL use synthetic names and addresses, not real personal data.

---

## R12 — Demo Application

**R12.1** WHEN the demo application starts, THE SYSTEM SHALL respond to `GET /health` with HTTP 200 and a JSON body `{ "status": "ok", "db": "ok" }` only after the database connection is verified.

**R12.2** WHEN the demo database is seeded, THE SYSTEM SHALL insert a deterministic, fixed number of rows in each table so integration tests can assert exact row counts.

**R12.3** WHEN the demo integration test runs on Linux with Docker available, THE SYSTEM SHALL bring up the Compose stack, wait for health, run the assertions, and tear down — all without leaving containers or volumes behind.

---

## R13 — Demo A Acceptance (dangerous migration, DATA LOSS, replan)

All of the following must hold in one automated test, run on Linux with Docker and without credentials:

**R13.1** WHEN the scripted agent submits a plan whose migration drops or truncates a protected demo table, THE SYSTEM SHALL rehearse it in the disposable copy and report verdict `DATA LOSS` with measured before and after row counts.

**R13.2** WHEN the verdict is `DATA LOSS`, THE SYSTEM SHALL block the real run, and the production demo database SHALL have identical row counts and content checksums before and after the attempt.

**R13.3** WHEN the agent receives the `DATA LOSS` evidence and submits a safe plan (for example an additive migration), THE SYSTEM SHALL rehearse it with verdict `SAFE`, pass the fidelity gate, and allow the real run of exactly the rehearsed actions.

**R13.4** WHEN the real run of the safe plan finishes, THE SYSTEM SHALL have written signed, hash-chained decision and result receipts for the block and for the allowed run, and the chain SHALL verify.

---

## R14 — Demo B Acceptance (failure, Undo Mission, verified recovery)

**R14.1** WHEN the scripted agent runs an approved plan in a controlled test environment and a step fails on purpose, THE SYSTEM SHALL record the failure in a result receipt and leave the pre-run capture intact.

**R14.2** WHEN `justrunme undo <mission-id>` is run, THE SYSTEM SHALL restore the captured tracked files, the demo database and the named config files, then run recovery verification (R5).

**R14.3** WHEN recovery verification runs after Demo B, row counts, per-table content checksums, schema hash and file checksums SHALL equal the pre-run values and `GET /health` SHALL return 200, and the test SHALL assert each of them separately.

**R14.4** WHEN a test deliberately corrupts one restored value (negative control), THE SYSTEM SHALL report `FAIL` with a non-zero exit status. This proves the verification does not pass by default.

**R14.5** WHEN the fidelity fingerprint is changed between rehearsal and run (for example one row updated with the same row count), THE SYSTEM SHALL block the run.

---

## R15 — Plan Comparison (Priority P1, after Demo A)

**R15.1** WHEN a rehearsal finishes, THE SYSTEM SHALL store its impact report under the mission and a `plan_id`, together with the source fingerprint hash it started from, so that several rehearsals of one mission can be compared later.

**R15.2** WHEN the operator or agent asks to compare two or more stored rehearsals, THE SYSTEM SHALL refuse the comparison with an explicit error if their source fingerprint hashes differ, because results measured on different source states are not comparable.

**R15.3** WHEN a comparison is produced, THE SYSTEM SHALL show, per plan, only measured values: verdict, rows lost per protected table, failing test count, rehearsal duration in milliseconds, and whether every action is reversible. It SHALL NOT show estimated values.

**R15.4** WHEN a comparison recommends a plan, THE SYSTEM SHALL choose by a fixed rule: exclude plans with verdict `DATA LOSS`; then exclude plans with failing tests; then exclude plans with irreversible actions unless all remaining plans have them; then pick the lowest duration; ties go to the lexicographically smallest `plan_id`. The same inputs SHALL always give the same recommendation, and the report SHALL state which rule decided.

**R15.5** WHEN no plan survives the exclusions, THE SYSTEM SHALL recommend none and say which rule removed each plan.

---

## R16 — Chaos Twin (Priority P2, after Demo B)

**R16.1** WHEN a rehearsal is requested with a fault specification naming an operation marker (for example the statement label or step id between two migration statements) and a fault type, THE SYSTEM SHALL inject exactly that fault in the disposable copy when execution reaches the marker. Triggers by elapsed time are not allowed.

**R16.2** WHEN the fault has been injected, THE SYSTEM SHALL measure the resulting state of the disposable database (schema hash, row counts, per-table content checksums, constraint validity) and report whether it equals the state before the rehearsal, equals the state after a normal rehearsal, or is neither (inconsistent).

**R16.3** WHEN the same fault specification is run twice on the same source fingerprint, THE SYSTEM SHALL produce the same classification.

**R16.4** THE SYSTEM SHALL NOT inject faults into the real database or the real run.

---

## Threat Model

The following bypass vectors are explicitly in scope for the hook enforcement rules above:

| Vector | Mitigation rule |
|--------|----------------|
| Agent calls `python -c 'import subprocess; ...'` to run unapproved code | R10.2 — inline interpreter block |
| Agent writes a shell script to `/tmp` and executes it | R10.3 — undeclared script block |
| Agent re-routes a call through a second MCP server not in the contract | R10.4 — MCP re-entry block |
| Operator rehearses, then another process modifies the DB before the real run | R3.3 — fidelity mismatch block |
| Attacker modifies historical receipts in the receipt log | R7.3 — hash chain verification |
| Agent submits a contract with a schema that bypasses required fields via aliasing | R1.1 — strict schema validation, fail-closed |
| Stale rehearsal (operator delays real run long enough for state to drift) | R3.2 — fingerprint re-check on every real-run request |
| Agent edits `migrate.js` after rehearsal, then runs the same command string `node migrate.js` | R3.6, R3.7 — allowlist binds the script content hash, not only the command string |
| Agent replays an old run authorization after the mission ended | R3.6 — authorization is bound to mission ID, fingerprint and expiry |
| Hook crashes or receives malformed stdin and the call proceeds | R10.6 — fail closed, exit 2 |
| UPDATE changes data but keeps the row count, so a count-only fingerprint misses it | R3.1 — per-table content checksum |
| Restore tool exits 0 but data is not restored | R5.7, R14.4 — verification decides, negative control test |
| Agent runs a rehearsed relative command with `execute_bash` `cwd` set to another directory (field seen in live Kiro CLI events) | R3.7 — shell cwd must be the workspace root |
| Agent writes `.justrunme/authorization.json` itself, or a rehearsed script writes it | R3.6 — authorization must carry a valid operator Ed25519 signature; key is outside the workspace and agent tools cannot touch the key directory |
| Agent edits JustRunMe's own code or dependencies (`src/`, `node_modules/yaml`) when they are inside the workspace | R10.6 — installation paths are protected like the hook files |
| Authorization reused for a second run | R3.6 — the runner consumes it before executing |
| Residual, not mitigated: authorized code reads the operator key, because it runs as the same OS user | Out of scope (no OS sandbox); stated in README |
| Residual, not mitigated: the operator starts Kiro without `JUSTRUNME_GATE=on` | Out of scope; the gate is opt-in by design |
