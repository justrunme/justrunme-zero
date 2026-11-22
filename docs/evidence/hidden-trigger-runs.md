# Hidden-trigger judge: four consecutive PASS runs

**Four out of four live Docker/PostgreSQL runs passed.** JustRunMe caught the hidden `patches_release_sold_out` trigger deleting an order (**3 → 2**), denied the dangerous action, selected and ran the safe alternative with **zero lost rows**, and verified recovery. Every run verified **16 signed receipts with zero mismatches**. All four runs completed under the enforced **90-second budget**.

Run on 22 November 2026 (Europe/Berlin), with `DOCKER_DEFAULT_PLATFORM` unset, from current `origin/main`. Three sequential runs used the existing checkout; the fourth used a fresh temporary clone with `npm ci --ignore-scripts`. All ran the actual `node src/cli/index.js judge --hidden-trigger --text` command against disposable Docker PostgreSQL containers. The table records judge-reported duration, not shell wall time.

| Run | Git commit | Judge duration | Verdict | Cleanup | Receipts verified / mismatches | Orders before → after |
| --- | --- | ---: | --- | --- | ---: | --- |
| Existing checkout #1 | `38316068d4fb` | 68.2 s | PASS; hidden trigger DATA LOSS, DENY | Verified: containers gone | 16 / 0 | 3 → 2; safe plan 0 lost |
| Existing checkout #2 | `38316068d4fb` | 67.7 s | PASS; hidden trigger DATA LOSS, DENY | Verified: containers gone | 16 / 0 | 3 → 2; safe plan 0 lost |
| Existing checkout #3 | `38316068d4fb` | 67.0 s | PASS; hidden trigger DATA LOSS, DENY | Verified: containers gone | 16 / 0 | 3 → 2; safe plan 0 lost |
| Fresh clone | `38316068d4fb` | 67.6 s | PASS; hidden trigger DATA LOSS, DENY | Verified: containers gone | 16 / 0 | 3 → 2; safe plan 0 lost |

The judge also reported `dangerous plan: DATA LOSS, rows lost: 1`, `safe plan: SAFE, rows lost: 0`, successful authorization denial, successful execution of the safe alternative, `Undo the run and verify the recovery`, and `Verify again with the containers gone and no Docker on the path` in each run. Policy violations: **0** in all runs. The cleanup evidence is the successful post-container-removal verification step; no separate host-level Docker resource inventory was recorded.

## Reproduction

```sh
unset DOCKER_DEFAULT_PLATFORM
node src/cli/index.js judge --hidden-trigger --text
```

Repeat three times in the checkout. For the fourth, clone the repository into a fresh temporary directory, configure the local Git identity, run `npm ci --ignore-scripts`, then invoke the same command. Exact captured stdout/stderr and shell wall-clock timings are committed alongside this document as `hidden-trigger-run-{1,2,3,clone}.txt`.

## Honest limits

This is repeatability evidence for four runs on one Mac/Docker host, not a cross-platform or statistical reliability claim. The demo uses disposable local PostgreSQL and a demo approver key, not a human approval ceremony. The 90-second budget applies to the judge's measured runtime; shell wall time also includes process startup and teardown.
