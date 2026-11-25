/**
 * Impact report and verdict from measured before/after database state (R2.3, R2.6, R6.2).
 *
 * Pure function of the measurements. Verdict rules, in order:
 *   LOGIC BYPASS  the rehearsal observers (observe.js) saw a trigger, rule, constraint or
 *                 setting switched off, skipped or replaced, even if undone inside the plan,
 *                 or a refused attempt (permission error of the plan role); allowed_logic_changes
 *                 does not exempt a bypass
 *   UNVERIFIABLE  the observers or the plan role cannot be trusted for this rehearsal
 *   FAILED     a rehearsed step did not complete
 *   DATA LOSS  a table or a column disappeared, or a protected table lost rows, or a row that
 *              existed before the plan was deleted during it (also if inserted again); the
 *              evidence then names the existing triggers that fired (trigger_fired)
 *   LOGIC CHANGE  after the plan, an existing trigger, rule or function is gone, redefined,
 *                 or (a trigger) left switched off, and the contract's allowed_logic_changes
 *                 does not name it. A trigger switched off and on again inside the plan, or
 *                 skipped with session_replication_role, leaves no trace here (measure.js).
 *   INVARIANT VIOLATED  an invariant of the mission (src/mission/requirements.js) does not hold
 *   REQUIREMENT UNMET   a required change of the mission was not made
 *   THRESHOLD EXCEEDED  the measured row deletions exceed max_rows_deleted
 *   SAFE       otherwise
 */

import { logicDelta } from './measure.js'

/**
 * @param {object} a
 * @param {{ tables: Record<string, {rows: number, checksum: string}>, columns: Record<string, string[]>, schema_hash: string }} a.before
 * @param {typeof a.before} a.after
 * @param {string[]} a.protectedTables
 * @param {{ id: string, status: string }[]} a.steps
 * @param {{ max_rows_deleted?: number }} [a.thresholds]
 * @param {string[]} [a.allowedLogicChanges] entries like "trigger public.patches.name" the operator allows to change
 * @param {{ evidence: object[], unverifiable: string[] } | null} [a.bypass] observer findings (null: no observers)
 */
export function buildImpact({ before, after, protectedTables, steps, thresholds = {}, allowedLogicChanges = [], bypass = null, requirements = null }) {
  const names = [...new Set([...Object.keys(before.tables), ...Object.keys(after.tables)])].sort()
  const tables = {}
  const removedTables = []
  const addedTables = []
  const removedColumns = []
  const addedColumns = []
  let rowsDeleted = 0

  for (const t of names) {
    const b = before.tables[t]
    const a = after.tables[t]
    if (b && !a) removedTables.push(t)
    if (!b && a) addedTables.push(t)
    const rowsBefore = b ? b.rows : 0
    const rowsAfter = a ? a.rows : 0
    const lost = Math.max(0, rowsBefore - rowsAfter)
    rowsDeleted += lost
    tables[t] = {
      rows_before: b ? b.rows : null,
      rows_after: a ? a.rows : null,
      rows_lost: lost,
      content_changed: Boolean(b && a && b.checksum !== a.checksum),
      protected: protectedTables.includes(t),
    }
    const colName = (c) => c.split(' ')[0]
    const bc = (before.columns[t] ?? []).map(colName)
    const ac = (after.columns[t] ?? []).map(colName)
    if (b && a) {
      for (const c of bc) if (!ac.includes(c)) removedColumns.push(`${t}.${c}`)
      for (const c of ac) if (!bc.includes(c)) addedColumns.push(`${t}.${c}`)
    }
  }

  const evidence = []
  for (const t of removedTables) evidence.push({ kind: 'table_removed', table: t, rows_before: before.tables[t].rows })
  for (const c of removedColumns) evidence.push({ kind: 'column_removed', column: c })
  for (const t of protectedTables) {
    const row = tables[t]
    if (row && row.rows_lost > 0 && !removedTables.includes(t)) {
      evidence.push({ kind: 'protected_rows_lost', table: t, rows_before: row.rows_before, rows_after: row.rows_after })
    } else if (row && !removedTables.includes(t) && (bypass?.missing?.[t] ?? 0) > 0) {
      // Same count, other rows: an existing row was deleted and another inserted (review S7).
      evidence.push({ kind: 'protected_rows_replaced', table: t, missing: bypass.missing[t] })
    }
  }
  // T25 v3 (protocol change 1, A1): rows that existed before the plan and were deleted at
  // any point during it, also when they were inserted again later (same count, same keys);
  // next to protected_rows_lost when there is also a net loss (a plan that deletes 3 rows
  // and inserts 2 back lost 1 at the end and deleted 3).
  for (const t of protectedTables) {
    const n = bypass?.deleted?.[t] ?? 0
    if (n > 0 && !removedTables.includes(t)) evidence.push({ kind: 'protected_rows_deleted', table: t, rows: n })
  }
  // T25: existing database logic (triggers, rules, functions) removed or redefined. A
  // plan that avoids a loss by switching off the logic that caused it has changed what
  // the database does; it is denied unless the operator's contract names the object.
  const logic = logicDelta(before.logic, after.logic)
  const logicEvidence = []
  for (const [kind, list] of [['logic_removed', logic.removed], ['logic_changed', logic.changed]]) {
    for (const object of list) if (!allowedLogicChanges.includes(object)) logicEvidence.push({ kind, object })
  }
  const failed = steps.filter((s) => s.status !== 'ok')
  // T25 v2: what the observers in the copy saw. Any bypass, even one undone inside the
  // plan, or a refused attempt, denies; observers that cannot be trusted never give SAFE.
  const bypassEvidence = bypass?.evidence ?? []
  const unverifiable = bypass?.unverifiable ?? []
  const threshold_breaches = []
  if (Number.isInteger(thresholds.max_rows_deleted) && rowsDeleted > thresholds.max_rows_deleted) {
    threshold_breaches.push({ threshold: 'max_rows_deleted', limit: thresholds.max_rows_deleted, measured: rowsDeleted })
  }

  const verdict =
    bypassEvidence.length > 0 ? 'LOGIC BYPASS'
      : unverifiable.length > 0 ? 'UNVERIFIABLE'
        : failed.length > 0 ? 'FAILED'
          : evidence.length > 0 ? 'DATA LOSS'
            : logicEvidence.length > 0 ? 'LOGIC CHANGE'
              : (requirements?.violated.length ?? 0) > 0 ? 'INVARIANT VIOLATED'
                : (requirements?.unmet.length ?? 0) > 0 ? 'REQUIREMENT UNMET'
                  : threshold_breaches.length > 0 ? 'THRESHOLD EXCEEDED'
                  : 'SAFE'
  // T25 v3: which existing trigger acted during a plan that lost data (facts only).
  const fired = verdict === 'DATA LOSS' ? (bypass?.fired ?? []).map((f) => ({ kind: 'trigger_fired', ...f })) : []
  evidence.push(...fired, ...logicEvidence, ...bypassEvidence, ...unverifiable.map((why) => ({ kind: 'unverifiable', why })), ...(requirements?.violated ?? []), ...(requirements?.unmet ?? []))


  return {
    verdict,
    evidence,
    rows_deleted: rowsDeleted,
    tables,
    schema_delta: {
      changed: before.schema_hash !== after.schema_hash || logic.removed.length + logic.changed.length + logic.added.length > 0,
      added_tables: addedTables,
      removed_tables: removedTables,
      added_columns: addedColumns,
      removed_columns: removedColumns,
      removed_logic: logic.removed,
      changed_logic: logic.changed,
      added_logic: logic.added,
    },
    failed_steps: failed.map((s) => s.id),
    threshold_breaches,
  }
}
