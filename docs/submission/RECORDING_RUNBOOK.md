# JustRunMe — recording dry-run and operator checklist

Verified on a fresh `origin/main` clone at **`0ea290b97be9bc199fa802f61bd0f6043a005950`**, 21 November 2026 (Node v26.13.1, Docker daemon available). This identifies the source revision used for the dry run, not necessarily the current main HEAD. Follow `docs/DEMO_VIDEO.md` for the narration and timing. **The Console is a signed recorded export, not a live Kiro run.** The judge command is a separate live demonstration.

## Before recording

- [ ] Open a clean terminal at the repository root. Run `unset DOCKER_DEFAULT_PLATFORM`, then `npm ci`, `node --version` (24+), `docker info`. If the image is not cached, `docker pull postgres:16.3-alpine` before recording; do not present a pre-pulled image as a cold pull.
- [ ] After `unset DOCKER_DEFAULT_PLATFORM`, run `node src/cli/index.js judge --hidden-trigger > judge.json` off-camera. Require exit code **0** and `"status":"PASS"` in the saved `judge.json` before proceeding. Keep the genuine completed report; never overlay a synthetic result. For the terminal shot, run `node src/cli/index.js judge --hidden-trigger --text` separately and show the real completed output with an explicit time cut.
- [ ] Start `node src/cli/index.js console --port 8765 --judge-report judge.json` (choose a free port). Open the **tokenized URL printed by the CLI** in a private browser tab, then open its printed `proof_chain_url` (`#/proof`) in that same private tab for the Proof chain shot. Never record, paste into notes, or share either tokenized URL. Subsequent `#/...` routes must be opened in this authenticated tab. A missing or malformed report is refused with `JUDGE_REPORT_INVALID` (exit 2); correct the report instead of substituting synthetic data.
- [ ] Confirm the `RECORDED RUN · READ ONLY` banner is visible. Use readable zoom and hide browser chrome, personal tabs, environment variables and notifications.

## Shot-by-shot cue sheet

| Script window | Route or terminal | Dry-run observation | Recording cue |
| --- | --- | --- | --- |
| 0:00–0:10 | Completed `node src/cli/index.js judge --hidden-trigger --text` output | Not yet dry-run | Show actual orders **3 → 2** and `DENY DATA_LOSS`; visibly label any time cut |
| 0:10–0:20 | Same completed `judge --hidden-trigger --text` output | Not yet dry-run | Show safe plan with zero lost, real execution and `RECOVERED` from the same run |
| 0:20–0:38 | `docs/agent-runs/2026-11-20-live2.md` | Not yet dry-run | Show the original agent proposal, rehearsal feedback and revision; label **RECORDED KIRO SESSION** |
| 0:38–0:56 | `node src/cli/index.js judge --hidden-trigger --text` | Not yet dry-run | Show completed output with **edited for time — actual run ~68 s**; do not imply the full run took 18 seconds |
| 0:56–1:12 | `src/rehearsal/workspace.js` and `test/demo-chaos.test.js` | Not yet dry-run | Show Git worktree rehearsal and recorded database/file recovery evidence |
| 1:12–1:28 | `docs/agent-runs/2026-11-20-live1.md`, `.kiro/hooks/pretooluse.json`, `test/demo-mcp.test.js` | Not yet dry-run | Show recorded `rm -rf` denial and nine MCP tools; label hook transcript **RECORDED** |
| 1:28–1:45 | `docs/evidence/chaos-live-2026-11-20/README.md` | Not yet dry-run | Show **RECORDED CHAOS TWIN** evidence: SIGKILL, recovery proven, 21 checks passed |
| 1:45–1:55 | Printed `proof_chain_url` (`#/proof`) from `console --port 8765 --judge-report judge.json` | Not yet dry-run | Show five steps: hidden-trigger orders **3 → 2**, dangerous plan **DENIED**, safe plan **0 orders / 0 patches lost**, undo **RECOVERED**, verification **PASS**; show overall judge **PASS** badge |
| 1:55–2:00 | `#/proof` (same authenticated tab) | Not yet dry-run | JustRunMe logo over the final Proof chain PASS view; “Rehearse. Run. Recover.” |

## Script mismatches / production cautions

1. The 0:38–0:56 slot is **18 seconds**, while the earlier default `judge --text` dry run took **38.4 s** and **37.5 s**, **both with `postgres:16.3-alpine` already cached**. These are not hidden-trigger timings. **Cold image pull not measured; first pull takes longer.** The script says to cut waiting; the recording must not imply the entire hidden-trigger command completed in 18 seconds.
2. The recovery mission displays **RECOVERED · CHECKS UNKNOWN**, not an unqualified fully proven recovery. Its receipt says undo verification PASS, but does not list the checks; it predates database-grant coverage. Keep that warning legible.
3. The first mission's approval is a recorded human Console approval; the second mission was authorized at the command line. They are separate examples, not one execution/undo.
4. The first attempt on a clean clone failed with `ERR_MODULE_NOT_FOUND: yaml` because dependencies were not installed. **Run `npm ci` first.** After installation, both judge runs passed.
5. The judge demonstration creates and verifies throwaway resources. It is not the same run as the signed Console export; label the cut clearly.

## After recording

- [ ] Stop Console with Ctrl+C. Verify `docker ps -a` has no new JustRunMe judge containers; investigate before deleting anything unrelated.
- [ ] Remove only the temporary clone and resources created for this rehearsal. Do not delete other workspaces.
- [ ] Review footage for accidental token disclosure and distinguish recorded evidence from live execution.
- [ ] Do not publish/upload/submit as part of this checklist.

Dry-run routes were opened in an authenticated browser tab against a locally running Console, and rendered text was inspected at each step. This was a route/content check, **not** a pixel-by-pixel 1280×720 readability certification.
