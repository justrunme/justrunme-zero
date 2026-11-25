/**
 * The judge scenario (T19): Rehearse -> Detect -> DENY -> Replan -> ALLOW -> Run ->
 * Undo -> Verify, then the same chain checked offline and shown to reject tampering.
 *
 * The scenario talks only to a backend (src/judge/env.js builds the real one on
 * Docker; tests pass a fake). Every action goes through the CLI, so the judge has
 * no path around the fidelity gate, the selection gate or the receipt chain.
 *
 * Hidden-trigger case (opt-in, `justrunme judge --hidden-trigger`): the scenario adds
 * the case from the recorded run. The statement is innocent
 * (UPDATE patches SET available_count = 0), a trigger of the database deletes orders,
 * and the rehearsal has to measure that on a real Postgres. Without the option the
 * default steps run unchanged and the backend is never asked to install the trigger.
 * With the option and a backend that cannot install it, the run fails closed.
 *
 * backend: {
 *   cli(args) -> { exit, out }              run `justrunme <args>` against the demo workspace
 *   offlineCli(args) -> { exit, out }       same, with no Docker and no PATH
 *   useMigration('dangerous'|'safe')        write the migration and the contract that names it
 *   measure() -> { tables, columns }        read the demo database directly
 *   stopStack() -> Promise                  remove the demo containers
 *   corruptChain() / restoreChain()         flip one byte of the receipt chain, and put it back
 *   readReceipts() -> { publicKey, receipts }
 *   installHiddenTrigger() -> Promise       (needed only for the hidden-trigger option) add order status, cancel_patch_orders() and the trigger
 *   useMigration('hidden_dangerous'|'hidden_safe')   the two plans of that case (hidden-trigger option only)
 * }
 */

import { performance } from 'node:perf_hooks'
import { skippedStep, stepResult } from './report.js'

const hasStatus = (m) => (m.columns.orders ?? []).some((c) => c.startsWith('status '))
// Rows and checksums per table, and the schema hash (columns, types, defaults).
const sameData = (a, b) => JSON.stringify(a.tables) === JSON.stringify(b.tables) && a.schema_hash === b.schema_hash

export const STEPS = [
  ['keys', 'Create a throwaway operator key'],
  ['approver', 'Create a throwaway approver key (the demo approves with it by itself; a real approval is a person typing a passphrase)'],
  ['rehearse_dangerous', 'Rehearse the dangerous plan on a disposable copy'],
  ['deny', 'Authorization of the dangerous plan is denied'],
  ['rehearse_safe', 'Rehearse the safe alternative on the same base'],
  ['compare', 'Compare both rehearsals; the safe plan is recommended'],
  ['allow', 'Authorize the selected safe plan'],
  ['run', 'Run the safe plan on the real database'],
  ['undo', 'Undo the run and verify the recovery'],
  ['verify', 'Verify the receipt chain, policy and selection'],
  ['replay', 'Replay the recorded selection'],
  ['offline_verify', 'Verify again with the containers gone and no Docker on the path'],
  ['tamper_detected', 'A one-byte change to the chain is detected'],
  ['tamper_restored', 'Putting the byte back makes the chain verify again'],
]

export const HIDDEN_STEPS = [
  ['hidden_rehearse_dangerous', 'Rehearse an innocent-looking UPDATE whose hidden trigger deletes orders'],
  ['hidden_deny', 'Authorization of the hidden-trigger plan is denied'],
  ['hidden_rehearse_safe', 'Rehearse the safe alternative (cancel the open orders, then update)'],
  ['hidden_compare', 'Compare both rehearsals; the safe alternative is recommended'],
  ['hidden_allow', 'Authorize the selected safe alternative'],
  ['hidden_run', 'Run the safe alternative on the real database'],
  ['hidden_undo', 'Undo the run and verify the recovery'],
]

/** The steps of one run, in order: the hidden-trigger case follows the first undo. */
export function stepsFor(withHidden) {
  if (!withHidden) return STEPS
  const at = STEPS.findIndex(([id]) => id === 'undo') + 1
  return [...STEPS.slice(0, at), ...HIDDEN_STEPS, ...STEPS.slice(at)]
}

const ordersEvidence = (r) => (r.evidence ?? []).find((e) => e.kind === 'protected_rows_lost' && e.table === 'orders') ?? null

/** @returns {Promise<{ stepResults: object[], story: object, offline: object|null, receipts: object[], publicKey: string|null }>} */
export async function runScenario(backend, { hiddenTrigger = false } = {}) {
  const results = new Map()
  const story = {}
  let offline = null
  let failed = false
  const state = {}
  const withHidden = hiddenTrigger === true
  const allSteps = stepsFor(withHidden)

  const step = async (id, expectedExit, args, checks, { offlineRun = false } = {}) => {
    const title = allSteps.find(([i]) => i === id)[1]
    if (failed) return results.set(id, skippedStep(id, title))
    let observed
    const t0 = performance.now()
    try {
      const r = await (offlineRun ? backend.offlineCli(args) : backend.cli(args))
      observed = { exit: r.exit, code: r.out?.error?.code ?? null, out: r.out }
    } catch (err) {
      observed = { exit: null, code: 'JUDGE_STEP_ERROR', out: { error: { message: String(err?.message ?? err) } } }
    }
    let list = []
    try {
      list = await checks(observed.out?.result ?? {}, observed)
    } catch (err) {
      list = [{ name: 'checks could be evaluated', ok: false, actual: String(err?.message ?? err) }]
    }
    const r = { ...stepResult({ id, title, expectedExit, observed, checks: list }), duration_ms: Math.round(performance.now() - t0) }
    if (r.status === 'failed') failed = true
    results.set(id, r)
  }
  const c = (name, ok, actual) => ({ name, ok: Boolean(ok), ...(actual !== undefined ? { actual } : {}) })
  // A backend call outside a step (writing a file, stopping the stack) that throws
  // fails the run like a failed step: the report is still produced, the rest is skipped.
  const guarded = async (name, fn) => {
    try {
      return await fn()
    } catch (err) {
      failed = true
      story.error = { during: name, message: String(err?.message ?? err) }
      return undefined
    }
  }

  async function hiddenTriggerCase() {
    await guarded('install the hidden trigger', () => backend.installHiddenTrigger())
    state.hidden = { before: failed ? null : await guarded('measure before (hidden trigger)', () => backend.measure()) }
    const h = (story.hidden_trigger = {
      trigger: 'patches_release_sold_out',
      statement: 'UPDATE patches SET available_count = 0 WHERE id = 1',
      orders_in_real_database: state.hidden.before?.tables.orders?.rows ?? null,
    })
    await guarded('write the hidden-trigger plan', () => backend.useMigration('hidden_dangerous'))
    await step('hidden_rehearse_dangerous', 10, ['rehearse'], async (r) => {
      const lost = ordersEvidence(r)
      const fired = (r.evidence ?? []).find((e) => e.kind === 'trigger_fired') ?? null
      const missingOrder = (r.evidence ?? []).some((e) =>
        e.kind === 'requirement_unmet' && e.table === 'orders' && e.where?.id === 2 && e.rows === 0)
      h.dangerous = { order_2_missing: missingOrder, verdict: r.verdict, rows_lost: r.rows_lost, orders_before: lost?.rows_before ?? null, orders_after: lost?.rows_after ?? null, trigger_fired: fired }
      state.hiddenDangerous = r.plan_id
      state.hiddenBase = r.base_hash
      return [
        c('verdict is DATA LOSS', r.verdict === 'DATA LOSS', r.verdict),
        c('order #2 is missing in the rehearsal copy', missingOrder),
        c('orders lost were measured (fewer after than before)', lost !== null && lost.rows_after < lost.rows_before, lost),
        c('the measured start equals the orders of the real database', lost?.rows_before === state.hidden.before?.tables.orders?.rows, lost?.rows_before),
        c('the trigger that fired is named', fired !== null && JSON.stringify(fired).includes('patches_release_sold_out'), fired),
        c('the real database was not touched', sameData(await backend.measure(), state.hidden.before)),
      ]
    })
    await step('hidden_deny', 21, ['authorize'], (r, o) => {
      h.denied = { error: o.out?.error?.code ?? null }
      return [c('refused for DATA_LOSS', o.code === 'DATA_LOSS', o.code)]
    })
    await guarded('write the safe alternative', () => backend.useMigration('hidden_safe'))
    await step('hidden_rehearse_safe', 0, ['rehearse'], (r) => {
      const orders = (r.rows_lost ?? {}).orders
      h.safe = { verdict: r.verdict, rows_lost: r.rows_lost }
      state.hiddenSafe = r.plan_id
      return [
        c('verdict is SAFE', r.verdict === 'SAFE', r.verdict),
        c('0 orders lost, measured', orders === 0, r.rows_lost),
        c('same base as the hidden-trigger plan', typeof r.base_hash === 'string' && r.base_hash === state.hiddenBase),
        c('a different plan', typeof r.plan_id === 'string' && r.plan_id !== state.hiddenDangerous),
      ]
    })
    await step('hidden_compare', 0, ['compare'], (r) => {
      h.selection = { recommended: r.recommended, decided_by: r.decided_by }
      return [c('the safe alternative is recommended', r.recommended === state.hiddenSafe), c('decided by R15.4.1', r.decided_by === 'R15.4.1', r.decided_by)]
    })
    await step('hidden_allow', 0, ['authorize'], (r) => {
      h.allowed = { plan_id: r.plan_id, selection_mode: r.selection?.mode ?? null }
      return [c('the selected plan is authorized', r.plan_id === state.hiddenSafe), c('authorization follows the signed selection', r.selection?.mode === 'selected', r.selection?.mode)]
    })
    await step('hidden_run', 0, ['run'], async (r) => {
      const after = await backend.measure()
      state.hiddenCapture = r.capture_id
      h.run = { ok: r.ok, order_2_status: await backend.readOrderTwoStatus(), orders_after: after.tables.orders?.rows ?? null, patches_changed: after.tables.patches?.checksum !== state.hidden.before?.tables.patches?.checksum }
      return [
        c('the run succeeded', r.ok === true),
        c('order #2 exists and was cancelled', h.run.order_2_status === 'cancelled', h.run.order_2_status),
        c('every order of the real database survived', after.tables.orders?.rows === state.hidden.before?.tables.orders?.rows, after.tables.orders?.rows),
        c('the patch row was updated', h.run.patches_changed),
      ]
    })
    await step('hidden_undo', 0, ['undo', state.hiddenCapture ?? 'cap-00000000000000-000000'], async (r) => {
      const after = await backend.measure()
      h.undo = { status: r.status, evidence_status: r.evidence_status, verification: r.verification?.status ?? null }
      return [
        c('status is RECOVERED', r.status === 'RECOVERED', r.status),
        c('recovery was verified', r.verification?.status === 'PASS', r.verification?.status),
        c('evidence is recorded in the chain', r.evidence_status === 'recorded', r.evidence_status),
        c('the database equals its state before the run', sameData(after, state.hidden.before)),
      ]
    })
  }

  await step('keys', 0, ['keys', 'init'], (r) => [c('a public key was created', typeof r.public_key === 'string')])
  await step('approver', 0, ['approver', 'init'], (r) => [c('an approver public key was created', /^[0-9a-f]{64}$/.test(r.approver_public_key ?? ''))])
  if (!failed) state.before = await guarded('measure before', () => backend.measure())

  await guarded('write dangerous migration', () => backend.useMigration('dangerous'))
  await step('rehearse_dangerous', 10, ['rehearse'], async (r) => {
    story.dangerous = { verdict: r.verdict, rows_lost: r.rows_lost, schema_delta: r.schema_delta ?? null }
    state.dangerousPlan = r.plan_id
    state.base = r.base_hash
    return [
      c('verdict is DATA LOSS', r.verdict === 'DATA LOSS', r.verdict),
      c('rows lost were measured, not assumed', Object.values(r.rows_lost ?? {}).some((n) => n > 0), r.rows_lost),
      c('the real database was not touched', sameData(await backend.measure(), state.before)),
    ]
  })
  await step('deny', 21, ['authorize'], (r, o) => {
    story.denied = { error: o.out?.error?.code ?? null }
    return [c('refused for DATA_LOSS', o.code === 'DATA_LOSS', o.code)]
  })

  await guarded('write safe migration', () => backend.useMigration('safe'))
  await step('rehearse_safe', 0, ['rehearse'], (r) => {
    story.safe = { verdict: r.verdict, rows_lost: r.rows_lost, schema_delta: r.schema_delta ?? null }
    state.safePlan = r.plan_id
    return [
      c('verdict is SAFE', r.verdict === 'SAFE', r.verdict),
      c('same base as the dangerous plan', typeof r.base_hash === 'string' && r.base_hash === state.base),
      c('a different plan', typeof r.plan_id === 'string' && r.plan_id !== state.dangerousPlan),
    ]
  })
  await step('compare', 0, ['compare'], (r) => {
    story.selection = { recommended: r.recommended, decided_by: r.decided_by, removed: r.removed }
    return [c('the safe plan is recommended', r.recommended === state.safePlan), c('decided by R15.4.1 (data loss removes a plan)', r.decided_by === 'R15.4.1', r.decided_by)]
  })
  await step('allow', 0, ['authorize'], (r) => {
    story.allowed = { plan_id: r.plan_id, selection_mode: r.selection?.mode ?? null }
    return [c('the selected plan is authorized', r.plan_id === state.safePlan), c('authorization follows the signed selection', r.selection?.mode === 'selected', r.selection?.mode)]
  })
  await step('run', 0, ['run'], async (r) => {
    const after = await backend.measure()
    state.capture = r.capture_id
    story.run = { ok: r.ok, steps: r.steps?.length ?? null, status_column_added: hasStatus(after) }
    return [c('the run succeeded', r.ok === true), c('the migration is visible in the real database', hasStatus(after)), c('no rows were lost', JSON.stringify(after.tables.orders?.rows) === JSON.stringify(state.before.tables.orders?.rows))]
  })
  await step('undo', 0, ['undo', state.capture ?? 'cap-00000000000000-000000'], async (r) => {
    const after = await backend.measure()
    story.undo = { status: r.status, evidence_status: r.evidence_status, verification: r.verification?.status ?? null }
    return [
      c('status is RECOVERED', r.status === 'RECOVERED', r.status),
      c('recovery was verified', r.verification?.status === 'PASS', r.verification?.status),
      c('evidence is recorded in the chain', r.evidence_status === 'recorded', r.evidence_status),
      c('the database equals its state before the run', sameData(after, state.before) && !hasStatus(after)),
    ]
  })
  if (withHidden) await hiddenTriggerCase()
  await step('verify', 0, ['verify'], (r) => [c('chain, policy and selection check out', r.ok === true), c('a receipt exists for every decision', (r.receipts ?? 0) >= 8, r.receipts)])
  await step('replay', 0, ['replay'], (r) => [c('the selection replays', r.ok === true)])

  if (!failed) await guarded('stop the containers', () => backend.stopStack())
  await step('offline_verify', 0, ['verify'], (r) => {
    offline = { receipts: r.receipts ?? 0, chain_findings: (r.chain_findings ?? []).length, policy_findings: (r.policy_findings ?? []).length }
    return [c('chain verifies without Docker', r.ok === true), c('no chain findings', offline.chain_findings === 0), c('no policy violations', offline.policy_findings === 0)]
  }, { offlineRun: true })

  if (!failed) await guarded('change one byte of the chain', () => backend.corruptChain())
  await step('tamper_detected', 30, ['verify'], (r) => [c('the chain is reported not ok', r.ok === false), c('with a named finding', (r.chain_findings ?? []).length > 0 && typeof r.chain_findings[0].problem === 'string')], { offlineRun: true })
  await guarded('restore the chain', () => backend.restoreChain())
  await step('tamper_restored', 0, ['verify'], (r) => [c('the chain verifies again', r.ok === true)], { offlineRun: true })

  const { publicKey, receipts } = (await guarded('read the receipts', () => backend.readReceipts())) ?? { publicKey: null, receipts: [] }
  return { stepResults: allSteps.map(([id, title]) => results.get(id) ?? skippedStep(id, title)), story, offline, receipts, publicKey }
}
