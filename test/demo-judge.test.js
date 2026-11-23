/**
 * T19 against real Docker and Postgres: `justrunme judge` end to end, and its
 * cleanup when interrupted. Runs on Linux (CI) or when JRM_DOCKER_TESTS=1 is set
 * locally.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import os from 'node:os'
import path from 'node:path'
import { EXIT } from '../src/cli/codes.js'
import { BUDGET_MS, HIDDEN_TRIGGER_BUDGET_MS } from '../src/judge/report.js'

const enabled = process.platform === 'linux' || process.env.JRM_DOCKER_TESTS === '1'
const CLI = new URL('../src/cli/index.js', import.meta.url).pathname

/** The caller: its own HOME, its own key directory, credentials in its environment. */
function callerEnv() {
  const fakeHome = mkdtempSync(path.join(os.tmpdir(), 'jrm-judge-home-'))
  const keys = mkdtempSync(path.join(os.tmpdir(), 'jrm-judge-caller-'))
  const env = {
    ...process.env,
    HOME: fakeHome,
    // The Docker client still finds its settings and plugins where they really are.
    DOCKER_CONFIG: process.env.DOCKER_CONFIG ?? path.join(os.homedir(), '.docker'),
    JUSTRUNME_HOME: keys,
    AWS_SECRET_ACCESS_KEY: 'canary-not-a-real-secret',
    PGPASSWORD: 'canary-not-a-real-password',
  }
  return { env, fakeHome, keys, remove: () => [fakeHome, keys].forEach((d) => rmSync(d, { recursive: true, force: true })) }
}

const docker = (...args) => spawnSync('docker', args, { encoding: 'utf8' }).stdout.trim()
/** Containers (running or not), volumes and networks whose name contains `needle`. */
const leftovers = (needle) => ({
  containers: docker('ps', '-a', '-q', '--filter', `name=${needle}`),
  volumes: docker('volume', 'ls', '-q', '--filter', `name=${needle}`),
  networks: docker('network', 'ls', '-q', '--filter', `name=${needle}`),
})

describe('Demo judge: one command, a real Postgres, under 60 s', { skip: !enabled && 'needs Linux or JRM_DOCKER_TESTS=1' }, () => {
  it('shows DATA LOSS, DENY, the safe plan, ALLOW, run, undo and a chain that survives offline verification', () => {
    const caller = callerEnv()
    const started = Date.now()
    const r = spawnSync(process.execPath, [CLI, 'judge'], { encoding: 'utf8', env: caller.env, timeout: 5 * BUDGET_MS })
    const wall = Date.now() - started
    try {
      assert.equal(r.status, EXIT.OK, r.stdout + r.stderr)
      const rep = JSON.parse(r.stdout).result
      assert.equal(rep.judge.status, 'PASS', JSON.stringify(rep.findings))
      assert.equal(rep.counts.failed + rep.counts.skipped, 0)
      assert.equal(rep.counts.steps, rep.steps.length)
      assert.deepEqual(rep.steps.map((s) => s.status), rep.steps.map(() => 'passed'))

      // The story the demo exists to tell.
      assert.equal(rep.story.dangerous.verdict, 'DATA LOSS')
      assert.ok(rep.story.dangerous.rows_lost.orders > 0)
      assert.equal(rep.story.denied.error, 'DATA_LOSS')
      assert.equal(rep.story.safe.verdict, 'SAFE')
      assert.equal(rep.story.selection.decided_by, 'R15.4.1')
      assert.equal(rep.story.allowed.selection_mode, 'selected')
      assert.equal(rep.story.run.status_column_added, true)
      assert.deepEqual([rep.story.undo.status, rep.story.undo.evidence_status], ['RECOVERED', 'recorded'])

      // R8.4: counts and status. Receipts are signed and listed with their hashes.
      assert.deepEqual([rep.counts.mismatches, rep.counts.policy_violations], [0, 0])
      assert.ok(rep.counts.receipts_verified >= 8)
      const kinds = rep.receipts.map((x) => x.kind)
      assert.ok(kinds.filter((k) => k === 'rehearsal').length >= 2 && kinds.includes('plan_selected'), kinds.join(','))
      assert.match(rep.operator_public_key, /^[0-9a-f]{64}$/)
      assert.ok(rep.receipts.every((x) => /^sha256:[0-9a-f]{64}$/.test(x.hash)))

      // R8.2: inside 60 s whenever the image was already local. When it had to be
      // downloaded, the run is timed and reported but not judged (see report.js).
      if (rep.judge.budget_enforced) {
        assert.ok(rep.judge.elapsed_ms < BUDGET_MS, `judge took ${rep.judge.elapsed_ms} ms`)
        assert.ok(wall < BUDGET_MS + 3000, `process took ${wall} ms`)
      }

      // Isolation: neither the caller's key directory nor the default one under the caller's HOME is used.
      assert.deepEqual(readdirSync(caller.keys), [], 'the judge never wrote to the caller key directory')
      assert.ok(!readdirSync(caller.fakeHome).includes('.justrunme'), 'the judge never created ~/.justrunme')
      for (const text of [r.stdout, r.stderr]) {
        assert.ok(!text.includes('canary-not-a-real'), 'caller credentials are not in the output')
        assert.ok(!text.includes(os.homedir()), 'no home directory path in the output')
        assert.ok(!text.includes(caller.fakeHome), 'no caller HOME path in the output')
      }

      // Nothing is left: the stack, and the rehearsal copies the CLI started.
      const suffix = rep.judge.mission_id.replace(/^judge-/, '')
      for (const needle of [`jrm-judge-${suffix}`, `jrm-reh-judge${suffix}-`]) {
        assert.deepEqual(leftovers(needle), { containers: '', volumes: '', networks: '' }, needle)
      }
    } finally {
      caller.remove()
    }
  })

  it('judge --hidden-trigger measures the hidden-trigger DATA LOSS, denies it, and runs and undoes the safe alternative', () => {
    const caller = callerEnv()
    const r = spawnSync(process.execPath, [CLI, 'judge', '--hidden-trigger'], { encoding: 'utf8', env: caller.env, timeout: 3 * HIDDEN_TRIGGER_BUDGET_MS })
    try {
      assert.equal(r.status, EXIT.OK, r.stdout + r.stderr)
      const rep = JSON.parse(r.stdout).result
      assert.equal(rep.judge.status, 'PASS', JSON.stringify(rep.findings))
      assert.equal(rep.judge.budget_ms, HIDDEN_TRIGGER_BUDGET_MS)
      assert.equal(rep.counts.failed + rep.counts.skipped, 0)
      assert.deepEqual(rep.steps.map((s) => s.status), rep.steps.map(() => 'passed'))
      assert.ok(rep.steps.some((x) => x.id === 'hidden_undo' && x.status === 'passed'))
      if (rep.judge.budget_enforced) assert.ok(rep.judge.elapsed_ms < HIDDEN_TRIGGER_BUDGET_MS, `judge took ${rep.judge.elapsed_ms} ms`)

      // The default story is still there.
      assert.equal(rep.story.dangerous.verdict, 'DATA LOSS')
      assert.equal(rep.story.safe.verdict, 'SAFE')

      // The hero case from the recorded run, measured on the real Postgres.
      const h = rep.story.hidden_trigger
      assert.equal(h.trigger, 'patches_release_sold_out')
      assert.equal(h.orders_in_real_database, 3)
      assert.equal(h.dangerous.verdict, 'DATA LOSS')
      assert.deepEqual([h.dangerous.orders_before, h.dangerous.orders_after], [3, 2])
      assert.equal(h.dangerous.rows_lost.orders, 1)
      assert.ok(JSON.stringify(h.dangerous.trigger_fired).includes('patches_release_sold_out'))
      assert.equal(h.dangerous.trigger_fired.fired, 1, JSON.stringify(h.dangerous.trigger_fired))
      assert.equal(h.denied.error, 'DATA_LOSS')
      assert.equal(h.run.order_2_status, 'cancelled')
      assert.equal(h.safe.verdict, 'SAFE')
      assert.equal(h.safe.rows_lost.orders, 0)
      assert.equal(h.selection.decided_by, 'R15.4.1')
      assert.equal(h.allowed.selection_mode, 'selected')
      assert.deepEqual([h.run.ok, h.run.orders_after, h.run.patches_changed], [true, 3, true])
      assert.deepEqual([h.undo.status, h.undo.evidence_status, h.undo.verification], ['RECOVERED', 'recorded', 'PASS'])

      assert.deepEqual([rep.counts.mismatches, rep.counts.policy_violations], [0, 0])
      assert.ok(rep.counts.receipts_verified >= 16)
      assert.ok(rep.receipts.filter((x) => x.kind === 'rehearsal').length >= 4)
      for (const text of [r.stdout, r.stderr]) {
        assert.ok(!text.includes('canary-not-a-real'), 'caller credentials are not in the output')
        assert.ok(!text.includes(os.homedir()), 'no home directory path in the output')
      }
      const suffix = rep.judge.mission_id.replace(/^judge-/, '')
      for (const needle of [`jrm-judge-${suffix}`, `jrm-reh-judge${suffix}-`]) {
        assert.deepEqual(leftovers(needle), { containers: '', volumes: '', networks: '' }, needle)
      }
    } finally {
      caller.remove()
    }
  })

  it('removes its containers, volumes, networks and rehearsal copies when interrupted', async () => {
    const caller = callerEnv()
    const child = spawn(process.execPath, [CLI, 'judge'], { env: caller.env, stdio: 'ignore' })
    const closed = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })))
    try {
      // Wait until the first rehearsal copy is running: that is the hardest moment to clean up after.
      const until = Date.now() + 120000
      let running = ''
      while (Date.now() < until && running === '') {
        running = docker('ps', '-q', '--filter', 'name=jrm-reh-judge')
        if (running === '') await sleep(250)
      }
      assert.notEqual(running, '', 'a rehearsal copy was never seen')
      child.kill('SIGINT')
      const end = await closed
      assert.equal(end.code, 130, `exit after SIGINT: ${JSON.stringify(end)}`)
      for (const needle of ['jrm-judge-', 'jrm-reh-judge']) {
        assert.deepEqual(leftovers(needle), { containers: '', volumes: '', networks: '' }, needle)
      }
      assert.deepEqual(readdirSync(caller.keys), [])
    } finally {
      child.kill('SIGKILL')
      caller.remove()
    }
  })
})
