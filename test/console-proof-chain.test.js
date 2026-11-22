/**
 * Proof chain screen: the five steps of the hidden-trigger story come only from the saved judge
 * report (`judge --hidden-trigger > file`, `console --judge-report file`). The fixture is the real,
 * unchanged stdout of one `judge --hidden-trigger` run. Every rendered value must equal its
 * field; a deleted field shows "unavailable" and is never green; a failed judge step is red; a
 * missing or malformed report file fails closed. Built with the fake DOM: words and classes, not layout.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadJudgeReport } from '../src/console/judgereport.js'
import { startConsole } from '../src/console/server.js'
import { findAll, hasClass, installFakeDom } from './support/fake-dom.js'

const FIXTURE = fileURLToPath(new URL('./fixtures/judge-hidden-trigger-report.json', import.meta.url))
const CLI = fileURLToPath(new URL('../src/cli/index.js', import.meta.url))
const ENVELOPE = JSON.parse(readFileSync(FIXTURE, 'utf8'))
const REPORT = ENVELOPE.result
const HT = REPORT.story.hidden_trigger

const dirs = []
const tmp = (p) => {
  const d = mkdtempSync(path.join(os.tmpdir(), p))
  dirs.push(d)
  return d
}
let restoreDom
let mod

before(async () => {
  restoreDom = installFakeDom()
  mod = await import('../src/console/static/proofchain.js')
})
after(() => {
  restoreDom?.()
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }))
})

const text = (n) => n.textContent.replace(/\s+/g, ' ')
const clone = (x) => structuredClone(x)
const by = (steps, key) => steps.find((s) => s.key === key)
const rowOf = (view, key) => findAll(view, (e) => e.getAttribute?.('data-step') === key)[0]
const loaded = (report) => ({ state: 'loaded', file: 'judge.json', reason: null, report })
const screen = (report) => mod.proofChainScreen(null, { judge: loaded(report) })
const greens = (view) => findAll(view, (e) => hasClass(e, 'ok'))

/** Delete the field at a dotted path (array elements by `steps[id]`) from a copy of the report. */
function without(report, p) {
  const r = clone(report)
  const parts = p.split('.')
  let o = r
  for (const k of parts.slice(0, -1)) o = stepOrKey(o, k)
  const last = parts.at(-1)
  const m = /^steps\[(\w+)\]$/.exec(last)
  if (m) o.steps = o.steps.filter((s) => s.id !== m[1])
  else delete o[last]
  return r
}
const stepOrKey = (o, k) => {
  const m = /^steps\[(\w+)\]$/.exec(k)
  return m ? o.steps.find((s) => s.id === m[1]) : o[k]
}

// Every field the screen reads, with the step that rests on it.
const FIELDS = [
  ['story.hidden_trigger.dangerous.verdict', 'loss'],
  ['story.hidden_trigger.dangerous.orders_before', 'loss'],
  ['story.hidden_trigger.dangerous.orders_after', 'loss'],
  ['story.hidden_trigger.dangerous.trigger_fired', 'loss'],
  ['story.hidden_trigger.dangerous.trigger_fired.trigger', 'loss'],
  ['story.hidden_trigger.dangerous', 'loss'],
  ['story.hidden_trigger.denied.error', 'denied'],
  ['story.hidden_trigger.denied', 'denied'],
  ['story.hidden_trigger.safe.verdict', 'safe'],
  ['story.hidden_trigger.safe.rows_lost', 'safe'],
  ['story.hidden_trigger.safe.rows_lost.orders', 'safe'],
  ['story.hidden_trigger.safe', 'safe'],
  ['story.hidden_trigger.selection.recommended', 'safe'],
  ['story.hidden_trigger.selection', 'safe'],
  ['story.hidden_trigger.undo.status', 'recovered'],
  ['story.hidden_trigger.undo.verification', 'recovered'],
  ['story.hidden_trigger.undo', 'recovered'],
  ['counts.receipts_verified', 'verified'],
  ['counts.mismatches', 'verified'],
  ['counts', 'verified'],
  ['judge.status', 'verified'],
  ['steps[hidden_rehearse_dangerous]', 'loss'],
  ['steps[hidden_rehearse_dangerous].status', 'loss'],
  ['steps[hidden_deny]', 'denied'],
  ['steps[hidden_deny].status', 'denied'],
  ['steps[hidden_rehearse_safe]', 'safe'],
  ['steps[hidden_rehearse_safe].status', 'safe'],
  ['steps[hidden_compare]', 'safe'],
  ['steps[hidden_compare].status', 'safe'],
  ['steps[hidden_undo]', 'recovered'],
  ['steps[hidden_undo].status', 'recovered'],
  ['steps[verify]', 'verified'],
  ['steps[verify].status', 'verified'],
  ['steps[offline_verify]', 'verified'],
  ['steps[offline_verify].status', 'verified'],
]

const UNAVAILABLE = () => mod.UNAVAILABLE

describe('Console Proof chain: the fixture is a real judge --hidden-trigger run', () => {
  it('holds the CLI envelope of a passing hidden-trigger judge run', () => {
    assert.equal(ENVELOPE.command, 'judge')
    assert.equal(typeof HT, 'object')
    for (const id of ['hidden_rehearse_dangerous', 'hidden_deny', 'hidden_rehearse_safe', 'hidden_compare', 'hidden_undo', 'verify', 'offline_verify']) {
      assert.ok(REPORT.steps.some((s) => s.id === id), `judge step ${id}`)
    }
  })
})

describe('Console Proof chain: values', () => {
  it('shows the five steps, every value equal to its field of the judge report', () => {
    const steps = mod.proofChain(REPORT)
    assert.deepEqual(steps.map((s) => s.label), ['DATA LOSS detected', 'DENIED', 'SAFE plan', 'RECOVERED', 'VERIFIED'])
    const d = HT.dangerous
    const lost = d.orders_before - d.orders_after
    const loss = by(steps, 'loss')
    assert.equal(loss.value, `orders ${d.orders_before} → ${d.orders_after}`)
    assert.ok(loss.facts.includes(lost === 1 ? 'an order lost' : `${lost} orders lost`))
    assert.ok(loss.facts.includes(`verdict ${d.verdict}`))
    assert.ok(loss.facts.includes(`trigger ${d.trigger_fired.trigger}`))
    assert.equal(by(steps, 'denied').value, HT.denied.error)
    const safe = by(steps, 'safe')
    assert.equal(safe.value, `${HT.safe.rows_lost.orders} lost`)
    assert.ok(safe.facts.includes(`verdict ${HT.safe.verdict}`))
    for (const [t, n] of Object.entries(HT.safe.rows_lost)) assert.ok(safe.facts.includes(`${t} ${n} lost`))
    assert.ok(safe.facts.includes(`recommended ${HT.selection.recommended}`))
    assert.equal(by(steps, 'recovered').value, HT.undo.status)
    assert.ok(by(steps, 'recovered').facts.includes(`recovery verification ${HT.undo.verification}`))
    assert.equal(by(steps, 'verified').value, `${REPORT.counts.receipts_verified} receipts verified / ${REPORT.counts.mismatches} mismatches`)
    assert.ok(by(steps, 'verified').facts.includes(`judge ${REPORT.judge.status}`))
    // Each step carries the status of its judge steps, as the report records them.
    for (const s of steps) for (const j of s.judged) assert.equal(j.status, REPORT.steps.find((x) => x.id === j.id).status, `${s.key}/${j.id}`)
  })

  it('in this real run every step passed, so all five are green', () => {
    const steps = mod.proofChain(REPORT)
    assert.deepEqual(steps.map((s) => s.tone), ['ok', 'ok', 'ok', 'ok', 'ok'])
  })

  it('renders every step on screen with the same text and tone, and the overall judge status', () => {
    const view = screen(REPORT)
    for (const s of mod.proofChain(REPORT)) {
      const row = rowOf(view, s.key)
      assert.ok(row, `row ${s.key}`)
      for (const t of [s.label, s.value, ...s.facts]) assert.ok(text(row).includes(t), `${s.key}: "${t}" in ${text(row)}`)
      for (const j of s.judged) {
        const chip = findAll(row, (e) => e.getAttribute?.('data-judge') === j.id)[0]
        assert.equal(text(chip), `${j.id}: ${j.status}`)
        assert.ok(hasClass(chip, j.status === 'passed' ? 'ok' : 'bad'))
      }
      assert.ok(hasClass(row, s.tone))
    }
    const overall = findAll(view, (e) => e.getAttribute?.('data-overall') !== null)[0]
    assert.equal(text(overall), `judge ${REPORT.judge.status}`)
    assert.ok(hasClass(overall, 'ok'))
    assert.match(text(rowOf(view, 'loss')), new RegExp(`orders ${HT.dangerous.orders_before} → ${HT.dangerous.orders_after}.*an order lost`))
  })
})

describe('Console Proof chain: a missing field is unavailable and never green', () => {
  for (const [field, key] of FIELDS) {
    it(`without ${field}`, () => {
      const r = without(REPORT, field)
      const s = by(mod.proofChain(r), key)
      assert.notEqual(s.tone, 'ok', `${key} must not be green`)
      const row = rowOf(screen(r), key)
      assert.ok(!hasClass(row, 'ok'), `${key} row must not be green`)
      assert.ok(text(row).includes(UNAVAILABLE()), `${key} shows "unavailable": ${text(row)}`)
    })
  }

  it('without story.hidden_trigger, all five story steps but VERIFIED are unavailable', () => {
    const r = without(REPORT, 'story.hidden_trigger')
    for (const s of mod.proofChain(r).filter((x) => x.key !== 'verified')) assert.deepEqual([s.value, s.tone === 'ok'], [UNAVAILABLE(), false])
  })

  it('an empty report shows five unavailable steps and nothing green', () => {
    const steps = mod.proofChain({})
    assert.ok(steps.every((s) => s.value === UNAVAILABLE() && s.tone !== 'ok'))
    const view = screen({})
    assert.equal(findAll(view, (e) => hasClass(e, 'pc-step')).length, 5)
    assert.ok(findAll(view, (e) => hasClass(e, 'pc-value')).every((e) => text(e) === UNAVAILABLE()))
    assert.equal(greens(view).length, 0)
  })

  it('a field of the wrong type counts as missing', () => {
    const r = clone(REPORT)
    r.story.hidden_trigger.dangerous.orders_before = String(HT.dangerous.orders_before)
    r.counts.mismatches = null
    r.story.hidden_trigger.safe.rows_lost = { orders: String(HT.safe.rows_lost.orders) }
    const steps = mod.proofChain(r)
    for (const k of ['loss', 'verified', 'safe']) assert.deepEqual([by(steps, k).value, by(steps, k).tone === 'ok'], [UNAVAILABLE(), false], k)
  })
})

describe('Console Proof chain: red', () => {
  const STEP_OF = { hidden_rehearse_dangerous: 'loss', hidden_deny: 'denied', hidden_rehearse_safe: 'safe', hidden_compare: 'safe', hidden_undo: 'recovered', verify: 'verified', offline_verify: 'verified' }
  for (const [id, key] of Object.entries(STEP_OF)) {
    it(`a failed judge step ${id} renders ${key} red`, () => {
      const r = clone(REPORT)
      r.steps.find((s) => s.id === id).status = 'failed'
      assert.equal(by(mod.proofChain(r), key).tone, 'bad')
      const row = rowOf(screen(r), key)
      assert.ok(hasClass(row, 'bad') && !hasClass(row, 'ok'))
      assert.ok(hasClass(findAll(row, (e) => e.getAttribute?.('data-judge') === id)[0], 'bad'))
    })
  }

  it('a skipped judge step is never green', () => {
    const r = clone(REPORT)
    r.steps.find((s) => s.id === 'hidden_undo').status = 'skipped'
    assert.notEqual(by(mod.proofChain(r), 'recovered').tone, 'ok')
  })

  it('values that contradict a step render red', () => {
    const cases = [
      ['loss', (r) => { r.story.hidden_trigger.dangerous.verdict = 'SAFE' }],
      ['loss', (r) => { r.story.hidden_trigger.dangerous.orders_after = r.story.hidden_trigger.dangerous.orders_before }],
      ['denied', (r) => { r.story.hidden_trigger.denied.error = 'OTHER' }],
      ['safe', (r) => { r.story.hidden_trigger.safe.rows_lost.orders += 1 }],
      ['recovered', (r) => { r.story.hidden_trigger.undo.verification = 'FAIL' }],
      ['verified', (r) => { r.counts.mismatches += 1 }],
      ['verified', (r) => { r.judge.status = 'FAIL' }],
    ]
    for (const [key, change] of cases) {
      const r = clone(REPORT)
      change(r)
      assert.equal(by(mod.proofChain(r), key).tone, 'bad', key)
    }
    const r = clone(REPORT)
    r.judge.status = 'FAIL'
    const overall = findAll(screen(r), (e) => e.getAttribute?.('data-overall') !== null)[0]
    assert.ok(hasClass(overall, 'bad'))
  })
})

describe('Console Proof chain: the report file fails closed', () => {
  it('loads the fixture envelope and the bare report alike', () => {
    const a = loadJudgeReport(FIXTURE)
    assert.equal(a.state, 'loaded')
    assert.deepEqual(a.report, REPORT)
    const bare = path.join(tmp('jrm-pc-'), 'bare.json')
    writeFileSync(bare, JSON.stringify(REPORT))
    assert.deepEqual(loadJudgeReport(bare).report, REPORT)
  })

  it('no flag: nothing loaded, and the screen says so', () => {
    const none = loadJudgeReport(undefined)
    assert.equal(none.state, 'none')
    const view = mod.proofChainScreen(null, { judge: none })
    assert.match(text(view), /No judge report is loaded/)
    assert.equal(greens(view).length, 0)
    assert.equal(findAll(view, (e) => hasClass(e, 'pc-step')).length, 0)
  })

  it('a missing, malformed or foreign file is invalid, with a reason, and shows nothing as verified', () => {
    const d = tmp('jrm-pc-bad-')
    const write = (name, body) => {
      const f = path.join(d, name)
      writeFileSync(f, body)
      return f
    }
    const bad = [
      path.join(d, 'missing.json'),
      d,
      write('empty.json', ''),
      write('truncated.json', readFileSync(FIXTURE, 'utf8').slice(0, 500)),
      write('array.json', '[]'),
      write('other.json', JSON.stringify({ command: 'verify', ok: true, result: REPORT })),
      write('failed.json', JSON.stringify({ command: 'judge', ok: false, exit_code: 2, error: { code: 'USAGE', message: 'x' } })),
      write('notjudge.json', JSON.stringify({ hello: 'world' })),
    ]
    for (const f of bad) {
      const r = loadJudgeReport(f)
      assert.equal(r.state, 'invalid', f)
      assert.equal(r.report, null)
      assert.ok(typeof r.reason === 'string' && r.reason.length > 0)
      assert.ok(!r.reason.includes(os.homedir()), 'no home path in the reason')
      const view = mod.proofChainScreen(null, { judge: r })
      assert.equal(greens(view).length, 0, `${f}: nothing green`)
      assert.equal(findAll(view, (e) => hasClass(e, 'pc-step')).length, 0)
      assert.ok(text(view).includes(r.reason))
    }
    // The Console could not read the report at all.
    const err = mod.proofChainScreen(null, { judge: { state: 'error', reason: 'the judge report could not be read', report: null } })
    assert.equal(greens(err).length, 0)
  })

  it('the API serves the loaded report read only; without a report it says none', async () => {
    const repoDir = tmp('jrm-pc-repo-')
    for (const [judgeReport, state] of [[loadJudgeReport(FIXTURE), 'loaded'], [undefined, 'none']]) {
      const c = await startConsole({ repoDir, recordedDir: path.join(repoDir, 'no-recorded'), judgeReport })
      try {
        const res = await fetch(`http://127.0.0.1:${c.port}/api/judge-report`, { headers: { Authorization: `Bearer ${c.token}` } })
        const body = await res.json()
        assert.equal(body.state, state)
        if (state === 'loaded') assert.deepEqual(body.report, REPORT)
        else assert.equal(body.report, null)
        const post = await fetch(`http://127.0.0.1:${c.port}/api/judge-report`, { method: 'POST', headers: { Authorization: `Bearer ${c.token}`, Origin: `http://127.0.0.1:${c.port}`, 'Content-Type': 'application/json' }, body: '{}' })
        assert.equal(post.status, 404, 'no write route')
      } finally {
        await c.close()
      }
    }
  })

  it('console --judge-report with a missing or malformed file refuses to start', async () => {
    const d = tmp('jrm-pc-cli-')
    const malformed = path.join(d, 'bad.json')
    writeFileSync(malformed, '{not json')
    for (const f of [path.join(d, 'missing.json'), malformed]) {
      const { code, out } = await runCli(['console', '--judge-report', f, '--repo', d])
      assert.notEqual(code, 0)
      const line = JSON.parse(out.trim().split('\n')[0])
      assert.deepEqual([line.ok, line.error.code], [false, 'JUDGE_REPORT_INVALID'])
    }
  })

  it('console --judge-report with the real report starts and names it', async () => {
    const d = tmp('jrm-pc-cli-ok-')
    const line = await firstLine(['console', '--judge-report', FIXTURE, '--repo', d, '--port', '0'])
    assert.equal(line.ok, true)
    assert.equal(line.result.judge_report, path.basename(FIXTURE))
    assert.match(line.result.proof_chain_url, /^http:\/\/127\.0\.0\.1:\d+\/#\/proof&token=[0-9a-f]{64}$/)
    assert.equal(line.result.proof_chain_url.split('token=')[1], line.result.url.split('token=')[1])
  })
})

function runCli(args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (b) => { out += b })
    const timer = setTimeout(() => p.kill('SIGKILL'), 20_000)
    p.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, out })
    })
  })
}

/** Start the long-running Console, read its first JSON line, then stop it. */
function firstLine(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const timer = setTimeout(() => {
      p.kill('SIGKILL')
      reject(new Error(`no start line: ${out}`))
    }, 20_000)
    p.stdout.on('data', (b) => {
      out += b
      const nl = out.indexOf('\n')
      if (nl < 0) return
      clearTimeout(timer)
      p.once('close', () => resolve(JSON.parse(out.slice(0, nl))))
      p.kill('SIGTERM')
    })
  })
}
