/**
 * What an agent is told about a rehearsal (T22, R2.7): a machine-readable
 * outcome built only from the signed report, so every number in it was measured
 * in the disposable database copy.
 *
 * Wording policy. The constraints name what was measured and what any revised
 * plan has to leave intact. They are requirements, not a diagnosis of the SQL and
 * not a promise: whether a revised plan is safe is known only after it has been
 * rehearsed again. Nothing here says that a plan "will be" safe.
 */

export const ATTEMPT_LIMIT = 8

const REASON = Object.freeze({ 'THRESHOLD EXCEEDED': 'THRESHOLD_EXCEEDED', 'DATA LOSS': 'DATA_LOSS', 'LOGIC CHANGE': 'LOGIC_CHANGE', 'LOGIC BYPASS': 'LOGIC_BYPASS', UNVERIFIABLE: 'UNVERIFIABLE', 'INVARIANT VIOLATED': 'INVARIANT_VIOLATED', 'REQUIREMENT UNMET': 'REQUIREMENT_UNMET' })
const RULE = Object.freeze({ 'THRESHOLD EXCEEDED': 'R6.2', 'DATA LOSS': 'R2.6', 'LOGIC CHANGE': 'T25.1', 'LOGIC BYPASS': 'T25.2', UNVERIFIABLE: 'T25.2', 'INVARIANT VIOLATED': 'T25.3', 'REQUIREMENT UNMET': 'T25.3' })

const NEXT = Object.freeze({
  'THRESHOLD EXCEEDED': 'REVISE_AND_REHEARSE',
  SAFE: 'REQUEST_APPROVAL',
  'DATA LOSS': 'REVISE_AND_REHEARSE',
  'LOGIC CHANGE': 'REVISE_AND_REHEARSE',
  'LOGIC BYPASS': 'REVISE_AND_REHEARSE',
  'INVARIANT VIOLATED': 'REVISE_AND_REHEARSE',
  'REQUIREMENT UNMET': 'REVISE_AND_REHEARSE',
  UNVERIFIABLE: 'ASK_OPERATOR',
  FAILED: 'FIX_AND_REHEARSE',
  LIMIT: 'ASK_OPERATOR',
})

function constraintsFor(evidence, failedSteps) {
  const out = []
  for (const e of evidence) {
    if (e.kind === 'protected_rows_lost') {
      out.push({ kind: 'rows_preserved', table: e.table, measured: { rows_before: e.rows_before, rows_after: e.rows_after }, text: `Every existing row of ${e.table} must still exist after the plan (measured ${e.rows_before} rows before, ${e.rows_after} after).` })
    } else if (e.kind === 'table_removed') {
      out.push({ kind: 'table_preserved', table: e.table, measured: { rows_before: e.rows_before }, text: `Table ${e.table} must still exist after the plan (it had ${e.rows_before} rows and was gone afterwards).` })
    } else if (e.kind === 'column_removed') {
      out.push({ kind: 'column_preserved', column: e.column, measured: {}, text: `Column ${e.column} must still exist after the plan.` })
    } else if (e.kind === 'logic_removed') {
      out.push({ kind: 'logic_preserved', object: e.object, measured: {}, text: `The existing ${e.object} must still exist after the plan.` })
    } else if (e.kind === 'logic_changed') {
      out.push({ kind: 'logic_unchanged', object: e.object, measured: {}, text: `The existing ${e.object} must have the same definition, and a trigger must be enabled, after the plan.` })
    } else if (e.kind === 'protected_rows_replaced') {
      out.push({ kind: 'rows_preserved', table: e.table, measured: { missing: e.missing }, text: `Every existing row of ${e.table} must still exist after the plan; ${e.missing} existing row(s) were removed (rows inserted in their place do not count).` })
    } else if (e.kind === 'protected_rows_deleted') {
      out.push({ kind: 'rows_not_deleted', table: e.table, measured: { rows: e.rows }, text: `Existing rows of ${e.table} must not be deleted at any point during the plan; ${e.rows} existing row(s) were deleted (rows inserted again later do not undo this).` })
    } else if (e.kind === 'trigger_fired') {
      out.push({ kind: 'logic_fired', object: e.trigger, measured: { table: e.table, timing: e.timing, event: e.event, level: e.level, fired: e.fired }, text: `While the plan ran, the existing trigger ${e.trigger} on ${e.table} (${e.timing ?? 'unknown timing'} ${e.event ?? 'unknown event'}, per ${String(e.level).toLowerCase()}) fired ${e.fired} time(s).` })
    } else if (e.kind === 'trigger_not_fired') {
      out.push({ kind: 'logic_must_act', object: e.trigger, measured: { expected: e.expected, fired: e.fired }, text: `The existing trigger ${e.trigger} must act on every row it applies to (it should have fired ${e.expected} time(s) and fired ${e.fired}); do not switch it off, skip it or work around it.` })
    } else if (e.kind === 'bypass_statement' || e.kind === 'bypass_ddl' || e.kind === 'bypass_meta_command') {
      out.push({ kind: 'no_bypass', measured: { what: e.what }, text: `The plan must not do this to the database's logic: it ${e.what}.` })
    } else if (e.kind === 'bypass_attempt_refused') {
      out.push({ kind: 'no_bypass', measured: { error: e.error }, text: 'The plan tried something its role may not do (refused by the database); remove it. The plan runs with the rights of an application, not of the owner.' })
    } else if (e.kind === 'observers_switched_off') {
      out.push({ kind: 'no_bypass', measured: { what: e.what }, text: 'The plan switched off triggers or settings that act on every change; remove that.' })
    } else if (e.kind === 'invariant_violated') {
      out.push({ kind: 'invariant_holds', invariant: e.index, measured: { rows: e.rows }, text: `Invariant ${e.index} of the mission must hold after the plan${e.text ? ` ("${e.text}")` : ''}; it fails on ${e.rows} row(s).` })
    } else if (e.kind === 'requirement_unmet') {
      out.push({ kind: 'requirement_met', requirement: e.index, measured: { rows: e.rows, done: e.done }, text: `Required change ${e.index} of the mission must be made: ${e.table} ${JSON.stringify(e.where)} set ${JSON.stringify(e.set)} (done on ${e.done} of ${e.rows} row(s)).` })
    } else if (e.kind === 'unverifiable') {
      out.push({ kind: 'verifiable', measured: {}, text: `This rehearsal could not be verified: ${e.why}.` })
    } else if (e.kind === 'rehearsal_error') {
      out.push({ kind: 'rehearsal_must_complete', measured: {}, text: 'The rehearsal itself did not complete; the plan could not be measured.' })
    }
  }
  for (const s of failedSteps) out.push({ kind: 'step_must_succeed', step: s.id, measured: { status: s.status }, text: `Step ${s.id} did not complete (${s.status}${s.detail ? `: ${s.detail}` : ''}); fix it so that it applies without error.` })
  return out
}

// What leaves the rehearsal copy for the agent is narrowed (the copy holds real data and
// the agent wrote the SQL that runs in it): error text is cut to its first line, and the
// name of an object the plan created is shown only if the plan's own SQL text contains it.
// A name built from data at run time (dynamic SQL) is counted, not shown. This narrows
// the channels; it does not close them (README, limits).
const MAX_DETAIL = 160
const firstLine = (s) => String(s ?? '').split('\n')[0].slice(0, MAX_DETAIL)

/**
 * @param {any} report signed rehearsal report (already verified by the caller)
 * @param {{ used: number, limit?: number }} attempts rehearsals since the last run or authorization
 * @param {{ sqlText?: string | null }} [view] text of the plan's SQL files; null means show no new names
 */
export function explainReport(report, attempts, { sqlText = null } = {}) {
  const limit = attempts.limit ?? ATTEMPT_LIMIT
  const exhausted = attempts.used >= limit && report.verdict !== 'SAFE'
  const haystack = String(sqlText ?? '').toLowerCase()
  const literal = (name) => haystack.includes(String(name).toLowerCase())
  const hidden = new Set()
  const entries = Object.entries(report.tables ?? {}).filter(([t, v]) => {
    const isNew = v.rows_before === null
    if (isNew && !literal(t)) {
      hidden.add(t)
      return false
    }
    return true
  })
  const tables = Object.fromEntries(entries.map(([t, v]) => [t, { protected: v.protected, rows_before: v.rows_before, rows_after: v.rows_after, rows_lost: v.rows_lost, content_changed: v.content_changed }]))
  const shown = (list) => (list ?? []).filter((name) => {
    const ok = literal(String(name).split('.').pop())
    if (!ok) hidden.add(String(name))
    return ok
  })
  const schemaDelta = report.schema_delta
    ? {
        ...report.schema_delta,
        added_tables: shown(report.schema_delta.added_tables),
        added_columns: shown(report.schema_delta.added_columns),
        ...(report.schema_delta.added_logic ? { added_logic: shown(report.schema_delta.added_logic.map((o) => o.replace(/\(.*$/, ''))) } : {}),
      }
    : null
  const evidence = (report.evidence ?? []).map((e) => (e.detail === undefined ? e : { ...e, detail: firstLine(e.detail) }))
  const failedSteps = (report.steps ?? []).filter((s) => s.status !== 'ok').map((s) => ({ id: s.id, status: s.status, detail: firstLine(s.detail) }))
  const safe = report.verdict === 'SAFE'
  return {
    status: safe ? 'SAFE' : 'DENIED',
    verdict: report.verdict,
    reason: safe ? null : REASON[report.verdict] ?? 'REHEARSAL_FAILED',
    rule: safe ? null : RULE[report.verdict] ?? 'R2.5',
    plan_id: report.plan_id,
    base_hash: report.base_hash,
    measured_in: 'a disposable copy of the database, started for this rehearsal and removed afterwards',
    impact: {
      rows_lost: Object.fromEntries(Object.entries(tables).filter(([, v]) => v.protected).map(([t, v]) => [t, v.rows_lost])),
      tables,
      schema_delta: schemaDelta,
      evidence,
      failed_steps: failedSteps,
      threshold_breaches: report.threshold_breaches ?? [],
      unnamed_new_objects: hidden.size,
    },
    remediation: safe
      ? null
      : {
          aim:
            report.verdict === 'DATA LOSS'
              ? 'Revise the plan so that it destroys no data, then rehearse the revision.'
              : report.verdict === 'LOGIC CHANGE'
                ? 'Revise the plan so that it keeps the existing database logic (triggers, rules, functions) as it is, then rehearse the revision.'
                : report.verdict === 'LOGIC BYPASS'
                  ? 'Revise the plan so that the existing database logic stays active and acts: no trigger, rule, constraint or setting switched off, skipped or replaced, not even for one statement.'
                  : report.verdict === 'INVARIANT VIOLATED' || report.verdict === 'REQUIREMENT UNMET'
                    ? 'Revise the plan so that it makes the required change and every invariant of the mission holds, then rehearse the revision.'
                  : report.verdict === 'UNVERIFIABLE'
                    ? 'This rehearsal cannot be trusted; ask the operator.'
                    : report.verdict === 'THRESHOLD EXCEEDED'
                      ? 'Reduce the row loss to the configured limit and rehearse again.'
                      : 'Make the plan apply cleanly, then rehearse it again.',
          constraints: constraintsFor(evidence, failedSteps),
          next_action: exhausted ? NEXT.LIMIT : NEXT[report.verdict] ?? NEXT.FAILED,
          caution: 'These are measurements of the plan just rehearsed, not a proof that a revised plan is safe. Only a new rehearsal with verdict SAFE shows that.',
        },
    next_action: exhausted ? NEXT.LIMIT : NEXT[report.verdict] ?? NEXT.FAILED,
    attempts: { used: attempts.used, limit },
  }
}
