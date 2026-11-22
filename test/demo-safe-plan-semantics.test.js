/**
 * Business meaning of the hidden-trigger safe plan, on a real Postgres in Docker.
 * The safe plan cancels the open orders of patch 1, then sets its available_count
 * to 0. This test reads the exact rows (not counts) before the run, after the run
 * and after undo. Runs on Linux (CI) or when JRM_DOCKER_TESTS=1 is set locally.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createBackend } from '../src/judge/env.js'

const enabled = process.platform === 'linux' || process.env.JRM_DOCKER_TESTS === '1'

const ORDERS_SQL = "SELECT id, patch_id, quantity, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS'), status FROM orders ORDER BY id"
const PATCHES_SQL = 'SELECT id, name, location, available_count FROM patches ORDER BY id'

const SEED_ORDERS = [
  ['1', '2', '10', '2026-10-01T09:00:00', 'open'],
  ['2', '1', '5', '2026-10-02T11:30:00', 'open'],
  ['3', '4', '20', '2026-10-03T14:00:00', 'open'],
]
const SEED_PATCHES = [
  ['1', 'Hollow Creek Farm', 'Willow Lane 12', '80'],
  ['2', 'Scarecrow Acres', 'Old Mill Road 4', '150'],
  ['3', 'Harvest Moon Patch', 'Pumpkin Ridge 7', '60'],
  ['4', 'Cobweb Corner', 'Foggy Bottom 99', '200'],
  ['5', 'The Gourd Garden', 'Autumn Vale 3', '45'],
]

describe('Hidden-trigger safe plan keeps the shop meaning (real Postgres)', { skip: !enabled && 'needs Linux or JRM_DOCKER_TESTS=1' }, () => {
  it('cancels order 2 only, deletes nothing, zeroes patch 1 only, and undo restores every field', async () => {
    const { backend, missionId, cleanup } = await createBackend()
    try {
      const suffix = missionId.replace(/^judge-/, '')
      const ids = spawnSync('docker', ['ps', '-q', '--filter', `name=jrm-judge-${suffix}-db`], { encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean)
      assert.equal(ids.length, 1, 'exactly one database container of this run')
      const rows = (sql) => {
        const r = spawnSync('docker', ['exec', ids[0], 'psql', '-U', 'demo_user', '-d', 'pumpkin_patch', '-At', '-F', '|', '-c', sql], { encoding: 'utf8' })
        assert.equal(r.status, 0, r.stderr)
        return r.stdout.trim().split('\n').filter(Boolean).map((l) => l.split('|'))
      }
      const expectOk = (r, label) => assert.equal(r.exit, 0, `${label}: ${JSON.stringify(r.out)}`)

      expectOk(await backend.cli(['keys', 'init']), 'keys')
      expectOk(await backend.cli(['approver', 'init']), 'approver')
      await backend.installHiddenTrigger()

      assert.deepEqual(rows(ORDERS_SQL), SEED_ORDERS)
      assert.deepEqual(rows(PATCHES_SQL), SEED_PATCHES)

      // The dangerous plan is measured and refused; the real database stays as it was.
      await backend.useMigration('hidden_dangerous')
      const bad = await backend.cli(['rehearse'])
      assert.equal(bad.out.result.verdict, 'DATA LOSS')
      assert.equal((await backend.cli(['authorize'])).out.error.code, 'DATA_LOSS')
      assert.deepEqual(rows(ORDERS_SQL), SEED_ORDERS)

      await backend.useMigration('hidden_safe')
      const safe = await backend.cli(['rehearse'])
      expectOk(safe, 'rehearse safe')
      assert.equal(safe.out.result.verdict, 'SAFE')
      assert.equal(safe.out.result.rows_lost.orders, 0)
      expectOk(await backend.cli(['compare']), 'compare')
      expectOk(await backend.cli(['authorize']), 'authorize')
      const run = await backend.cli(['run'])
      expectOk(run, 'run')
      assert.equal(run.out.result.ok, true)

      // After the safe run: same three orders, same fields, only order 2 reclassified.
      assert.deepEqual(rows(ORDERS_SQL), [
        ['1', '2', '10', '2026-10-01T09:00:00', 'open'],
        ['2', '1', '5', '2026-10-02T11:30:00', 'cancelled'],
        ['3', '4', '20', '2026-10-03T14:00:00', 'open'],
      ])
      // Patch 1 sold out (available_count 0); the other four patch rows are unchanged.
      assert.deepEqual(rows(PATCHES_SQL), [['1', 'Hollow Creek Farm', 'Willow Lane 12', '0'], ...SEED_PATCHES.slice(1)])

      const undo = await backend.cli(['undo', run.out.result.capture_id])
      expectOk(undo, 'undo')
      assert.equal(undo.out.result.status, 'RECOVERED')
      assert.equal(undo.out.result.verification.status, 'PASS')

      assert.deepEqual(rows(ORDERS_SQL), SEED_ORDERS)
      assert.deepEqual(rows(PATCHES_SQL), SEED_PATCHES)
    } finally {
      const st = await cleanup()
      assert.equal(st.status, 'clean', JSON.stringify(st))
    }
  })
})
