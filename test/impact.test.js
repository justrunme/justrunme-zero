import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { buildImpact } from '../src/rehearsal/impact.js'

const db = (tables, columns) => ({ schema_hash: 'sha256:' + JSON.stringify(columns).length, tables, columns })
const BEFORE = db(
  { orders: { rows: 3, checksum: 'a' }, patches: { rows: 5, checksum: 'b' } },
  { orders: ['id integer', 'patch_id integer', 'quantity integer', 'created_at timestamp'], patches: ['id integer', 'name text'] }
)
const ok = [{ id: 'step-1', status: 'ok' }]
const impact = (after, extra = {}) => buildImpact({ before: BEFORE, after, protectedTables: ['orders'], steps: ok, ...extra })

describe('impact verdict (R2.6)', () => {
  it('additive column: SAFE', () => {
    const after = db({ ...BEFORE.tables, orders: { rows: 3, checksum: 'z' } }, { ...BEFORE.columns, orders: [...BEFORE.columns.orders, 'status text'] })
    const r = impact(after)
    assert.equal(r.verdict, 'SAFE')
    assert.deepEqual(r.schema_delta.added_columns, ['orders.status'])
  })

  it('protected rows lost: DATA LOSS with before and after counts', () => {
    const r = impact(db({ ...BEFORE.tables, orders: { rows: 2, checksum: 'z' } }, BEFORE.columns))
    assert.equal(r.verdict, 'DATA LOSS')
    assert.deepEqual(r.evidence, [{ kind: 'protected_rows_lost', table: 'orders', rows_before: 3, rows_after: 2 }])
  })

  it('column dropped (rows kept): DATA LOSS', () => {
    const cols = { ...BEFORE.columns, orders: BEFORE.columns.orders.filter((c) => !c.startsWith('created_at')) }
    const r = impact(db(BEFORE.tables, cols))
    assert.equal(r.verdict, 'DATA LOSS')
    assert.deepEqual(r.evidence, [{ kind: 'column_removed', column: 'orders.created_at' }])
  })

  it('any table dropped, even unprotected: DATA LOSS', () => {
    const r = impact(db({ orders: BEFORE.tables.orders }, { orders: BEFORE.columns.orders }))
    assert.equal(r.verdict, 'DATA LOSS')
    assert.equal(r.evidence[0].kind, 'table_removed')
  })

  it('unprotected rows lost beyond policy threshold: not SAFE; threshold breach recorded', () => {
    const r = impact(db({ ...BEFORE.tables, patches: { rows: 1, checksum: 'z' } }, BEFORE.columns), { thresholds: { max_rows_deleted: 2 } })
    assert.equal(r.verdict, 'THRESHOLD EXCEEDED')
    assert.equal(r.tables.patches.rows_lost, 4)
    assert.deepEqual(r.threshold_breaches, [{ threshold: 'max_rows_deleted', limit: 2, measured: 4 }])
  })

  it('a failed step gives FAILED regardless of measurements', () => {
    const r = buildImpact({ before: BEFORE, after: BEFORE, protectedTables: [], steps: [{ id: 'step-1', status: 'failed' }] })
    assert.equal(r.verdict, 'FAILED')
    assert.deepEqual(r.failed_steps, ['step-1'])
  })

  it('property: a protected table that loses rows is never SAFE', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), fc.integer({ min: 0, max: 999 }), (rowsBefore, drop) => {
        const lost = Math.min(rowsBefore, drop + 1)
        const before = db({ orders: { rows: rowsBefore, checksum: 'a' } }, { orders: ['id integer'] })
        const after = db({ orders: { rows: rowsBefore - lost, checksum: 'b' } }, { orders: ['id integer'] })
        return buildImpact({ before, after, protectedTables: ['orders'], steps: ok }).verdict === 'DATA LOSS'
      }),
      { numRuns: 200 }
    )
  })
})
