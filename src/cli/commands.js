/**
 * CLI command handlers (T18). Each one is a thin call into the same library
 * functions the tests use: no command has its own path around the fidelity gate,
 * the selection gate (src/compare/gate.js, inside authorizeMission) or the receipt
 * chain. Every handler returns { exit, result } or throws CliError.
 *
 * Operator keys are never created implicitly: only `keys init` creates them.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseContract } from '../contract/parser.js'
import { CONTRACT_FILE } from '../hook/run.js'
import { keyHome, loadExistingKeys, loadOrCreateKeys, loadPublicKey, publicKeyHex } from '../receipts/keys.js'
import { ApproverKeyError, MIN_PASSPHRASE, approverKeyExists, createApproverKey, loadApproverKey, loadApproverPublicKey } from '../receipts/approver.js'
import { ApprovalError, listRequests, loadRequest, requestState, sha256File } from '../approval/requests.js'
import { readPassphrase } from './passphrase.js'
import { verifyHistory } from '../history/archive.js'
import { buildStory } from '../history/story.js'
import { appendReceipt, inspectChainLock, reanchorChain, receiptHash, recoverLock, verifyChain } from '../receipts/chain.js'
import { checkPolicy } from '../receipts/policy.js'
import { hashValue } from '../util/canonical.js'
import { RehearsalRefused, loadReport, planId, rehearse, reportSignatureProblem } from '../rehearsal/engine.js'
import { ComparisonRefused } from '../compare/compare.js'
import { comparePlans, verifySelection } from '../compare/select.js'
import { plansOnBase } from '../compare/gate.js'
import { AuthorizationRefused, signatureProblem } from '../authorize/authorization.js'
import { authorizationPath, authorizeMission, runMission } from '../run/mission.js'
import { UndoRefused, undoMission } from '../undo/undo.js'
import { PlanRefused, loadStoredPlan } from '../mission/plans.js'
import { JudgeEnvironmentError, createBackend } from '../judge/env.js'
import { runJudge } from '../judge/index.js'
import { EXIT, verdictExit } from './codes.js'
import { ConfigError, loadTarget } from './target.js'

export class CliError extends Error {
  /** @param {number} exit @param {string} code @param {string} message @param {unknown} [detail] */
  constructor(exit, code, message, detail) {
    super(message)
    this.exit = exit
    this.code = code
    this.detail = detail
  }
}

const CAPTURE_RE = /^cap-\d{14}-[0-9a-f]{6}$/

/**
 * The contract a command works on: the operator's mission file, or with --plan the
 * stored plan an agent proposed through the MCP server (operator mission + that plan).
 */
function contractOf(repoDir, opts = {}) {
  if (opts.plan !== undefined) {
    try {
      return loadStoredPlan(repoDir, opts.plan)
    } catch (err) {
      if (err instanceof PlanRefused) throw new CliError(EXIT.CONFIG, err.code, err.message, err.detail)
      throw err
    }
  }
  const file = path.join(repoDir, CONTRACT_FILE)
  if (!existsSync(file)) throw new CliError(EXIT.CONFIG, 'NO_CONTRACT', `${CONTRACT_FILE} not found in the workspace`)
  const parsed = parseContract(readFileSync(file, 'utf8'))
  if (!parsed.ok) throw new CliError(EXIT.CONFIG, 'CONTRACT_INVALID', 'mission contract does not validate', parsed.errors)
  return parsed
}

function targetOf(repoDir) {
  try {
    return loadTarget(repoDir)
  } catch (err) {
    if (err instanceof ConfigError) throw new CliError(EXIT.CONFIG, err.code, err.message)
    throw err
  }
}

function operatorKeys() {
  const keys = loadExistingKeys(keyHome())
  if (!keys) throw new CliError(EXIT.CONFIG, 'NO_OPERATOR_KEY', 'no operator key installed; run `justrunme keys init` first')
  return keys
}

/** Read-only commands need only the public key (judges, CI). */
function publicSide() {
  const home = keyHome()
  const publicKey = loadPublicKey(home)
  if (!publicKey) throw new CliError(EXIT.CONFIG, 'NO_OPERATOR_KEY', 'no operator public key installed')
  return { home, publicKey }
}

const missionOf = (repoDir, opts) => opts.mission ?? contractOf(repoDir).contract.id

// Shared with src/cli/evidence-commands.js.
export { contractOf, operatorKeys, publicSide, missionOf, verifiedChain, targetOf, preflight }

function refused(exit, err) {
  const detail = err.recorded === false ? { ...(err.detail !== undefined ? { reason_detail: err.detail } : {}), recorded: false, record_error: err.record_error } : err.detail
  throw new CliError(exit, err.code, err.message, detail)
}

/**
 * A lock whose owner cannot be determined never clears by itself: say so at once
 * instead of waiting for the timeout. (A live owner is waited for as usual.)
 */
function preflight(repoDir, missionId) {
  const lock = inspectChainLock({ repoDir, missionId })
  if (lock.exists && lock.owner === 'unknown') {
    throw new CliError(EXIT.CHAIN_LOCKED, 'CHAIN_LOCKED', 'the receipt chain lock has an unknown owner; inspect it with `justrunme lock inspect`', { sha256: lock.sha256 })
  }
}

/** Work was done but its receipt could not be written: never report that as success. */
function unrecorded(result) {
  if (!result.receipt_error) return
  const exit = result.receipt_error === 'CHAIN_LOCKED' ? EXIT.CHAIN_LOCKED : EXIT.INTEGRITY
  throw new CliError(exit, 'RESULT_UNRECORDED', `the command did its work but its receipt could not be written (${result.receipt_error}); the result below is not in the chain`, result)
}

/** verifyChain, read without the lock: retry once if a parallel append was caught between line and anchor. */
function verifiedChain(args) {
  const first = verifyChain(args)
  if (first.ok || !first.findings.every((f) => f.code === 'ANCHOR_BEHIND')) return first
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
  return verifyChain(args)
}

/**
 * The one-command demo. It builds its own throwaway workspace, key and database, so
 * it takes neither --repo nor --mission and never reads the operator's key directory.
 */
export async function judgeCmd({ opts }) {
  if (opts.repo !== undefined || opts.mission !== undefined) throw new CliError(EXIT.USAGE, 'USAGE', 'judge builds its own workspace; it takes no --repo or --mission')
  let report
  try {
    report = await runJudge({ create: () => createBackend() })
  } catch (err) {
    if (err instanceof JudgeEnvironmentError) throw new CliError(EXIT.JUDGE_ENVIRONMENT, err.code, err.message)
    throw err
  }
  return { exit: report.judge.status === 'PASS' ? EXIT.OK : EXIT.JUDGE_FAILED, result: report }
}

export function keysInit() {
  const home = keyHome()
  const existed = loadPublicKey(home) !== null
  const keys = loadOrCreateKeys(home)
  return { exit: EXIT.OK, result: { created: !existed, public_key: publicKeyHex(keys.publicKey) } }
}

export async function rehearseCmd({ repoDir, opts = {} }) {
  const c = contractOf(repoDir, opts)
  const { target } = targetOf(repoDir)
  const keys = operatorKeys()
  preflight(repoDir, c.contract.id)
  let report
  try {
    report = await rehearse({ repoDir, contract: c.contract, contractHash: c.hash, target, keys })
  } catch (err) {
    if (err instanceof RehearsalRefused) refused(err.code === 'CONFLICT' ? EXIT.CONFLICT : EXIT.REHEARSAL_REFUSED, err)
    throw err
  }
  const rowsLost = Object.fromEntries(report.conditions.protected_tables.map((t) => [t, report.tables?.[t]?.rows_lost ?? null]))
  const summary = {
    mission_id: report.mission_id,
    plan_id: report.plan_id,
    verdict: report.verdict,
    evidence: report.evidence,
    threshold_breaches: report.threshold_breaches ?? [],
    rows_lost: rowsLost,
    schema_delta: report.schema_delta ?? null,
    base_hash: report.base_hash,
    duration_ms: report.duration_ms,
    cleanup: report.cleanup,
    receipt_error: report.receipt_error,
  }
  unrecorded(summary)
  return {
    // A copy that was not removed holds a dump of the real database: that outranks the verdict.
    exit: report.cleanup?.clean === false ? EXIT.REHEARSAL_UNCLEAN : verdictExit(report.verdict),
    result: summary,
  }
}

/**
 * Without plan ids: every plan whose latest rehearsal is on the base of the most
 * recent rehearsal. The selection gate requires exactly that coverage anyway.
 */
export function compareCmd({ repoDir, opts, planIds }) {
  const keys = operatorKeys()
  const missionId = missionOf(repoDir, opts)
  preflight(repoDir, missionId)
  let ids = planIds
  if (ids.length === 0) {
    const chain = verifyChain({ repoDir, home: keys.home, publicKey: keys.publicKey, missionId })
    if (!chain.ok) throw new CliError(EXIT.COMPARISON_REFUSED, 'CHAIN_INVALID', `receipt chain does not verify: ${chain.findings[0].problem}`)
    const last = chain.receipts.filter((r) => r.kind === 'rehearsal').at(-1)
    ids = last ? [...plansOnBase(chain.receipts, last.subject.base_hash).keys()].sort() : []
  }
  let r
  try {
    r = comparePlans({ repoDir, keys, missionId, planIds: ids })
  } catch (err) {
    if (err instanceof ComparisonRefused) refused(EXIT.COMPARISON_REFUSED, err)
    throw err
  }
  const ranking = r.comparison.ranking
  return {
    exit: ranking.recommended ? EXIT.OK : EXIT.NO_PLAN_SELECTED,
    result: {
      recommended: ranking.recommended,
      decided_by: ranking.decided_by,
      removed: ranking.removed,
      rules: ranking.rules,
      plans: r.comparison.plans,
      base_hash: r.comparison.base_hash,
      comparison_hash: r.comparison_hash,
      receipt_hash: r.receipt_hash,
    },
  }
}

/** The decrypted approver key; only the commands a human runs at a terminal call this. */
async function approverKey(opts, prompt) {
  if (!approverKeyExists(keyHome())) throw new CliError(EXIT.CONFIG, 'NO_APPROVER_KEY', 'no approver key is installed; run `justrunme approver init`')
  const passphrase = await readPassphrase({ fromStdin: opts['passphrase-stdin'] === true, prompt })
  if (passphrase === null || passphrase.value === '') throw new CliError(EXIT.CONFIG, 'NO_PASSPHRASE', 'the approver passphrase must be typed at a terminal, or given with --passphrase-stdin or JUSTRUNME_APPROVER_PASSPHRASE')
  try {
    return { ...loadApproverKey(keyHome(), passphrase.value), source: passphrase.source }
  } catch (err) {
    if (err instanceof ApproverKeyError) throw new CliError(EXIT.CONFIG, err.code, err.message)
    throw err
  }
}

/** Run verifies an authorization with the public half only. */
function approverPublic() {
  const key = loadApproverPublicKey(keyHome())
  if (!key) throw new CliError(EXIT.CONFIG, 'NO_APPROVER_KEY', 'no approver key is installed; run `justrunme approver init`')
  return key
}

export async function approverInit({ opts }) {
  const home = keyHome()
  if (approverKeyExists(home)) throw new CliError(EXIT.CONFIG, 'APPROVER_EXISTS', 'an approver key already exists; remove approver.key.enc and approver.pub from the key directory to replace it')
  const passphrase = await readPassphrase({ fromStdin: opts['passphrase-stdin'] === true, prompt: `New approver passphrase (${MIN_PASSPHRASE}+ characters): ` })
  if (passphrase === null) throw new CliError(EXIT.CONFIG, 'NO_PASSPHRASE', 'the approver passphrase must be typed at a terminal, or given with --passphrase-stdin or JUSTRUNME_APPROVER_PASSPHRASE')
  // Typed at a terminal: once more, because a typo would lock the key for good.
  if (passphrase.source === 'tty') {
    const again = await readPassphrase({ env: {}, prompt: 'Repeat the passphrase: ' })
    if (again?.value !== passphrase.value) throw new CliError(EXIT.CONFIG, 'PASSPHRASE_MISMATCH', 'the two passphrases differ; nothing was created')
  }
  try {
    const { publicKey } = createApproverKey(home, passphrase.value)
    return { exit: EXIT.OK, result: { created: true, approver_public_key: publicKeyHex(publicKey) } }
  } catch (err) {
    if (err instanceof ApproverKeyError) throw new CliError(EXIT.CONFIG, err.code, err.message)
    throw err
  }
}

export async function authorizeCmd({ repoDir, opts = {} }) {
  const c = contractOf(repoDir, opts)
  const { target } = targetOf(repoDir)
  const keys = operatorKeys()
  preflight(repoDir, c.contract.id)
  const approver = await approverKey(opts, 'Approver passphrase: ')
  let auth
  try {
    auth = await authorizeMission({ repoDir, contract: c.contract, contractHash: c.hash, target, keys, approver, passphraseSource: approver.source })
  } catch (err) {
    if (err instanceof AuthorizationRefused) refused(EXIT.AUTHORIZATION_REFUSED, err)
    throw err
  }
  return { exit: EXIT.OK, result: { mission_id: auth.mission_id, plan_id: auth.plan_id, selection: auth.selection ?? null, expires_at: auth.expires_at, fingerprint_hash: auth.fingerprint_hash } }
}

/** A completed step sequence is not a successful run without a measured match. */
export function runExitCode(r) {
  if (!r.ok || r.outcome?.matches !== true) return EXIT.RUN_FAILED
  if (r.skipped_needs_approval.length > 0) return EXIT.RUN_INCOMPLETE
  return EXIT.OK
}

export async function runCmd({ repoDir, opts = {} }) {
  const c = contractOf(repoDir, opts)
  const { target } = targetOf(repoDir)
  const keys = operatorKeys()
  preflight(repoDir, c.contract.id)
  let r
  try {
    r = await runMission({ repoDir, contract: c.contract, contractHash: c.hash, target, keys, approverPublicKey: approverPublic() })
  } catch (err) {
    if (err instanceof AuthorizationRefused) refused(EXIT.RUN_REFUSED, err)
    throw err
  }
  const result = { mission_id: r.mission_id, plan_id: r.plan_id, ok: r.ok, capture_id: r.capture_id, skipped_needs_approval: r.skipped_needs_approval, steps: r.steps, outcome: r.outcome, receipt_hash: r.receipt_hash, receipt_error: r.receipt_error }
  unrecorded(result)
  const exit = runExitCode(r)
  return { exit, result }
}

export async function undoCmd({ repoDir, opts, captureId }) {
  if (!CAPTURE_RE.test(captureId ?? '')) throw new CliError(EXIT.USAGE, 'INVALID_CAPTURE_ID', 'undo needs a capture id of the form cap-<14 digits>-<6 hex>')
  const missionId = missionOf(repoDir, opts)
  const { target, health } = targetOf(repoDir)
  const keys = operatorKeys()
  // Break-glass recovery: explicit flag, a written reason, and the capture id typed again.
  const emergency = opts['emergency-recovery'] === true
  if (emergency) {
    if (typeof opts.reason !== 'string' || opts.reason.trim().length < 8) throw new CliError(EXIT.USAGE, 'EMERGENCY_REASON_REQUIRED', '--emergency-recovery needs --reason "<why>" (at least 8 characters)')
    if (opts.confirm !== captureId) throw new CliError(EXIT.USAGE, 'CONFIRMATION_REQUIRED', '--emergency-recovery needs --confirm <the same capture id>')
  } else {
    preflight(repoDir, missionId)
  }
  let r
  try {
    r = await undoMission({ repoDir, missionId, captureId, target, keys, health, resources: opts.resource, emergency: emergency ? { reason: opts.reason } : null })
  } catch (err) {
    if (err instanceof UndoRefused) refused(EXIT.UNDO_REFUSED, err)
    throw err
  }
  const result = {
    mission_id: r.mission_id,
    capture_id: r.capture_id,
    status: r.status,
    evidence_status: r.evidence_status,
    resources: r.resources,
    verification: { status: r.verification.status, checks: r.verification.checks.length, failed: r.verification.failed, not_checked: r.verification.not_checked ?? [] },
    receipts: r.receipts,
    ...(emergency ? { emergency_record: r.emergency_record ?? null } : {}),
    receipt_error: r.receipt_error,
  }
  unrecorded(result)
  if (r.status === 'RESTORED_UNVERIFIED') return { exit: EXIT.RECOVERY_UNVERIFIED, result }
  if (r.status !== 'RECOVERED') return { exit: EXIT.RECOVERY_FAILED, result }
  // Never exit 0 for a break-glass recovery: CI must not read it as a normal undo.
  return { exit: emergency ? EXIT.EMERGENCY_RECOVERED : EXIT.OK, result }
}

/** Chain, ordering policy, and a replay of every recorded selection. */
export function verifyCmd({ repoDir, opts }) {
  const { home, publicKey } = publicSide()
  const missionId = missionOf(repoDir, opts)
  const chain = verifiedChain({ repoDir, home, publicKey, missionId })
  // An empty or mistyped mission has nothing to verify; that is not a pass.
  if (chain.ok && chain.count === 0) throw new CliError(EXIT.USAGE, 'NO_RECEIPTS', `mission ${missionId} has no receipts`)
  const policy = chain.ok ? checkPolicy(chain.receipts) : { ok: false, findings: [] }
  const selections = chain.ok
    ? chain.receipts.filter((r) => r.kind === 'plan_selected').map((r) => {
        const v = verifySelection({ repoDir, home, publicKey, missionId, receiptHash: receiptHash(r) })
        return { seq: r.seq, recommended: r.subject?.recommended ?? null, ok: v.ok, findings: v.findings }
      })
    : []
  // T27.1: every version the chain names must be in the history archive, unchanged.
  const history = chain.ok ? verifyHistory(repoDir, missionId, chain.receipts) : { ok: false, versions: 0, legacy_versions: 0, findings: [] }
  const ok = chain.ok && policy.ok && selections.every((s) => s.ok) && history.ok
  return {
    exit: ok ? EXIT.OK : EXIT.INTEGRITY,
    result: { mission_id: missionId, ok, receipts: chain.count, chain_findings: chain.findings, policy_findings: policy.findings, selections, history },
  }
}

/** The mission story from the verified chain and the history archive (what the Console shows). */
export function historyCmd({ repoDir, opts }) {
  const { home, publicKey } = publicSide()
  const missionId = missionOf(repoDir, opts)
  const chain = verifiedChain({ repoDir, home, publicKey, missionId })
  if (chain.ok && chain.count === 0) throw new CliError(EXIT.USAGE, 'NO_RECEIPTS', `mission ${missionId} has no receipts`)
  const story = buildStory({ repoDir, missionId, chain })
  const ok = story.chain_ok && story.history.ok && story.links.every((l) => l.ok)
  return { exit: ok ? EXIT.OK : EXIT.INTEGRITY, result: story }
}

export function replayCmd({ repoDir, opts }) {
  const { home, publicKey } = publicSide()
  const missionId = missionOf(repoDir, opts)
  const chain = verifiedChain({ repoDir, home, publicKey, missionId })
  if (chain.ok && !chain.receipts.some((r) => r.kind === 'plan_selected')) throw new CliError(EXIT.USAGE, 'NOTHING_TO_REPLAY', 'no plan_selected receipt in this mission')
  if (chain.ok && opts.receipt !== undefined && !chain.receipts.some((r) => r.kind === 'plan_selected' && receiptHash(r) === opts.receipt)) {
    throw new CliError(EXIT.USAGE, 'NOT_A_SELECTION', '--receipt does not name a plan_selected receipt of this mission')
  }
  const v = verifySelection({ repoDir, home, publicKey, missionId, receiptHash: opts.receipt ?? null })
  return { exit: v.ok ? EXIT.OK : EXIT.INTEGRITY, result: { mission_id: missionId, ...v } }
}

/**
 * Status shows only what checks out: the current plan's report counts as rehearsed
 * only if it is operator-signed and recorded by a rehearsal receipt; the pending
 * authorization only if it is signed, recorded, for this contract and not expired.
 * Exit 30 when the chain does not verify.
 */
export function statusCmd({ repoDir, opts }) {
  const { home, publicKey } = publicSide()
  const contractPresent = existsSync(path.join(repoDir, CONTRACT_FILE))
  const c = opts.mission && !contractPresent ? null : contractOf(repoDir)
  const missionId = opts.mission ?? c.contract.id
  const chain = verifiedChain({ repoDir, home, publicKey, missionId })
  const counts = {}
  for (const r of chain.receipts) counts[r.kind] = (counts[r.kind] ?? 0) + 1
  const last = chain.receipts.at(-1)
  const id = c ? planId(c.contract) : null
  let report = null
  if (id) {
    try {
      const rep = loadReport(repoDir, missionId, id)
      const problem = reportSignatureProblem(rep, publicKey) ?? (chain.receipts.some((r) => r.kind === 'rehearsal' && r.subject?.report_hash === hashValue(rep)) ? null : 'no rehearsal receipt records this report')
      report = problem ? { valid: false, problem } : { valid: true, verdict: rep.verdict, base_hash: rep.base_hash, rehearsed_at: rep.rehearsed_at }
    } catch {
      report = null
    }
  }
  let authorization = null
  if (existsSync(authorizationPath(repoDir))) {
    try {
      const auth = JSON.parse(readFileSync(authorizationPath(repoDir), 'utf8'))
      const problem =
        signatureProblem(auth, loadApproverPublicKey(home)) ??
        (c && (auth.mission_id !== c.contract.id || auth.contract_hash !== c.hash) ? 'authorization is for another mission or contract' : null) ??
        (Date.now() > Date.parse(auth.expires_at) ? 'authorization expired' : null) ??
        (chain.receipts.some((r) => r.kind === 'authorization_issued' && r.subject?.authorization_hash === hashValue(auth)) ? null : 'no authorization_issued receipt matches it')
      authorization = problem ? { valid: false, problem } : { valid: true, plan_id: auth.plan_id, expires_at: auth.expires_at, selection: auth.selection ?? null }
    } catch {
      authorization = { valid: false, problem: 'authorization file is unreadable' }
    }
  }
  return {
    exit: chain.ok ? EXIT.OK : EXIT.INTEGRITY,
    result: {
      mission_id: missionId,
      plan_id: id,
      rehearsal: report,
      authorization,
      chain_ok: chain.ok,
      chain_findings: chain.findings,
      receipts: counts,
      last_receipt: last ? { seq: last.seq, kind: last.kind, verdict: last.verdict, timestamp: last.timestamp } : null,
    },
  }
}

export function receiptCmd({ repoDir, opts }) {
  const { home, publicKey } = publicSide()
  const missionId = missionOf(repoDir, opts)
  const chain = verifyChain({ repoDir, home, publicKey, missionId })
  if (chain.receipts.length === 0) throw new CliError(EXIT.USAGE, 'NO_RECEIPTS', 'this mission has no receipts')
  const seq = opts.seq === undefined ? chain.receipts.length - 1 : Number(opts.seq)
  if (!Number.isInteger(seq) || seq < 0 || seq >= chain.receipts.length) throw new CliError(EXIT.USAGE, 'INVALID_SEQ', `seq must be between 0 and ${chain.receipts.length - 1}`)
  const r = chain.receipts[seq]
  return { exit: chain.ok ? EXIT.OK : EXIT.INTEGRITY, result: { chain_ok: chain.ok, hash: receiptHash(r), receipt: r } }
}

export function reanchorCmd({ repoDir, opts }) {
  const keys = operatorKeys()
  const missionId = missionOf(repoDir, opts)
  try {
    return { exit: EXIT.OK, result: reanchorChain({ repoDir, keys, missionId, reason: opts.reason }) }
  } catch (err) {
    if (err.code === 'CHAIN_LOCKED') throw err
    throw new CliError(EXIT.MAINTENANCE_REFUSED, 'REANCHOR_REFUSED', err.message)
  }
}

export function lockCmd({ repoDir, opts, action }) {
  const missionId = missionOf(repoDir, opts)
  if (action === 'inspect') return { exit: EXIT.OK, result: inspectChainLock({ repoDir, missionId }) }
  if (action !== 'recover') throw new CliError(EXIT.USAGE, 'USAGE', 'lock needs `inspect` or `recover`')
  const keys = operatorKeys()
  try {
    return { exit: EXIT.OK, result: recoverLock({ repoDir, keys, missionId, expectedSha256: opts.sha256, reason: opts.reason }) }
  } catch (err) {
    if (err.code === 'CHAIN_LOCKED') throw err
    throw new CliError(EXIT.MAINTENANCE_REFUSED, 'LOCK_RECOVERY_REFUSED', err.message)
  }
}

// ---- Approval (T23): what the operator sees and decides -------------------------------

function approvalRefusal(err) {
  if (err instanceof ApprovalError) return new CliError(EXIT.APPROVAL_REFUSED, err.code, err.message, err.detail)
  return err
}

function approvalContext(repoDir, opts) {
  const missionId = missionOf(repoDir, opts)
  const { home, publicKey } = publicSide()
  const chain = verifiedChain({ repoDir, home, publicKey, missionId })
  if (!chain.ok) throw new CliError(EXIT.APPROVAL_REFUSED, 'CHAIN_INVALID', `receipt chain does not verify: ${chain.findings[0].problem}`)
  return { missionId, home, publicKey, chain }
}

const MAX_SHOWN_SQL = 20000

/** Without an id: the requests of the mission. With an id: the whole request, the SQL that will run and the measured impact. */
export function approvalsCmd({ repoDir, opts, id }) {
  const ctx = approvalContext(repoDir, opts)
  if (id === undefined) return { exit: EXIT.OK, result: { mission_id: ctx.missionId, requests: listRequests({ repoDir, missionId: ctx.missionId, publicKey: ctx.publicKey, home: ctx.home }) } }
  let loaded
  try {
    loaded = loadRequest({ repoDir, missionId: ctx.missionId, id, publicKey: ctx.publicKey, receipts: ctx.chain.receipts })
  } catch (err) {
    throw approvalRefusal(err)
  }
  const { request, request_hash, receipt } = loaded
  let report = null
  try {
    const rep = loadReport(repoDir, ctx.missionId, request.plan_id)
    const problem = reportSignatureProblem(rep, ctx.publicKey) ?? (hashValue(rep) === request.report_hash ? null : 'the stored report is not the one this request is about')
    report = problem ? { valid: false, problem } : { valid: true, verdict: rep.verdict, rows_deleted: rep.rows_deleted, tables: rep.tables, evidence: rep.evidence, schema_delta: rep.schema_delta, steps: rep.steps.map((s) => ({ id: s.id, status: s.status })), conditions: rep.conditions }
  } catch {
    report = { valid: false, problem: 'the rehearsal report cannot be read' }
  }
  const files = request.files.map((f) => {
    let text = null
    let sha = null
    try {
      const abs = path.join(repoDir, f.path)
      sha = sha256File(abs)
      text = readFileSync(abs, 'utf8')
    } catch {
      // the file is gone: reported as not matching
    }
    return { path: f.path, sha256: f.sha256, matches_now: sha === f.sha256, sql: text === null ? null : text.length > MAX_SHOWN_SQL ? text.slice(0, MAX_SHOWN_SQL) + '\n-- (cut)' : text }
  })
  return {
    exit: EXIT.OK,
    result: {
      mission_id: ctx.missionId,
      request_id: request.request_id,
      plan_id: request.plan_id,
      state: requestState(request, receipt, ctx.chain.receipts),
      requested_at: request.requested_at,
      expires_at: request.expires_at,
      agent_note: request.agent_note,
      agent_note_is: 'written by the agent; not verified',
      files,
      report,
      request_hash,
      receipt_hash: receiptHash(receipt),
    },
  }
}

/**
 * Approve one request. Everything the request promised is checked again at this moment
 * from signed data; the approver key is decrypted last, by the human at this terminal.
 */
export async function approveCmd({ repoDir, opts, id }) {
  const ctx = approvalContext(repoDir, opts)
  let loaded
  try {
    loaded = loadRequest({ repoDir, missionId: ctx.missionId, id, publicKey: ctx.publicKey, receipts: ctx.chain.receipts })
  } catch (err) {
    throw approvalRefusal(err)
  }
  const { request, request_hash, receipt } = loaded
  const state = requestState(request, receipt, ctx.chain.receipts)
  if (state !== 'pending') throw new CliError(EXIT.APPROVAL_REFUSED, `REQUEST_${state.toUpperCase()}`, `this request is ${state}; only a pending request can be approved`)
  if (opts.confirm !== request.plan_id) throw new CliError(EXIT.USAGE, 'CONFIRMATION_REQUIRED', `approve needs --confirm ${request.plan_id} (the plan id of the request, typed again)`)
  const c = contractOf(repoDir, { plan: request.plan_id })
  if (c.hash !== request.contract_hash) throw new CliError(EXIT.APPROVAL_REFUSED, 'PLAN_CHANGED', 'the stored plan is not the one that was rehearsed and requested')
  const planFiles = c.contract.plan.map((s) => s.args[0])
  if (JSON.stringify(planFiles) !== JSON.stringify(request.files.map((f) => f.path))) throw new CliError(EXIT.APPROVAL_REFUSED, 'PLAN_CHANGED', 'the plan names other files than the request')
  const changed = request.files.filter((f) => {
    try {
      return sha256File(path.join(repoDir, f.path)) !== f.sha256
    } catch {
      return true
    }
  })
  if (changed.length > 0) throw new CliError(EXIT.APPROVAL_REFUSED, 'FILES_CHANGED', 'a migration file changed after it was requested; the agent must rehearse again', { files: changed.map((f) => f.path) })
  let report
  try {
    report = loadReport(repoDir, ctx.missionId, request.plan_id)
  } catch {
    throw new CliError(EXIT.APPROVAL_REFUSED, 'NO_REPORT', 'the rehearsal report cannot be read')
  }
  const problem = reportSignatureProblem(report, ctx.publicKey) ?? (hashValue(report) === request.report_hash ? null : 'the stored report is not the one this request is about')
  if (problem) throw new CliError(EXIT.APPROVAL_REFUSED, 'REPORT_INVALID', problem)
  if (report.verdict !== 'SAFE') throw new CliError(EXIT.APPROVAL_REFUSED, 'NOT_SAFE', `the rehearsal verdict is ${report.verdict}`)

  const keys = operatorKeys()
  const { target } = targetOf(repoDir)
  preflight(repoDir, ctx.missionId)
  const approver = await approverKey(opts, `Approver passphrase to approve ${request.request_id} (plan ${request.plan_id}): `)
  let auth
  try {
    auth = await authorizeMission({ repoDir, contract: c.contract, contractHash: c.hash, target, keys, approver, passphraseSource: approver.source, approval: { request_id: request.request_id, request_hash, receipt: receiptHash(receipt), files: request.files } })
  } catch (err) {
    if (err instanceof AuthorizationRefused) refused(EXIT.AUTHORIZATION_REFUSED, err)
    throw err
  }
  return { exit: EXIT.OK, result: { mission_id: auth.mission_id, request_id: request.request_id, plan_id: auth.plan_id, selection: auth.selection ?? null, expires_at: auth.expires_at, fingerprint_hash: auth.fingerprint_hash, files: request.files.map((f) => f.path), passphrase_source: approver.source } }
}

/** Deny one request. No passphrase: refusing needs no secret, and a denial cannot be turned into an approval. */
export function denyCmd({ repoDir, opts, id }) {
  const ctx = approvalContext(repoDir, opts)
  let loaded
  try {
    loaded = loadRequest({ repoDir, missionId: ctx.missionId, id, publicKey: ctx.publicKey, receipts: ctx.chain.receipts })
  } catch (err) {
    throw approvalRefusal(err)
  }
  const { request, receipt } = loaded
  const state = requestState(request, receipt, ctx.chain.receipts)
  if (state !== 'pending') throw new CliError(EXIT.APPROVAL_REFUSED, `REQUEST_${state.toUpperCase()}`, `this request is ${state}; only a pending request can be denied`)
  if (typeof opts.reason !== 'string' || opts.reason.trim().length < 3) throw new CliError(EXIT.USAGE, 'REASON_REQUIRED', 'deny needs --reason "<why>"')
  const keys = operatorKeys()
  preflight(repoDir, ctx.missionId)
  const written = appendReceipt({ repoDir, keys, missionId: ctx.missionId, kind: 'approval_denied', verdict: 'deny', subject: { request_id: request.request_id, plan_id: request.plan_id, reason: opts.reason.trim().slice(0, 300) }, refs: { approval: receiptHash(receipt) } })
  return { exit: EXIT.OK, result: { mission_id: ctx.missionId, request_id: request.request_id, plan_id: request.plan_id, denied: true, receipt_hash: written.hash } }
}
