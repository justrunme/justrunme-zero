# Fresh-clone judge quickstart (Mac, 21 November 2026)

This records two fresh-checkout checks: the original full judge and test run at **origin/main `de256225e4936ad38955c7cbd0b9eb917ce20ea6`**, and a later **`npm ci` + `npm test`** verification at **origin/main `0ea290b97be9bc199fa802f61bd0f6043a005950`** (Round 1). These are separate revisions, not one combined test run. Neither proves every host or Node version works. The checkout was newly cloned into `/tmp/jrm-judge-refresh-87xMgm` (resolved by macOS to `/private/tmp/jrm-judge-refresh-87xMgm`). It was not the development checkout.

## Prerequisites observed

- macOS arm64; Node.js **v26.13.1**, npm **11.20.0**; Docker CLI and daemon **28.4.0**.
- Docker Desktop/daemon was running and the `postgres:16.3-alpine` image was already available as `linux/arm64`.
- `DOCKER_DEFAULT_PLATFORM` was **unset**; no platform workaround was needed.
- Node 26 is newer than the README's Node 24 minimum, and the full suite passed on Node 26. Node 24.22.3 was also tested separately using npx.

## Exact fresh-checkout path

| Step / command | Result | Wall time / evidence |
| --- | --- | --- |
| `git clone --branch main --single-branch https://github.com/justrunme/justrunme-zero.git /tmp/jrm-judge-refresh-87xMgm` | Exit 0, commit `de25622` | Fresh /tmp folder (path has no spaces) |
| `git config user.name "Andrey Lesnikov"` and `git config user.email "52860508+justrunme@users.noreply.github.com"` inside the clone | Exit 0 | Repo-local identity only |
| `npm install` (original `de25622` run; superseded as setup guidance by README `npm ci`) | Exit 0; 6 packages installed, 0 vulnerabilities reported | **1 s** |
| `npm ci` (new clone `/tmp/jrm-review30-dCvEGN`, `0ea290b`; **README-prescribed command**) | Exit 0; 6 packages added, 7 audited, **0 vulnerabilities** | **0.71 s** (`/usr/bin/time -p`) |
| `npm test` (same new clone at `0ea290b`, Node 26.13.1) | Exit 0; **573/573** tests passed, 0 failed, 0 skipped | **113.60 s** (`/usr/bin/time -p`) |
| `npm test` (Node 26.13.1) | **Exit 0**; 573 tests, 573 pass, 0 fail, 0 skipped | **117 s** |
| `node src/cli/index.js judge --text` | **Exit 0**; `judge: ok (exit 0)`, `PASS in 37.4 s (budget 60 s, enforced)` | **38 s** |
| `node src/cli/index.js console --port 47891` | Started, printed localhost URL with per-start token; root returned HTTP **200** and title `JustRunMe Console` | Local HTTP probe; process stopped afterwards |

The original `de25622` test used `npm install`; **current README instead prescribes `npm ci`**. The Round 1 fresh clone at `0ea290b` ran exactly `npm ci` successfully (6 packages, 0 vulnerabilities). The **573/573** original tests, judge, and Console measurements below belong to **`de25622`**. The newer **573/573** test result belongs to **`0ea290b`**; judge and Console were not rerun at that revision. A separate `npx --yes node@24 --test test/*.test.js` run on Node 24.22.3 also passed all 573 tests (exit 0, 47 s); this is not the exact npm script invocation. The README does explicitly document `npm test` and `node src/cli/index.js judge --text`; its CLI reference documents `justrunme console [--port n]`. The console port `47891` was free during this test. Never publish or reuse the Console's per-start token.

## Judge demo: expected output

With Docker running and the Postgres image cached, use:

```sh
node src/cli/index.js judge --text
```

Observed output began:

```text
judge: ok (exit 0)
PASS in 37.4 s (budget 60 s, enforced)
```

## Hidden-trigger hero case (opt-in)

After the default judge check, run the additional PostgreSQL trigger case with Docker running:

```sh
node src/cli/index.js judge --hidden-trigger --text
```

The `--text` flag prints the hidden-trigger verdict and order counts as readable lines; omit `--text` to inspect the full JSON under `result.story.hidden_trigger.*`. The [CLI formatter](../src/cli/index.js) and [scenario](../src/judge/scenario.js) implement both forms.

- The apparently harmless `UPDATE patches SET available_count = 0 WHERE id = 1` fires the database trigger `patches_release_sold_out`, deleting an open order. The rehearsal measures **DATA LOSS**, with orders **3 → 2** and the trigger identified.
- Authorization of that destructive plan returns **DENY / `DATA_LOSS`**.
- The alternative rehearses as **SAFE**, with **0 orders lost**.
- The authorized real-database run applies the safe alternative and preserves **all 3 orders**.
- Undo reports **`RECOVERED`** and recovery verification **`PASS`**.

These are checked in the [Docker integration test](../test/demo-judge.test.js) against the [scenario result](../src/judge/scenario.js); the [recorded agent run](agent-runs/2026-11-20-live2.md) provides additional execution context. The full JSON fields include `result.story.hidden_trigger.trigger`, `.dangerous`, `.denied`, `.safe`, `.run` and `.undo`.

This is **opt-in** because the full run performs four rehearsals (two default and two hidden-trigger), rather than the default two. The [report contract](../src/judge/report.js) sets a separate **90-second** budget for `--hidden-trigger`, versus **60 seconds** for default judge. When the budget is enforced (images already cached), exceeding it produces **`FAIL`** with an **`OVER_BUDGET`** finding. First-time image downloads are timed but exempt from budget enforcement, as the report states.

The step report confirmed a destructive rehearsal denied, a safe alternative rehearsed and authorized, the real run, undo and recovery verification, offline receipt verification, and tamper detection. It ended with:

```text
receipts verified: 8, mismatches: 0, policy violations: 0
```

For the Console, use `node src/cli/index.js console --port 47891` (or omit `--port` for its default). Open the localhost URL printed in its JSON output, including its **private token fragment**. This check verified the HTML HTTP response and title, **not** a full interactive browser walkthrough. Stop it with Ctrl-C when finished.

## Troubleshooting and gaps found

1. **Full test suite now passes on Node 26.** The fresh clone at `de25622` passed 573/573 tests (exit 0, 117 s). The earlier 10 live-run failures recorded against `316625a` are no longer reproduced. This confirms the tested revision and environment, not every platform or future revision.
2. **README now gives a one-line judge start:** `npm ci && node src/cli/index.js judge --text` near the top. Its “Try the judge demo” section also shows `npm ci`, `judge --text`, and `console` together. `npm test` remains in the separate Development section; a judge seeking full-suite verification still needs to locate it. This document retains the measured fresh-checkout evidence without changing README.
3. **Docker is mandatory for judge mode.** This run had a local daemon and cached image, so first-time image pull time and no-Docker error output were **not** measured. The 60-second budget was enforced here because the image was cached.
4. **Node version coverage is limited.** Node 26.13.1 passed the full npm test command; Node 24.22.3 passed the equivalent direct Node test invocation. Other versions and platforms were not tested in this fresh clone.
5. **No browser UI acceptance test was performed.** HTTP 200 confirms that the Console served HTML, not that its interactive workflows were exercised.

## Cleanup

- The judge command removed its own temporary containers, networks and volumes: no `jrm-judge-*` resources remained in `docker ps -a`, `docker network ls` or `docker volume ls` after the run; the judge command reported successful cleanup.
- The Console listener on port `47891` was stopped and verified absent with `lsof`.
- No unrelated Docker resources were intentionally modified.
- Both temporary fresh clones (`/tmp/jrm-judge-refresh-87xMgm` at `de25622`, `/tmp/jrm-review30-dCvEGN` at `0ea290b`) were left in place for reproducibility; it is **not** a running container or service.

No Kiro CLI credits were used for this documentation/verification task; no entry was added to `docs/KIRO_LOG.md`.

Explore the [tested JustRunMe use cases and their reproduction commands](USE_CASES.md).
