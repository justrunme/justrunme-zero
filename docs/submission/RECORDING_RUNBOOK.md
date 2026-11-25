# JustRunMe — recording dry-run and operator checklist

Historical dry run on a fresh `origin/main` clone at **`0ea290b97be9bc199fa802f61bd0f6043a005950`**, 21 November 2026 (Node v26.13.1, Docker daemon available). This identifies the source revision used for the dry run, not necessarily the current main HEAD. The Vanishing Order cue sheet below has not yet been dry-run. Follow `docs/DEMO_VIDEO.md` for the narration and timing. **The Console is a signed recorded export, not a live Kiro run.** The judge command is a separate live demonstration.

## Before recording

- [ ] Open a clean terminal at the repository root. Run `unset DOCKER_DEFAULT_PLATFORM`, then `npm ci`, `node --version` (24+), `docker info`. If the image is not cached, `docker pull postgres:16.3-alpine` before recording; do not present a pre-pulled image as a cold pull.
- [ ] After `unset DOCKER_DEFAULT_PLATFORM`, run `node src/cli/index.js judge --hidden-trigger > judge.json` off-camera. Require exit code **0** and `"status":"PASS"` in the saved `judge.json` before proceeding. Record only from a fresh report produced by this command on PR #79 head or later; never use the committed fixture `test/fixtures/judge-hidden-trigger-report.json` for the video. Keep the genuine completed report; never overlay a synthetic result. For the terminal shot, run `node src/cli/index.js judge --hidden-trigger --text` separately and show the real completed output with an explicit time cut.
- [ ] Start `node src/cli/index.js console --port 8765 --judge-report judge.json` (choose a free port). Open the **tokenized URL printed by the CLI** in a private browser tab, then open its printed `proof_chain_url` (`#/proof`) in that same private tab for the Proof chain shot. Never record, paste into notes, or share either tokenized URL. Subsequent `#/...` routes must be opened in this authenticated tab. A missing or malformed report is refused with `JUDGE_REPORT_INVALID` (exit 2); correct the report instead of substituting synthetic data.
- [ ] Confirm the `RECORDED RUN · READ ONLY` banner is visible. Use readable zoom and hide browser chrome, personal tabs, environment variables and notifications.

## Shot-by-shot cue sheet — Vanishing Order (2:15)

The primary source is `docs/DEMO_VIDEO.md`. Do not mix the recorded Kiro session with a separate judge run as one continuous execution.

| Time | Required shot | Evidence and recording check |
| --- | --- | --- |
| 0:00–0:06 | Three orders, Order #2 OPEN, one-line SQL and the question | Verify the order row and SQL are from the same documented demo setup. |
| 0:06–0:32 | Disposable rehearsal 3 → 2 versus untouched target 3 → 3 | Show explicit **COPY / TARGET** labels and actual hidden-trigger evidence; display `DATA LOSS · DENIED` by approximately 0:15. |
| 0:32–0:55 | Recorded Kiro attempt to disable the trigger | Label **RECORDED KIRO SESSION**; show `LOGIC BYPASS · DENIED`; the role refused the attempt. |
| 0:55–1:20 | Business-function fix, Order #2 CANCELLED, approved run | Use live2 receipts for operator approval and matching execution. Do not call judge scripted authorization human approval. |
| 1:20–1:45 | Spec → test → steering → MCP, plus separately recorded hook denial | Verify each file/command is authentic. Hook refusal is a different boundary from SQL rehearsal. |
| 1:45–2:08 | Separate undo and verified restored state | Do not claim live2 itself was undone. If the chosen recovery evidence does not explicitly prove Order #2 OPEN, do not overlay that claim. Keep `CHECKS UNKNOWN` if present. |
| 2:08–2:15 | Proof Chain and reproducibility command | Load the fresh `judge.json`; before recording verify the cards read “Order #2 disappeared” (rehearsal copy) and “Order #2 · cancelled, not deleted” (after the approved run). Keep **RECORDED JUDGE REPORT** visible, hide token. |

**Pre-export review:** Pause at the DENIED frame with sound off: can a viewer tell where the order disappeared, whether the original target was touched, and what happens next? Ask two people to explain Order #2's journey. If they think the production order was deleted and then restored, fix the labels and edit before publishing. Check the final compressed export at normal playback size.

**Optional footage:** The tamper-check recipe below remains available for Devpost supporting evidence or an alternate cut; it is **not** in the primary 2:15 video. Chaos Twin and test counts belong in the written submission unless the story remains intelligible.

## Optional tamper-check terminal footage (alternate cut)

Run from the repository root, using a **throwaway copy only**. Never modify `demo/recorded-run/` itself. The anchor destination must be calculated from the copy's real path, not the original repository path. This is the same recorded-export layout used by `src/console/recorded.js`:

```js
// Run with: node --input-type=module < tamper-shot.mjs (or paste into a Node heredoc)
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { anchorPath } from './src/receipts/chain.js'
const root = mkdtempSync(path.join(os.tmpdir(), 'jrm-tamper-demo-'))
const repoDir = path.join(root, 'recorded-run')
const home = path.join(root, 'home')
const sourceRoot = process.cwd()
cpSync(path.join(sourceRoot, 'demo/recorded-run'), repoDir, { recursive: true })
mkdirSync(path.join(home, 'heads'), { recursive: true })
copyFileSync(path.join(repoDir, 'operator.pub'), path.join(home, 'operator.pub'))
for (const mission of JSON.parse(readFileSync(path.join(repoDir, 'manifest.json'), 'utf8')).missions) {
  copyFileSync(path.join(repoDir, 'anchors', `${mission}.json`), anchorPath(home, mission, repoDir))
}
const missionId = 'mission-t25v2-a'
const chainFile = path.join(repoDir, '.justrunme/missions', missionId, 'receipts.jsonl')
const verify = () => spawnSync(process.execPath, [path.join(sourceRoot, 'src/cli/index.js'), 'verify', '--repo', repoDir, '--mission', missionId], { env: { ...process.env, JUSTRUNME_HOME: home }, encoding: 'utf8' })
const show = (name, result) => { console.log(`${name} exit ${result.status}`); process.stdout.write(result.stdout) }
show('CLEAN', verify())
const original = readFileSync(chainFile)
const changed = Buffer.from(original)
changed[30] = changed[30] ^ 1
writeFileSync(chainFile, changed)
show('TAMPERED', verify())
writeFileSync(chainFile, original)
show('RESTORED', verify())
```

For manual terminal verification, the equivalent command is `JUSTRUNME_HOME=<throwaway-home> node src/cli/index.js verify --repo <throwaway-copy> --mission mission-t25v2-a`. The script was executed on the copy: CLEAN **exit 0** (`ok: true`, eight receipts); TAMPERED **exit 30**, `chain_findings` of `seq: 0 / receipt belongs to another mission`, `seq: 0 / signature does not verify`, and `seq: 1 / previous-hash link is broken`; RESTORED **exit 0** (`ok: true`, eight receipts). The byte at offset 30 is intentionally unchanged from `corruptChain()`; do not edit another offset. The recording shot itself is **Not yet dry-run**. Keep the temporary home and copy together; delete only this throwaway directory when finished.

## Script mismatches / production cautions

1. The historical 0:38–0:56 slot was **18 seconds**, while the earlier default `judge --text` dry run took **38.4 s** and **37.5 s**, **both with `postgres:16.3-alpine` already cached**. These are not hidden-trigger timings. **Cold image pull not measured; first pull takes longer.** The script says to cut waiting; the recording must not imply the entire hidden-trigger command completed within the edited shot; label cuts **EDITED FOR TIME**.
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
