/**
 * T19 judge scenario, report and environment rules, without Docker. The real run
 * against Postgres is in test/demo-judge.test.js.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { runScenario, STEPS, HIDDEN_STEPS, stepsFor } from '../src/judge/scenario.js'
import { BUDGET_MS, HIDDEN_TRIGGER_BUDGET_MS, buildReport } from '../src/judge/report.js'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { JudgeEnvironmentError, childEnv, createBackend, currentEndpoint, isLocalEndpoint, projectNames } from '../src/judge/env.js'
import { down, dump, imageDigests, psql, up } from '../src/rehearsal/compose.js'
import { EXIT } from '../src/cli/codes.js'
import { judgeSummaryLines, main, textOf } from '../src/cli/index.js'
import { runJudge } from '../src/judge/index.js'

const CLEAN = { ok: true, status: 'clean', leftovers: [], errors: [] }

/** A scripted stand-in for the CLI: behaves like a correct JustRunMe, with hooks to break one step. */
function fakeBackend({ override = {}, verifierAcceptsAnything = false } = {}) {
  const state = { kind: null, migrated: false, tampered: false, calls: [] }
  const db = () => ({
    schema_hash: state.migrated ? 'sha256:h2' : 'sha256:h1',
    tables: { orders: { rows: 12, checksum: 'a' }, patches: { rows: 3, checksum: 'b' } },
    columns: { orders: ['id integer not null', ...(state.migrated ? ['status text not null'] : [])] },
  })
  const dangerous = () => state.kind === 'dangerous'
  const answers = {
    keys: () => ({ exit: 0, out: { result: { public_key: 'ab'.repeat(16) } } }),
    approver: () => ({ exit: 0, out: { result: { approver_public_key: 'cd'.repeat(32) } } }),
    rehearse: () =>
      dangerous()
        ? { exit: 10, out: { result: { verdict: 'DATA LOSS', rows_lost: { orders: 1, patches: 0 }, plan_id: 'plan-d', base_hash: 'base-1' } } }
        : { exit: 0, out: { result: { verdict: 'SAFE', rows_lost: { orders: 0, patches: 0 }, plan_id: 'plan-s', base_hash: 'base-1' } } },
    authorize: () =>
      dangerous()
        ? { exit: 21, out: { error: { code: 'DATA_LOSS', message: 'rehearsal measured data loss' } } }
        : { exit: 0, out: { result: { plan_id: 'plan-s', selection: { mode: 'selected' } } } },
    compare: () => ({ exit: 0, out: { result: { recommended: 'plan-s', decided_by: 'R15.4.1', removed: [{ plan_id: 'plan-d' }] } } }),
    run: () => {
      state.migrated = true
      return { exit: 0, out: { result: { ok: true, capture_id: 'cap-20261117000000-abcdef', steps: [{}] } } }
    },
    undo: () => {
      state.migrated = false
      return { exit: 0, out: { result: { status: 'RECOVERED', evidence_status: 'recorded', verification: { status: 'PASS' } } } }
    },
    verify: () =>
      state.tampered && !verifierAcceptsAnything
        ? { exit: 30, out: { result: { ok: false, receipts: 9, chain_findings: [{ problem: 'bad line' }], policy_findings: [] } } }
        : { exit: 0, out: { result: { ok: true, receipts: 9, chain_findings: [], policy_findings: [] } } },
    replay: () => ({ exit: 0, out: { result: { ok: true } } }),
  }
  const call = async (args) => {
    state.calls.push(args[0])
    return (override[args[0]] ?? answers[args[0]])(args)
  }
  return {
    state,
    cli: call,
    offlineCli: call,
    measure: async () => db(),
    useMigration: async (kind) => {
      state.kind = kind
    },
    stopStack: async () => {},
    corruptChain: () => {
      state.tampered = true
    },
    restoreChain: () => {
      state.tampered = false
    },
    readReceipts: () => ({ publicKey: 'ab'.repeat(16), receipts: [{ seq: 0, kind: 'rehearsal', verdict: 'DATA LOSS', hash: 'sha256:x' }] }),
  }
}

const report = (scenario, extra = {}) =>
  buildReport({ stepResults: scenario.stepResults, elapsedMs: 30000, imagesCached: true, missionId: 'judge-test', publicKey: scenario.publicKey, receipts: scenario.receipts, offline: scenario.offline, story: scenario.story, cleanup: CLEAN, ...extra })

describe('Judge scenario (T19)', () => {
  it('passes when every step does what a correct JustRunMe does, in the documented order', async () => {
    const backend = fakeBackend()
    const s = await runScenario(backend)
    assert.deepEqual(s.stepResults.map((r) => r.id), STEPS.map(([id]) => id))
    assert.ok(s.stepResults.every((r) => r.status === 'passed'), JSON.stringify(s.stepResults.filter((r) => r.status !== 'passed')))
    assert.deepEqual(backend.state.calls.slice(0, 8), ['keys', 'approver', 'rehearse', 'authorize', 'rehearse', 'compare', 'authorize', 'run'])
    assert.equal(s.story.dangerous.verdict, 'DATA LOSS')
    assert.equal(s.story.denied.error, 'DATA_LOSS')
    assert.equal(s.story.selection.recommended, 'plan-s')
    assert.equal(s.story.undo.evidence_status, 'recorded')
    const r = report(s)
    assert.equal(r.judge.status, 'PASS')
    assert.deepEqual([r.counts.steps, r.counts.passed, r.counts.failed, r.counts.skipped], [STEPS.length, STEPS.length, 0, 0])
    assert.deepEqual([r.counts.receipts_verified, r.counts.mismatches, r.counts.policy_violations], [9, 0, 0])
  })

  it('fails and skips the rest when the dangerous plan is NOT denied', async () => {
    const s = await runScenario(fakeBackend({ override: { authorize: () => ({ exit: 0, out: { result: { plan_id: 'plan-d', selection: { mode: 'single' } } } }) } }))
    const by = Object.fromEntries(s.stepResults.map((r) => [r.id, r.status]))
    assert.equal(by.deny, 'failed')
    assert.equal(by.run, 'skipped')
    assert.equal(by.tamper_restored, 'skipped')
    const r = report(s)
    assert.equal(r.judge.status, 'FAIL')
    assert.ok(r.findings.some((f) => f.code === 'STEP_FAILED' && f.step === 'deny'))
    assert.ok(r.findings.some((f) => f.code === 'STEP_SKIPPED'))
  })

  it('fails when the run silently lost rows, even though every exit code is 0', async () => {
    const b = fakeBackend()
    const measure = b.measure
    // The run reports success, but the real database now has one order fewer.
    b.measure = async () => {
      const m = await measure()
      if (b.state.migrated) m.tables.orders.rows -= 1
      return m
    }
    const s = await runScenario(b)
    assert.equal(s.stepResults.find((r) => r.id === 'run').status, 'failed')
    assert.equal(s.stepResults.find((r) => r.id === 'undo').status, 'skipped')
  })

  it('does not accept a verifier that approves a damaged chain', async () => {
    const s = await runScenario(fakeBackend({ verifierAcceptsAnything: true }))
    const t = s.stepResults.find((r) => r.id === 'tamper_detected')
    assert.equal(t.status, 'failed')
    assert.equal(report(s).judge.status, 'FAIL')
  })

  it('fails the report when a backend call outside a step throws, even if every step passed', async () => {
    const b = fakeBackend()
    b.readReceipts = () => {
      throw new Error('cannot read the chain')
    }
    const s = await runScenario(b)
    assert.ok(s.stepResults.every((r) => r.status === 'passed'))
    const r = report(s)
    assert.equal(r.judge.status, 'FAIL')
    assert.deepEqual(r.findings.map((f) => f.code), ['BACKEND_ERROR'])
  })

  it('does not run the offline steps when the containers could not be stopped', async () => {
    const b = fakeBackend()
    b.stopStack = async () => {
      throw new Error('docker compose down failed')
    }
    const s = await runScenario(b)
    assert.equal(s.stepResults.find((r) => r.id === 'offline_verify').status, 'skipped')
    assert.equal(report(s).judge.status, 'FAIL')
  })

  it('fails when the schema changed even though every table kept its rows', async () => {
    const b = fakeBackend()
    const measure = b.measure
    let afterUndo = false
    const cli = b.cli
    b.cli = async (args) => {
      const r = await cli(args)
      if (args[0] === 'undo') afterUndo = true
      return r
    }
    b.measure = async () => ({ ...(await measure()), ...(afterUndo ? { schema_hash: 'sha256:other' } : {}) })
    const s = await runScenario(b)
    assert.equal(s.stepResults.find((r) => r.id === 'undo').status, 'failed')
  })

  it('records a command that throws or prints no JSON as a failed step, not a crash', async () => {
    const thrown = await runScenario(fakeBackend({ override: { compare: () => { throw new Error('boom') } } }))
    assert.equal(thrown.stepResults.find((r) => r.id === 'compare').status, 'failed')
    assert.equal(thrown.stepResults.find((r) => r.id === 'compare').code, 'JUDGE_STEP_ERROR')
    const empty = await runScenario(fakeBackend({ override: { keys: () => ({ exit: 0, out: null }) } }))
    assert.equal(empty.stepResults[0].status, 'failed')
  })
})

describe('Judge report (T19.3)', () => {
  const steps = (n, status = 'passed') => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: 't', status, expected_exit: 0, observed_exit: 0, code: null, checks: [] }))
  const build = (over) => buildReport({ stepResults: steps(3), elapsedMs: 1000, imagesCached: true, missionId: 'judge-x', publicKey: null, receipts: [], offline: { receipts: 9, chain_findings: 0, policy_findings: 0 }, story: {}, cleanup: CLEAN, ...over })

  it('has the fields R8.4 asks for', () => {
    const r = build({})
    assert.deepEqual(Object.keys(r).sort(), ['cleanup', 'counts', 'findings', 'judge', 'limits', 'operator_public_key', 'receipts', 'steps', 'story'])
    assert.ok(r.limits.some((l) => /approver key/.test(l)), 'the report says the demo approves by itself')
    assert.deepEqual(Object.keys(r.counts).sort(), ['failed', 'mismatches', 'passed', 'policy_violations', 'receipts_verified', 'skipped', 'steps'])
    assert.ok(['PASS', 'FAIL'].includes(r.judge.status))
  })

  it('enforces the 60 s budget only when the images were already on the machine', () => {
    assert.equal(BUDGET_MS, 60000)
    assert.equal(build({ elapsedMs: BUDGET_MS - 1 }).judge.status, 'PASS')
    const slow = build({ elapsedMs: BUDGET_MS })
    assert.equal(slow.judge.status, 'FAIL')
    assert.equal(slow.findings[0].code, 'OVER_BUDGET')
    const firstRun = build({ elapsedMs: 5 * BUDGET_MS, imagesCached: false })
    assert.equal(firstRun.judge.status, 'PASS')
    assert.equal(firstRun.judge.budget_enforced, false)
    assert.equal(firstRun.judge.within_budget, false, 'the time is still reported honestly')
  })

  it('property: PASS exactly when no step failed or was skipped and the budget holds', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('passed', 'failed', 'skipped'), { maxLength: 15 }), fc.integer({ min: 0, max: 200000 }), fc.boolean(), (list, elapsed, cached) => {
        const stepResults = list.map((status, i) => ({ id: `s${i}`, title: 't', status, expected_exit: 0, observed_exit: 0, code: null, checks: [{ name: 'x', ok: status === 'passed' }] }))
        const r = build({ stepResults, elapsedMs: elapsed, imagesCached: cached })
        const expected = list.every((s) => s === 'passed') && !(cached && elapsed >= BUDGET_MS)
        return (r.judge.status === 'PASS') === expected && r.counts.passed + r.counts.failed + r.counts.skipped === list.length
      })
    )
  })
})

describe('Judge environment (T19.2)', () => {
  it('passes on Docker settings and PATH only; credentials in the caller environment stay behind', () => {
    const env = childEnv(
      { PATH: '/bin', HOME: '/h', DOCKER_HOST: 'unix:///x', AWS_SECRET_ACCESS_KEY: 's', DATABASE_URL: 'postgres://u:p@h/d', PGPASSWORD: 'p', GITHUB_TOKEN: 't', JUSTRUNME_HOME: '/real/keys', JUSTRUNME_GATE: 'on' },
      '/tmp/throwaway'
    )
    assert.deepEqual(Object.keys(env).sort(), ['DOCKER_HOST', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'HOME', 'JUSTRUNME_HOME', 'PATH'])
    assert.equal(env.JUSTRUNME_HOME, '/tmp/throwaway')
    assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null', 'the caller git configuration is ignored')
    assert.ok(!('GIT_DIR' in childEnv({ GIT_DIR: '/elsewhere/.git', GIT_WORK_TREE: '/elsewhere' }, '/tmp/x')), 'GIT_DIR cannot redirect git to another repository')
  })

  it('refuses a remote Docker daemon before creating anything', async () => {
    for (const host of ['tcp://10.0.0.5:2375', 'ssh://deploy@prod.example']) {
      await assert.rejects(createBackend({ env: { PATH: '/bin', DOCKER_HOST: host } }), (err) => err instanceof JudgeEnvironmentError && err.code === 'REMOTE_DOCKER')
    }
  })

  it('accepts only a local socket as the Docker endpoint and reads the active context from the CLI listing', () => {
    for (const ok of ['unix:///var/run/docker.sock', 'unix:///run/user/1000/docker.sock', 'npipe:////./pipe/docker_engine']) assert.equal(isLocalEndpoint(ok), true, ok)
    for (const bad of ['tcp://10.0.0.5:2376', 'ssh://deploy@prod', 'http://localhost:2375', 'unix://', '', null, undefined]) assert.equal(isLocalEndpoint(bad), false, String(bad))
    assert.equal(currentEndpoint('false\ttcp://prod:2376\ntrue\tunix:///var/run/docker.sock\n'), 'unix:///var/run/docker.sock')
    assert.equal(currentEndpoint('true\ttcp://prod:2376\nfalse\tunix:///var/run/docker.sock\n'), 'tcp://prod:2376')
    assert.equal(currentEndpoint(''), null)
    assert.equal(currentEndpoint('true\ta\ntrue\tb\n'), null, 'two current contexts is ambiguous: refuse')
  })

  it('refuses a remote context chosen by the Docker configuration, before creating anything', async () => {
    const bin = mkdtempSync(path.join(os.tmpdir(), 'jrm-fake-docker-'))
    try {
      writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\ncase "$1" in context) printf "false\\tunix:///var/run/docker.sock\\ntrue\\tssh://deploy@prod.example\\n";; esac\nexit 0\n', { mode: 0o755 })
      await assert.rejects(createBackend({ env: { PATH: `${bin}:/usr/bin:/bin` } }), (err) => err instanceof JudgeEnvironmentError && err.code === 'REMOTE_DOCKER')
    } finally {
      rmSync(bin, { recursive: true, force: true })
    }
  })

  it('runs every docker call of a target with the target environment, not the caller one', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'jrm-fake-docker-'))
    const log = path.join(dir, 'calls.log')
    const before = process.env.DOCKER_HOST
    process.env.DOCKER_HOST = 'tcp://elsewhere.example:2376'
    try {
      writeFileSync(path.join(dir, 'docker'), '#!/bin/sh\necho "$DOCKER_HOST" >> "$FAKE_LOG"\ncase "$*" in *"ps -q"*) echo abcdef123456;; esac\nexit 0\n', { mode: 0o755 })
      const target = { project: 'jrm-pin-test', composeFile: '/x/docker-compose.yml', dbService: 'db', dbUser: 'u', dbName: 'd', env: { PATH: `${dir}:/usr/bin:/bin`, DOCKER_HOST: 'unix:///pinned.sock', FAKE_LOG: log } }
      await up(target, ['db'])
      await psql(target, { sql: 'select 1' })
      await dump(target)
      await imageDigests(target)
      await down(target)
      const hosts = readFileSync(log, 'utf8').split('\n').filter(Boolean)
      assert.ok(hosts.length >= 6, `only ${hosts.length} docker calls seen`)
      assert.deepEqual([...new Set(hosts)], ['unix:///pinned.sock'])
    } finally {
      if (before === undefined) delete process.env.DOCKER_HOST
      else process.env.DOCKER_HOST = before
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('names what a run created, so that an early exit can remove the rehearsal copies too', () => {
    assert.deepEqual(projectNames('ab12cd34'), { stack: 'jrm-judge-ab12cd34', rehearsalPrefix: 'jrm-reh-judgeab12cd34-' })
    // The rehearsal engine names its copies jrm-reh-<mission id, lower case, letters and digits only>-<hex>.
    const mission = 'judge-ab12cd34'
    assert.ok(`jrm-reh-${mission.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)}-0f0f0f0f`.startsWith(projectNames('ab12cd34').rehearsalPrefix))
  })
})

describe('judge command line', () => {
  it('takes no --repo and no --mission, and has its own exit codes', async () => {
    for (const extra of [['--repo', '.'], ['--mission', 'abc-123']]) {
      const r = await main(['judge', ...extra])
      assert.equal(r.exit, EXIT.USAGE)
      assert.equal(r.output.error.code, 'USAGE')
    }
    assert.deepEqual([EXIT.JUDGE_FAILED, EXIT.JUDGE_ENVIRONMENT], [40, 41])
  })
})

describe('judge --text summary lines', () => {
  const textFor = async (backend) => {
    const s = await runScenario(backend)
    const rep = report(s)
    return { rep, text: textOf({ command: 'judge', ok: rep.judge.status === 'PASS', exit_code: rep.judge.status === 'PASS' ? 0 : EXIT.JUDGE_FAILED, result: rep }) }
  }

  it('shows the recorded dangerous and safe verdicts, rows lost and removed plans right after the status line', async () => {
    const { text } = await textFor(fakeBackend())
    const lines = text.split('\n')
    assert.match(lines[0], /^judge: ok/)
    assert.match(lines[1], /^PASS in /)
    assert.equal(lines[2], '  dangerous plan: DATA LOSS, rows lost: 1 (orders 1, patches 0)')
    assert.equal(lines[3], '  safe plan: SAFE, rows lost: 0 (orders 0, patches 0)')
    assert.equal(lines[4], '  removed from selection: 1 plan')
    assert.ok(text.includes('receipts verified: 9'), 'existing lines are kept')
  })

  it('never prints SAFE when the safe plan was not rehearsed, and keeps the failing step visible', async () => {
    const backend = fakeBackend({ override: { rehearse: () => ({ exit: 10, out: { result: { verdict: 'DATA LOSS', rows_lost: { orders: 2 }, plan_id: 'plan-d', base_hash: 'base-1' } } }) } })
    const { rep, text } = await textFor(backend)
    assert.equal(rep.judge.status, 'FAIL')
    assert.ok(!/SAFE/.test(text.replace(/DATA LOSS/g, '')), 'no SAFE anywhere in the output')
    assert.ok(text.includes('safe plan: DATA LOSS, rows lost: 2 (orders 2)'), 'the recorded verdict is shown as measured')
    assert.ok(text.includes('FAIL'))
  })

  it('prints no summary line at all when nothing was recorded', () => {
    assert.deepEqual(judgeSummaryLines(undefined), [])
    assert.deepEqual(judgeSummaryLines({ dangerous: { verdict: undefined }, safe: {}, selection: { removed: [] } }), [])
  })

  it('leaves the JSON report unchanged: no summary field is added', async () => {
    const { rep } = await textFor(fakeBackend())
    assert.deepEqual(Object.keys(rep), ['judge', 'counts', 'cleanup', 'findings', 'story', 'steps', 'receipts', 'operator_public_key', 'limits'])
  })
})

describe('Judge verdict follows the cleanup status (T49)', () => {
  const env = (cleanup, calls = { n: 0 }) => ({
    backend: fakeBackend(),
    missionId: 'judge-c',
    imagesCached: true,
    cleanup: async () => {
      calls.n++
      return typeof cleanup === 'function' ? cleanup() : cleanup
    },
  })

  it('PASS only with a clean cleanup, and the cleanup runs once', async () => {
    const calls = { n: 0 }
    const r = await runJudge({ create: async () => env(CLEAN, calls) })
    assert.equal(r.judge.status, 'PASS')
    assert.deepEqual(r.cleanup, CLEAN)
    assert.equal(calls.n, 1)
  })

  it('FAIL with the leftover resources listed when objects remain', async () => {
    const left = { ok: false, status: 'leftovers', leftovers: [{ kind: 'volume', id: 'jrm-reh-judgeab-data' }], errors: ['volume_remove_failed'] }
    const r = await runJudge({ create: async () => env(left) })
    assert.equal(r.judge.status, 'FAIL')
    const f = r.findings.find((x) => x.code === 'CLEANUP_INCOMPLETE')
    assert.deepEqual(f.leftovers, left.leftovers)
    assert.deepEqual(f.errors, ['volume_remove_failed'])
    assert.equal(r.cleanup.status, 'leftovers')
  })

  it('FAIL when the daemon could not be asked (unverified), a cleanup that throws, or a status that is missing', async () => {
    const unverified = { ok: false, status: 'unverified', leftovers: [], errors: ['container_list_failed'] }
    for (const c of [unverified, () => { throw new Error('boom') }, undefined, { status: 'clean' }, { ok: true, status: 'clean', leftovers: [{ kind: 'network', id: 'n' }], errors: [] }]) {
      const r = await runJudge({ create: async () => env(c) })
      assert.equal(r.judge.status, 'FAIL')
      assert.equal(r.cleanup.ok, false)
      assert.ok(r.findings.some((x) => x.code === 'CLEANUP_INCOMPLETE'))
    }
  })

  it('a backend error still runs the cleanup once, fails the report and raises no unhandled rejection', async () => {
    const calls = { n: 0 }
    const e = env(CLEAN, calls)
    e.backend.cli = async () => { throw new Error('backend broke') }
    const unhandled = []
    const on = (x) => unhandled.push(x)
    process.on('unhandledRejection', on)
    const r = await runJudge({ create: async () => e })
    await new Promise((res) => setImmediate(res))
    process.removeListener('unhandledRejection', on)
    assert.equal(r.judge.status, 'FAIL')
    assert.equal(calls.n, 1)
    assert.deepEqual(unhandled, [])
  })

  it('a rejecting cleanup alongside a backend error leaves a FAIL report, not a crash', async () => {
    const e = env(() => { throw new Error('cleanup broke') })
    e.backend.cli = async () => { throw new Error('backend broke') }
    const r = await runJudge({ create: async () => e })
    assert.equal(r.judge.status, 'FAIL')
    assert.ok(r.findings.some((x) => x.code === 'CLEANUP_INCOMPLETE'))
  })

  it('buildReport without a cleanup status is FAIL', () => {
    const r = buildReport({ stepResults: [], elapsedMs: 1, imagesCached: true, missionId: 'm', publicKey: null, receipts: [], offline: null, story: {} })
    assert.equal(r.judge.status, 'FAIL')
    assert.deepEqual(r.cleanup.errors, ['cleanup_status_missing'])
  })
})

describe('Judge hidden-trigger case is opt-in', () => {
  const hiddenIds = HIDDEN_STEPS.map(([id]) => id)

  /** The correct JustRunMe for the hero case: the plan is one UPDATE, a trigger deletes orders, 3 -> 2. */
  function hiddenFake({ safeLoses = 0 } = {}) {
    const b = fakeBackend()
    const base = b.cli
    const flags = { installed: 0, ran: false }
    const evidence = [{ kind: 'protected_rows_lost', table: 'orders', rows_before: 12, rows_after: 11 }, { kind: 'trigger_fired', trigger: 'patches_release_sold_out', count: 1 }]
    const hidden = (k) => k === 'hidden_dangerous' || k === 'hidden_safe'
    const answers = {
      rehearse: () => b.state.kind === 'hidden_dangerous'
        ? { exit: 10, out: { result: { verdict: 'DATA LOSS', rows_lost: { orders: 1 }, evidence, plan_id: 'plan-hd', base_hash: 'base-2' } } }
        : { exit: 0, out: { result: { verdict: 'SAFE', rows_lost: { orders: safeLoses }, plan_id: 'plan-hs', base_hash: 'base-2' } } },
      authorize: () => b.state.kind === 'hidden_dangerous'
        ? { exit: 21, out: { error: { code: 'DATA_LOSS', message: 'rehearsal measured data loss' } } }
        : { exit: 0, out: { result: { plan_id: 'plan-hs', selection: { mode: 'selected' } } } },
      compare: () => ({ exit: 0, out: { result: { recommended: 'plan-hs', decided_by: 'R15.4.1', removed: [{ plan_id: 'plan-hd' }] } } }),
    }
    b.cli = async (args) => (hidden(b.state.kind) && answers[args[0]] ? answers[args[0]](args) : base(args))
    b.readOrderTwoStatus = async () => 'cancelled'
    b.installHiddenTrigger = async () => { flags.installed++ }
    const measure = b.measure
    b.measure = async () => {
      const m = await measure()
      return flags.ran && b.state.kind === 'hidden_safe' && b.state.migrated ? { ...m, tables: { ...m.tables, patches: { rows: 3, checksum: 'b2' } } } : m
    }
    return { b, flags }
  }

  it('the default scenario never installs the trigger and runs none of the hidden steps', async () => {
    const { b, flags } = hiddenFake()
    const s = await runScenario(b)
    assert.deepEqual(s.stepResults.map((r) => r.id), STEPS.map(([id]) => id))
    assert.equal(flags.installed, 0)
    assert.equal(s.story.hidden_trigger, undefined)
    const r = report(s)
    assert.equal(r.judge.status, 'PASS')
    assert.equal(r.judge.budget_ms, BUDGET_MS)
    assert.equal(r.judge.budget_ms, 60000)
  })

  it('--hidden-trigger adds the steps after the first undo and records the measured numbers', async () => {
    const { b, flags } = hiddenFake()
    // run() of the safe hidden plan changes the patch row; the fake notices through the flag.
    const run = b.cli
    b.cli = async (args) => { if (args[0] === 'run') flags.ran = true; return run(args) }
    const s = await runScenario(b, { hiddenTrigger: true })
    assert.equal(flags.installed, 1)
    assert.deepEqual(s.stepResults.map((r) => r.id), stepsFor(true).map(([id]) => id))
    assert.deepEqual(s.stepResults.map((r) => r.id).filter((id) => hiddenIds.includes(id)), hiddenIds)
    assert.ok(s.stepResults.every((r) => r.status === 'passed'), JSON.stringify(s.stepResults.filter((r) => r.status !== 'passed')))
    const h = s.story.hidden_trigger
    assert.equal(h.trigger, 'patches_release_sold_out')
    assert.deepEqual([h.dangerous.verdict, h.dangerous.orders_before, h.dangerous.orders_after, h.dangerous.rows_lost.orders], ['DATA LOSS', 12, 11, 1])
    assert.equal(h.denied.error, 'DATA_LOSS')
    assert.deepEqual([h.safe.verdict, h.safe.rows_lost.orders], ['SAFE', 0])
    assert.deepEqual([h.undo.status, h.undo.verification], ['RECOVERED', 'PASS'])
    assert.ok(s.stepResults.findIndex((r) => r.id === 'hidden_rehearse_dangerous') > s.stepResults.findIndex((r) => r.id === 'undo'))
    assert.ok(s.stepResults.findIndex((r) => r.id === 'hidden_undo') < s.stepResults.findIndex((r) => r.id === 'verify'))
  })

  it('fails closed when the backend cannot install the trigger, and when the safe alternative loses rows', async () => {
    const { b } = hiddenFake()
    delete b.installHiddenTrigger
    const s = await runScenario(b, { hiddenTrigger: true })
    assert.equal(report(s, { budgetMs: HIDDEN_TRIGGER_BUDGET_MS }).judge.status, 'FAIL')
    assert.equal(s.stepResults.find((r) => r.id === 'hidden_rehearse_dangerous').status, 'skipped')
    const lossy = await runScenario(hiddenFake({ safeLoses: 1 }).b, { hiddenTrigger: true })
    assert.equal(lossy.stepResults.find((r) => r.id === 'hidden_rehearse_safe').status, 'failed')
  })

  it('the hidden-trigger run has its own named budget of 90 s; the default stays 60 s', async () => {
    assert.equal(HIDDEN_TRIGGER_BUDGET_MS, 90000)
    assert.equal(BUDGET_MS, 60000)
    const mk = (hiddenTrigger) => {
      const { b } = hiddenFake()
      return { create: async () => ({ backend: b, missionId: 'judge-x', imagesCached: true, cleanup: async () => CLEAN }), hiddenTrigger }
    }
    // An elapsed time of 75 s is over the default budget, inside the hidden-trigger one.
    const realNow = performance.now.bind(performance)
    const clock = (ms) => { let n = 0; performance.now = () => (n++ === 0 ? 0 : ms) }
    try {
      clock(75000)
      const withFlag = await runJudge(mk(true))
      assert.equal(withFlag.judge.budget_ms, HIDDEN_TRIGGER_BUDGET_MS)
      assert.ok(!withFlag.findings.some((f) => f.code === 'OVER_BUDGET'), JSON.stringify(withFlag.findings))
      clock(90000)
      const over = await runJudge(mk(true))
      assert.equal(over.judge.status, 'FAIL')
      assert.deepEqual(over.findings.find((f) => f.code === 'OVER_BUDGET'), { code: 'OVER_BUDGET', elapsed_ms: 90000, budget_ms: HIDDEN_TRIGGER_BUDGET_MS })
      clock(75000)
      const plain = await runJudge(mk(false))
      assert.equal(plain.judge.status, 'FAIL')
      assert.deepEqual(plain.findings.find((f) => f.code === 'OVER_BUDGET'), { code: 'OVER_BUDGET', elapsed_ms: 75000, budget_ms: BUDGET_MS })
      assert.equal(plain.story.hidden_trigger, undefined)
    } finally {
      performance.now = realNow
    }
  })

  it('the flag exists only for judge, and judge --hidden-trigger still takes no --repo', async () => {
    const other = await main(['verify', '--hidden-trigger'])
    assert.equal(other.exit, EXIT.USAGE)
    const repo = await main(['judge', '--hidden-trigger', '--repo', '.'])
    assert.equal(repo.exit, EXIT.USAGE)
  })

  it('--text shows the measured hidden-trigger numbers only when they were recorded', async () => {
    const { b, flags } = hiddenFake()
    const run = b.cli
    b.cli = async (args) => { if (args[0] === 'run') flags.ran = true; return run(args) }
    const lines = judgeSummaryLines((await runScenario(b, { hiddenTrigger: true })).story)
    assert.ok(lines.includes('hidden trigger patches_release_sold_out: DATA LOSS, orders 12 -> 11'), lines.join('|'))
    assert.ok(lines.includes('hidden trigger safe alternative: SAFE, rows lost: 0 (orders 0)'), lines.join('|'))
    assert.equal(judgeSummaryLines({ hidden_trigger: { trigger: 'x', dangerous: {} } }).length, 0)
  })
})
