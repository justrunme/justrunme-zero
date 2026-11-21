# JustRunMe — recording dry-run and operator checklist

Verified on a fresh `origin/main` clone at **`0ea290b97be9bc199fa802f61bd0f6043a005950`**, 21 November 2026 (Node v26.13.1, Docker daemon available). This identifies the source revision used for the dry run, not necessarily the current main HEAD. Follow `docs/DEMO_VIDEO.md` for the narration and timing. **The Console is a signed recorded export, not a live Kiro run.** The judge command is a separate live demonstration.

## Before recording

- [ ] Open a clean terminal at the repository root. Run `unset DOCKER_DEFAULT_PLATFORM`, then `npm ci`, `node --version` (24+), `docker info`. If the image is not cached, `docker pull postgres:16.3-alpine` before recording; do not present a pre-pulled image as a cold pull.
- [ ] Run `node src/cli/index.js judge --hidden-trigger --text` once off-camera, after `unset DOCKER_DEFAULT_PLATFORM`. Require exit 0 and actual `PASS`; never overlay a synthetic result.
- [ ] Start `node src/cli/index.js console --port 8765` (choose a free port). Open the **tokenized URL printed by the CLI** in a private browser tab; never record, paste into notes, or share the token. Subsequent `#/...` routes must be opened in this authenticated tab.
- [ ] Confirm the `RECORDED RUN · READ ONLY` banner is visible. Use readable zoom and hide browser chrome, personal tabs, environment variables and notifications.

## Shot-by-shot cue sheet

| Script window | Route or terminal | Dry-run observation | Recording cue |
| --- | --- | --- | --- |
| 0:00–0:08 | `#/missions/mission-t25v2-a/rehearsed` | **Works:** DATA LOSS DETECTED; orders **3 → 2 (1 lost)**; trigger `patches_release_sold_out`; SQL visible | Start here; show banner and measured loss |
| 0:08–0:20 | `#/missions/mission-t25v2-a/denied` then `#/missions/mission-t25v2-a/repaired` | **Works:** LOGIC BYPASS DETECTED, blocked; SAFE · MEASURED, orders **3 → 3** | Show both verdicts, not a fabricated live repair |
| 0:20–0:29 | `#/missions/mission-t25v2-a/approved` then `#/missions/mission-t25v2-a/executed` | **Works:** operator approved this exact version; run completed; real result equals rehearsal | Keep recorded-source label visible |
| 0:29–0:39 | `#/missions/mission-demo-b` then `#/recovery` | **Works with caveat:** RECOVERED · CHECKS UNKNOWN; undo PASS, old receipt omits check inventory | Overlay “Separate recovery example”; show caveat |
| 0:39–0:47 | `#/missions/mission-demo-b/verified` then `#/recovery` | **Works with caveat:** receipt chain verified (5 signed receipts); checks completeness unknown | Show receipt chain, do not imply grants verified |
| 0:47–1:00 | `node src/cli/index.js judge --text` | **Works:** exit 0; first run **38.4 s**, second run **37.5 s** (CLI durations; **postgres:16.3-alpine already cached for both**); 8 receipts verified, 0 mismatches, 0 policy violations | Use an honest time cut or pre-recorded full command; 13-second slot cannot show its entire runtime |
| 1:00–1:15 | `docs/agent-runs/2026-11-20-live1.md` and `.kiro/hooks/pretooluse.json` | **Recorded document, not a Console route:** show original `rm -rf demo/migrations` denial and `NO_AUTHORIZATION` from the committed transcript | Label “Recorded Kiro session” |
| 1:15–1:28 | `#/missions/mission-t25v2-a/rehearsed` then `#/missions/mission-t25v2-a/repaired` | **Works:** DATA LOSS 3 → 2 versus SAFE 3 → 3 | End on JustRunMe branding |

## Script mismatches / production cautions

1. The 0:47–1:00 slot is **13 seconds**, while the **first run took 38.4 s and the second 37.5 s**, **both with `postgres:16.3-alpine` already cached**. **Cold image pull not measured; first pull takes longer.** The script already says to cut waiting; the recording must not imply the entire command completed in 13 seconds.
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
