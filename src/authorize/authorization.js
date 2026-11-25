/**
 * Run authorization: issue (operator side) and verify (hook and runner side).
 * R2.7, R3.2, R3.3, R3.6, R3.7.
 *
 * Issued only from a stored rehearsal report with verdict SAFE whose fingerprint
 * equals the current fingerprint. The result is signed with the approver's
 * Ed25519 key (src/receipts/approver.js), which lives outside the workspace and
 * is decrypted only by the human-run CLI, so a file written by the agent, or by
 * a process that holds only the operator key, cannot pass verification. It is
 * single-use: the runner consumes it.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { analyzeArgv } from '../hook/bypass.js'
import { hashScript } from '../hook/allowlist.js'
import { hashValue } from '../util/canonical.js'
import { publicKeyHex, signValue, verifyValue } from '../receipts/keys.js'
import { compareFingerprints } from '../fidelity/gate.js'

const SELF_REFERENCE = /(^|[\\/])(justrunme|src[\\/]cli|src[\\/]hook|src[\\/]authorize|src[\\/]mcp|src[\\/]mission|src[\\/]approval)([\\/.]|$)/i

export class AuthorizationRefused extends Error {
  /** @param {string} code @param {string} message @param {unknown} [detail] */
  constructor(code, message, detail) {
    super(message)
    this.code = code
    this.detail = detail
  }
}

/** Hook allowlist entries for the plan steps that Kiro itself will execute. */
export function entriesForPlan(plan, cwd) {
  const entries = []
  for (const step of plan) {
    if (step.tool !== 'shell') continue // sql_migration runs inside JustRunMe; others need approval
    if (step.args.some((a) => SELF_REFERENCE.test(a))) {
      throw new AuthorizationRefused('SELF_REFERENCE', `step ${step.id} invokes JustRunMe itself`)
    }
    const analysis = analyzeArgv(step.args)
    if (analysis.category) throw new AuthorizationRefused('UNBINDABLE_STEP', `step ${step.id}: ${analysis.detail}`)
    const script_hashes = {}
    for (const script of analysis.scripts) {
      const h = hashScript(script, cwd)
      if (h === null) throw new AuthorizationRefused('UNBINDABLE_STEP', `step ${step.id}: script ${script} missing or outside the workspace`)
      script_hashes[script] = h
    }
    entries.push({ step_id: step.id, action: { tool: 'shell', argv: step.args }, script_hashes })
  }
  return entries
}

// Same form as the file hashes in an approval request (src/approval/requests.js).
const fileDigest = (bytes) => 'sha256:' + createHash('sha256').update(bytes).digest('hex')

/**
 * SHA-256 of every SQL file the plan will run, as it is now. The authorization
 * carries these and the runner hashes the files again right before executing, so
 * a file edited after approval (also one git ignores, which the fingerprint does
 * not see) stops the run.
 * @returns {{ path: string, sha256: string }[]}
 */
export function planFileHashes(plan, cwd) {
  const files = []
  for (const step of plan) {
    if (step.tool !== 'sql_migration') continue
    const rel = step.args[0]
    let bytes
    try {
      bytes = readFileSync(path.join(cwd, rel))
    } catch {
      throw new AuthorizationRefused('UNBINDABLE_STEP', `step ${step.id}: ${rel} cannot be read`)
    }
    files.push({ path: rel, sha256: fileDigest(bytes) })
  }
  return files
}

/** Names of the plan files whose content differs from `expected` now (or that are gone). */
export function changedPlanFiles(expected, cwd) {
  return expected
    .filter((f) => {
      try {
        return fileDigest(readFileSync(path.join(cwd, f.path))) !== f.sha256
      } catch {
        return true
      }
    })
    .map((f) => f.path)
}

/**
 * @param {object} a
 * @param {string} a.cwd workspace root
 * @param {any} a.contract
 * @param {string} a.contractHash
 * @param {any} a.report stored rehearsal report
 * @param {any} a.currentFingerprint freshly measured
 * @param {{ privateKey: any, publicKey: any }} a.keys
 * @param {number} a.now
 * @param {number} [a.ttlSeconds]
 */
export function issueAuthorization({ cwd, contract, contractHash, report, currentFingerprint, approver, now, ttlSeconds, selection = null, approval = null }) {
  if (!approver?.privateKey || !approver?.publicKey) throw new AuthorizationRefused('NO_APPROVER_KEY', 'an authorization is signed by the approver key; none was given')
  if (!report || report.mission_id !== contract.id) throw new AuthorizationRefused('NO_REHEARSAL', 'no rehearsal report for this mission')
  if (report.contract_hash !== contractHash) throw new AuthorizationRefused('CONTRACT_CHANGED', 'contract changed after rehearsal')
  if (report.verdict !== 'SAFE') {
    const code = { 'THRESHOLD EXCEEDED': 'THRESHOLD_EXCEEDED', 'DATA LOSS': 'DATA_LOSS', 'LOGIC CHANGE': 'LOGIC_CHANGE', 'LOGIC BYPASS': 'LOGIC_BYPASS', UNVERIFIABLE: 'UNVERIFIABLE', 'INVARIANT VIOLATED': 'INVARIANT_VIOLATED', 'REQUIREMENT UNMET': 'REQUIREMENT_UNMET' }[report.verdict] ?? 'NOT_SAFE'
    throw new AuthorizationRefused(code, `rehearsal verdict is ${report.verdict}`, report.evidence)
  }
  const fidelity = compareFingerprints(report.fingerprint, currentFingerprint)
  if (!fidelity.ok) throw new AuthorizationRefused('FIDELITY_MISMATCH', 'source state changed since rehearsal', fidelity.diffs)

  const ttl = Math.min(ttlSeconds ?? contract.time_limit_seconds, contract.time_limit_seconds)
  const planFiles = planFileHashes(contract.plan, cwd)
  // Answering a request: the files must still be the ones the operator was shown.
  if (approval?.files && JSON.stringify(approval.files) !== JSON.stringify(planFiles)) {
    throw new AuthorizationRefused('FILES_CHANGED', 'a migration file changed after it was requested', { files: changedPlanFiles(approval.files, cwd) })
  }
  const body = {
    version: 1,
    mission_id: contract.id,
    contract_hash: contractHash,
    plan_id: report.plan_id,
    fingerprint_hash: hashValue(currentFingerprint),
    source_state_hash: hashValue(currentFingerprint.plan.source),
    issued_at: new Date(now).toISOString(),
    expires_at: new Date(now + ttl * 1000).toISOString(),
    entries: entriesForPlan(contract.plan, cwd),
    plan_files: planFiles,
    // How the plan was chosen (T17): 'selected' names the plan_selected receipt.
    ...(selection ? { selection } : {}),
    // The approval request this authorization answers (T23), when there was one.
    ...(approval ? { approval: { request_id: approval.request_id, request_hash: approval.request_hash } } : {}),
    approver_pubkey: publicKeyHex(approver.publicKey),
  }
  return { ...body, signature: signValue(approver.privateKey, body) }
}

/**
 * @returns {string | null} problem, or null when the signature is valid for publicKey
 */
export function signatureProblem(auth, publicKey) {
  if (!publicKey) return 'no approver public key is installed'
  if (!auth || typeof auth !== 'object') return 'authorization is malformed'
  const { signature, ...body } = auth
  if (body.approver_pubkey !== publicKeyHex(publicKey)) return 'authorization was not signed by the installed approver key'
  if (!verifyValue(publicKey, body, signature)) return 'authorization signature is invalid'
  return null
}
