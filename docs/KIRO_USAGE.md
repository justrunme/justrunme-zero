# Kiro usage and evidence audit

JustRunMe uses Kiro for specification, implementation and live agent checks. This page counts **recorded entries**, not unique model calls, and does not infer authorship from a commit alone.

## How Kiro was used

### IDE or CLI?

Most recorded implementation work used Kiro CLI, as documented in the [session log](KIRO_LOG.md). Kiro IDE was tested separately for the `PreToolUse` hook: the [IDE report](agent-runs/2026-11-20-ide.md) records a hook not executing in an untrusted workspace, followed by a denial in a trusted session. These are different environments, not interchangeable proof.

### Custom agents, and where?

The repository defines [five workspace agents](../.kiro/agents/) for builder, operator, skeptic and T25 roles. A [recorded CLI v3 operator session](agent-runs/2026-11-20-live2.md) used `--v3 --agent justrunme-operator` to investigate a hidden database trigger, rehearse alternatives and request human approval. This demonstrates that session, not universal enforcement of agent permissions.

### Hooks?

The [hook definitions](../.kiro/hooks/) include a `PreToolUse` gate that is enabled only with `JUSTRUNME_GATE=on`. The [gate run](agent-runs/2026-11-20-gate.md) records a denied destructive action; the [IDE report](agent-runs/2026-11-20-ide.md) also documents the untrusted-workspace limitation. Kiro already has hooks and permissions; JustRunMe adds measured, recorded decisions for the configured workflow.

### Spec-driven or vibe coding?

Work was tracked against [requirements](../.kiro/specs/justrunme-zero/requirements.md), [design](../.kiro/specs/justrunme-zero/design.md) and [task checkboxes](../.kiro/specs/justrunme-zero/tasks.md), with implementation attempts and manual corrections recorded in the [Kiro log](KIRO_LOG.md). This is a spec-driven workflow with iterative prompts, not a claim that every checked task has a separately traceable model call; the audit below identifies gaps.

### Steering?

The four [steering files](../.kiro/steering/) describe product scope, engineering rules and the operator loop. The [operator agent definition](../.kiro/agents/justrunme-operator.json) refers to the operator-loop steering file; the [recorded operator run](agent-runs/2026-11-20-live2.md) documents the actual CLI workflow rather than assuming every steering instruction was obeyed.

### MCP?

The [operator agent config](../.kiro/agents/justrunme-operator.json) declares the local `justrunme` MCP server at `src/mcp/server.js`. The [live CLI run](agent-runs/2026-11-20-live2.md) records its rehearsal, approval-request and run interactions; the [T25 reports](agent-runs/T25-results-v1.md) and [v2](agent-runs/T25-results-v2.md) distinguish experimental outcomes from general performance claims.

## Recorded evidence

- [Kiro session log](KIRO_LOG.md): **48 level-two numbered Run headings** (`grep -Ec` below), plus Run 6 at level three: **49 distinct primary numbered runs** (Runs 1–49 inclusive). Additional follow-up and loop subheadings are not counted. Several headings include multiple attempts or follow-up edits, so 49 is not a count of invocations.
- [Specification and task checkboxes](../.kiro/specs/justrunme-zero/tasks.md): requirements, design and task tracking.
- [Steering](../.kiro/steering/): **4 current files** (product, engineering, scope, operator loop).
- [Agents](../.kiro/agents/): **5 current definitions** (builder, skeptic, operator and two T25 roles).
- [Hooks](../.kiro/hooks/): **3 current definitions**, including the `PreToolUse` gate; it is inactive unless `JUSTRUNME_GATE=on`.
- [Recorded run reports](agent-runs/): **9 top-level Markdown files**, plus nested evidence directories. These are reports, not nine independent sessions.
- [Git history of the log](https://github.com/justrunme/justrunme-zero/commits/main/docs/KIRO_LOG.md): **37 commits touching the log** on `origin/main` at audit time. A commit touching the log is not evidence of a Kiro invocation.

## What was actually exercised

| Feature | Evidence and scope |
| --- | --- |
| Specs | [Run 3](KIRO_LOG.md#run-3--2026-11-16-2002-cet-berlin) and [task specification](../.kiro/specs/justrunme-zero/tasks.md) |
| Steering and custom agents | [Run 3](KIRO_LOG.md#run-3--2026-11-16-2002-cet-berlin), [Run 4](KIRO_LOG.md#run-4--2026-11-16-2006-cet-berlin), [current definitions](../.kiro/agents/) |
| Hooks and gate | [Run 8](KIRO_LOG.md#run-8--t13-contract-parser-and-pretooluse-gate), [gate session](agent-runs/2026-11-20-gate.md) |
| CLI agent run | [Live run 1](agent-runs/2026-11-20-live1.md), [live run 2](agent-runs/2026-11-20-live2.md) |
| IDE hook check | [IDE report](agent-runs/2026-11-20-ide.md): untrusted workspace did not execute the hook; trusted workspace did |
| Security probe | [Probe report](agent-runs/2026-11-20-probe.md): only the recorded tool attempts are covered |
| Measured data-loss experiment | [T25 version 1](agent-runs/T25-results-v1.md), [T25 version 2](agent-runs/T25-results-v2.md) |

## Audit qualifications

- **Run 6 has no heading.** It is *not recorded* under that number; do not invent a session.
- Several entries have no individual spec subtask IDs, model field or per-invocation time. Their aggregate descriptions are not evidence for every checked subtask.
- The current task file has **72 distinct checked subtask IDs** matching `T<number>[.<suffix>]`; **61** do not appear *literally* anywhere in the session log. Many are covered by parent-task references such as T11 or T12, so this is a **traceability gap**, not proof they were not implemented.
- Run 5 has no machine-readable date in its opening metadata; its narrative has dated work. Later entries sometimes document the date but not the time/model. Missing details remain *not recorded* rather than guessed.
- Git commits on `main` establish repository changes, **not who generated each line**. The log's claims about Kiro authorship are not independently provable from Git alone. Earlier closed/superseded branches are not silently counted as mainline work.

## Reproduce counts

```sh
grep -Ec '^## Run [0-9]+' docs/KIRO_LOG.md
find .kiro/steering -type f | wc -l
find .kiro/agents -type f | wc -l
find .kiro/hooks -type f | wc -l
find docs/agent-runs -maxdepth 1 -name '*.md' | wc -l
git log origin/main --format='%h' -- docs/KIRO_LOG.md | wc -l
```

Checked subtask IDs and exact log mentions (run from repo root):

```sh
python3 - <<'PY_AUDIT'
import pathlib, re
s = pathlib.Path('.kiro/specs/justrunme-zero/tasks.md').read_text()
log = pathlib.Path('docs/KIRO_LOG.md').read_text()
ids = set(re.findall(r'\[x\]\s*(T\d+(?:\.[A-Za-z0-9]+)?)', s))
missing = {i for i in ids if not re.search(r'(?<![\w.])' + re.escape(i) + r'(?![\w.])', log)}
print('checked:', len(ids), 'without literal log mention:', len(missing))
PY_AUDIT
```

Counts use the task and log files from the same `origin/main` baseline.
