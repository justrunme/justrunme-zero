/**
 * Console Home (D2.1): the recorded run, evidence integrity, the metrics fallback, the Home
 * screen and its navigation. The recorded run is the real export shipped in
 * demo/recorded-run; nothing here needs Docker or PostgreSQL.
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { startConsole } from '../src/console/server.js'
import { checkExport, openRecorded } from '../src/console/recorded.js'
import { readTestReport } from '../src/console/metrics.js'
import { evidenceSteps, experimentCards } from '../src/console/static/model.js'
import { leaks } from '../scripts/export-recorded-run.mjs'
import { findAll, hasClass, installFakeDom } from './support/fake-dom.js'

const SHIPPED = fileURLToPath(new URL('../demo/recorded-run', import.meta.url))
const STATIC = fileURLToPath(new URL('../src/console/static/', import.meta.url))
const A = 'mission-t25v2-a'
const B = 'mission-demo-b'

const tmps = []
const tmp = (p) => {
  const d = mkdtempSync(path.join(os.tmpdir(), p))
  tmps.push(d)
  return d
}
const text = (n) => n.textContent.replace(/\s+/g, ' ')
const tick = () => new Promise((r) => setTimeout(r, 0))
const fire = (el, type, ev = {}) => Promise.all((el.listeners[type] ?? []).map((fn) => fn({ preventDefault() {}, target: el, ...ev })))
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex')

let restoreDom
let rec // the shipped export, opened
let states // mission id -> state of the recorded run

before(async () => {
  restoreDom = installFakeDom()
  rec = openRecorded(SHIPPED)
  states = { [A]: await rec.api.state(A), [B]: await rec.api.state(B) }
})
after(() => {
  restoreDom?.()
  rec?.close()
  for (const d of tmps) rmSync(d, { recursive: true, force: true })
})

describe('Recorded Demo: a genuine signed run opened read only', () => {
  it('matches its manifest and every chain verifies without a workspace, Docker or PostgreSQL', () => {
    assert.equal(rec.available, true)
    assert.deepEqual(rec.integrity, { ok: true, problems: [] })
    for (const id of [A, B]) {
      assert.equal(states[id].verify.ok, true, `${id} verify`)
      assert.equal(states[id].verify.result.ok, true)
      assert.equal(states[id].story.result.chain_ok, true)
      assert.equal(states[id].story.result.history.ok, true)
    }
    assert.deepEqual(states[A].story.result.versions.map((v) => v.verdict), ['DATA LOSS', 'LOGIC BYPASS', 'SAFE'])
    assert.equal(states[A].approvals.result.requests.filter((q) => q.state === 'approved').length, 1)
  })

  it('every file the manifest lists is tracked by git, so a fresh clone can open the recorded run', (t) => {
    const r = spawnSync('git', ['ls-files', '--', 'demo/recorded-run'], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' })
    if (r.status !== 0) return t.skip('not a git checkout')
    const tracked = new Set(r.stdout.split('\n').filter(Boolean).map((p) => p.replace(/^demo\/recorded-run\//, '')))
    const manifest = JSON.parse(readFileSync(path.join(SHIPPED, 'manifest.json'), 'utf8'))
    const untracked = ['manifest.json', ...Object.keys(manifest.files)].filter((f) => !tracked.has(f))
    assert.deepEqual(untracked, [], 'a .gitignore rule must not drop part of the signed export')
  })

  it('the export holds no secret, no private key and no local path', () => {
    const manifest = JSON.parse(readFileSync(path.join(SHIPPED, 'manifest.json'), 'utf8'))
    for (const rel of Object.keys(manifest.files)) {
      assert.ok(!/operator\.key|approver|passphrase-file|\.enc$/.test(rel), `not exported: ${rel}`)
      assert.deepEqual(leaks(readFileSync(path.join(SHIPPED, rel), 'utf8')), [], rel)
    }
    assert.deepEqual(leaks(readFileSync(path.join(SHIPPED, 'manifest.json'), 'utf8')).filter((x) => x !== 'credential word'), [], 'the manifest words about a passphrase are prose, not a secret')
    assert.ok(manifest.provenance.missions[A].agent.includes('not written by a live agent'), 'the manifest says the agent was not live')
  })

  it('the privacy gate of the exporter names what it refuses', () => {
    assert.deepEqual(leaks('SELECT 1;'), [])
    assert.deepEqual(leaks('"passphrase_source":"stdin"'), [], 'a field name is not a secret')
    for (const [bad, why] of [[['', 'Users', 'someone', 'work'].join('/'), 'home directory'], [['', 'var', 'folders', 'ab'].join('/'), 'temp directory'], [['a.b', 'example.org'].join('@'), 'email address'], [['postgres:', '', 'u:p@h/db'].join('/'), 'connection string'], ['my password is x', 'credential word']]) {
      assert.ok(leaks(bad).includes(why), `${bad} -> ${why}`)
    }
    assert.ok(leaks('x /srv/private/thing', ['/srv/private']).length > 0, 'a path of this machine')
  })

  it('a changed, missing or extra file stops the recorded run before anything is shown as verified', () => {
    const copy = (name) => {
      const d = tmp(`jrm-rec-${name}-`)
      cpSync(SHIPPED, d, { recursive: true })
      return d
    }
    const changed = copy('changed')
    appendFileSync(path.join(changed, '.justrunme/missions', A, 'receipts.jsonl'), '\n')
    const c1 = checkExport(changed)
    assert.equal(c1.ok, false)
    assert.ok(c1.problems.some((p) => /file changed since the export: .*receipts\.jsonl/.test(p)), c1.problems.join(';'))
    const missing = copy('missing')
    rmSync(path.join(missing, 'operator.pub'))
    assert.ok(checkExport(missing).problems.includes('missing file: operator.pub'))
    const extra = copy('extra')
    writeFileSync(path.join(extra, 'notes.txt'), 'x')
    assert.ok(checkExport(extra).problems.includes('file not in the manifest: notes.txt'))
    const opened = openRecorded(changed)
    assert.equal(opened.available, true)
    assert.equal(opened.integrity.ok, false)
    assert.equal(opened.api, null, 'a changed export is never opened')
    assert.equal(checkExport(path.join(changed, 'nope')).ok, false)
  })

  it('a receipt altered AND re-listed in the manifest still fails: the signatures are checked, not the manifest alone', async () => {
    const d = tmp('jrm-rec-forged-')
    cpSync(SHIPPED, d, { recursive: true })
    const file = path.join(d, '.justrunme/missions', A, 'receipts.jsonl')
    const lines = readFileSync(file, 'utf8').trimEnd().split('\n')
    const r = JSON.parse(lines[2])
    r.verdict = r.verdict === 'allow' ? 'deny' : 'allow'
    lines[2] = JSON.stringify(r)
    writeFileSync(file, lines.join('\n') + '\n')
    const mf = path.join(d, 'manifest.json')
    const m = JSON.parse(readFileSync(mf, 'utf8'))
    m.files[`.justrunme/missions/${A}/receipts.jsonl`] = sha(file)
    writeFileSync(mf, JSON.stringify(m))
    const forged = openRecorded(d)
    assert.equal(forged.integrity.ok, true, 'the manifest was made to agree')
    const st = await forged.api.state(A)
    assert.notEqual(st.verify.result?.ok, true, 'but the chain does not verify')
    const cards = experimentCards({ [A]: st, [B]: states[B] }, m.provenance)
    assert.ok(cards.filter((c) => c.missing).length >= 2, 'no card claims a result from a chain that fails verify')
    assert.ok(!cards.find((c) => c.id === 'safe-execution' && !c.missing), 'Safe Execution is not shown')
    forged.close()
  })
})

describe('Console server: recorded and live side by side', () => {
  let c
  let empty
  const call = async (p, init = {}) => {
    const res = await fetch(`http://127.0.0.1:${c.port}${p}`, { ...init, headers: { Authorization: `Bearer ${c.token}`, ...(init.headers ?? {}) } })
    return { status: res.status, body: await res.json() }
  }
  before(async () => {
    empty = tmp('jrm-empty-ws-')
    c = await startConsole({ repoDir: empty, recordedDir: SHIPPED, testReportFile: path.join(empty, 'none.json') })
  })
  after(async () => c?.close())

  it('offers the recorded run when the working directory has no missions', async () => {
    const { body } = await call('/api/sources')
    assert.equal(body.live.available, false)
    assert.equal(body.recorded.available, true)
    assert.equal(body.recorded.label, 'RECORDED RUN · READ ONLY')
    assert.deepEqual(body.recorded.missions, [A, B])
    assert.ok(body.recorded.provenance.missions[B].limit.includes('grants'), 'the recovery check limit is stated')
    const live = await call('/api/missions')
    assert.deepEqual(live.body.missions, [], 'the live source stays empty; nothing recorded leaks into it')
  })

  it('serves the recorded missions with a verified chain, and refuses every write', async () => {
    const st = await call(`/api/state?source=recorded&mission=${A}`)
    assert.equal(st.body.verify.result.ok, true)
    const detail = await call(`/api/approvals/${st.body.approvals.result.requests.find((q) => q.state === 'approved').request_id}?source=recorded&mission=${A}`)
    assert.equal(detail.body.result.state, 'approved')
    assert.equal(detail.body.result.files[0].matches_now, true, 'the SQL of the request is part of the export')
    for (const route of ['approve', 'deny', 'undo']) {
      const r = await call(`/api/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${c.port}` }, body: JSON.stringify({ source: 'recorded', request_id: 'apr-0000000000000000', confirm: 'plan-000000000000', passphrase: 'x', reason: 'xxx', capture_id: 'cap-20260101000000-abcdef' }) })
      assert.equal(r.status, 403, route)
      assert.equal(r.body.error.code, 'RECORDED_READ_ONLY')
    }
    await assert.rejects(async () => rec.api.approve({}), { code: 'RECORDED_READ_ONLY' })
    await assert.rejects(async () => rec.api.undo({}), { code: 'RECORDED_READ_ONLY' })
    const bad = await call('/api/state?source=other')
    assert.equal(bad.status, 400)
  })

  it('reports an altered recorded run as altered, never as verified', async () => {
    const d = tmp('jrm-rec-altered-')
    cpSync(SHIPPED, d, { recursive: true })
    appendFileSync(path.join(d, 'operator.pub'), ' ')
    const c2 = await startConsole({ repoDir: empty, recordedDir: d })
    try {
      const get = async (p) => (await fetch(`http://127.0.0.1:${c2.port}${p}`, { headers: { Authorization: `Bearer ${c2.token}` } })).json()
      const s = await get('/api/sources')
      assert.equal(s.recorded.integrity.ok, false)
      assert.equal(s.recorded.provenance, null, 'nothing from the changed export is passed on')
      const st = await get(`/api/state?source=recorded&mission=${A}`)
      assert.equal(st.ok, false)
      assert.equal(st.error.code, 'RECORDED_ALTERED')
    } finally {
      await c2.close()
    }
  })

  it('without a recorded run installed the source says so', async () => {
    const c3 = await startConsole({ repoDir: empty, recordedDir: path.join(empty, 'absent') })
    try {
      const s = await (await fetch(`http://127.0.0.1:${c3.port}/api/sources`, { headers: { Authorization: `Bearer ${c3.token}` } })).json()
      assert.equal(s.recorded.available, false)
    } finally {
      await c3.close()
    }
  })
})

describe('Test metrics: only a verified report is shown', () => {
  const NOW = Date.parse('2026-11-20T12:00:00Z')
  const good = { schema: 1, passed: 10, failed: 0, skipped: 0, total: 10, commit: 'a'.repeat(40), dirty: false, finished_at: '2026-11-19T12:00:00Z', ci: null }
  const write = (o) => {
    const f = path.join(tmp('jrm-metrics-'), 'report.json')
    writeFileSync(f, typeof o === 'string' ? o : JSON.stringify(o))
    return f
  }
  it('missing, unreadable, inconsistent, future and stale reports yield no numbers', () => {
    assert.equal(readTestReport(path.join(os.tmpdir(), 'jrm-no-such-report.json'), NOW).state, 'missing')
    assert.equal(readTestReport(write('{not json'), NOW).state, 'invalid')
    assert.equal(readTestReport(write({ ...good, total: 11 }), NOW).state, 'invalid', 'counts must add up')
    assert.equal(readTestReport(write({ ...good, commit: 'abc' }), NOW).state, 'invalid')
    assert.equal(readTestReport(write({ ...good, finished_at: '2027-01-01T00:00:00Z' }), NOW).state, 'invalid', 'a future date')
    assert.equal(readTestReport(write({ ...good, passed: 0, total: 0 }), NOW).state, 'invalid', 'an empty run proves nothing')
    const old = readTestReport(write({ ...good, finished_at: '2026-09-01T00:00:00Z' }), NOW)
    assert.equal(old.state, 'stale')
    assert.equal(old.report, undefined)
  })
  it('a good report keeps its commit, time, source and failure count (a failing run is shown, not hidden)', () => {
    const ok = readTestReport(write(good), NOW)
    assert.equal(ok.state, 'ok')
    assert.deepEqual([ok.report.passed, ok.report.total, ok.report.source, ok.report.dirty], [10, 10, 'local', false])
    const failing = readTestReport(write({ ...good, passed: 9, failed: 1 }), NOW)
    assert.equal(failing.state, 'ok')
    assert.equal(failing.report.failed, 1)
    const ci = readTestReport(write({ ...good, ci: { provider: 'github-actions', run_url: 'https://github.com/o/r/actions/runs/1' } }), NOW)
    assert.equal(ci.report.source, 'ci')
    assert.equal(readTestReport(write({ ...good, ci: { provider: 'github-actions', run_url: 'javascript:alert(1)' } }), NOW).report.run_url, null, 'only a github.com link')
  })
})

describe('Home screen', () => {
  const screens = () => import('../src/console/static/home.js')
  const sources = (over = {}) => ({ live: { available: false, missions: 0 }, recorded: { available: true, label: 'RECORDED RUN · READ ONLY', integrity: { ok: true, problems: [] }, missions: [A, B], provenance: JSON.parse(readFileSync(path.join(SHIPPED, 'manifest.json'), 'utf8')).provenance }, ...over })
  const mk = (over = {}) => {
    const went = []
    const ctx = {
      ui: {},
      home: { sources: sources(), metrics: { state: 'missing', reason: 'no test report file' }, pending: 0, recStates: states, go: (...a) => went.push(a), receipt: (m, seq) => rec.api.receipt(String(seq), m), ...over },
    }
    return { ctx, went }
  }

  it('says what the product is, offers one real primary action and shows the evidence trail of the recorded run', async () => {
    const { homeScreen } = await screens()
    const { ctx, went } = mk()
    const root = homeScreen(ctx)
    const t = text(root)
    assert.ok(t.includes('BUILT FOR KIRO · AI AGENT EXECUTION SAFETY'))
    assert.ok(t.includes('Let Kiro write code.') && t.includes('JustRunMe checks what happens before it runs.'))
    assert.ok(t.includes('An execution safety layer for Kiro AI agents.'))
    assert.ok(t.includes('Rehearse. Run. Recover.'))
    assert.ok(!/Mission Control|Time Machine|Snapshot|Checkpoint|Rewind/.test(t), 'no banned name')
    const primary = findAll(root, (e) => e.tag === 'button' && hasClass(e, 'home-primary'))
    assert.equal(primary.length, 1, 'one primary action')
    assert.ok(text(primary[0]).includes('Get Started with Kiro'))
    await fire(primary[0], 'click')
    assert.deepEqual(went[0], ['live', '#/setup'], 'the primary action opens the onboarding')
    const cta = findAll(root, (e) => e.tag === 'button' && hasClass(e, 'home-secondary'))[0]
    assert.ok(text(cta).includes('Explore Verified Demo'))
    await fire(cta, 'click')
    assert.deepEqual(went[1], ['recorded', `#/missions/${A}`, A])
    assert.ok(t.includes('RECORDED RUN · READ ONLY'))
    const steps = findAll(root, (e) => hasClass(e, 'ts'))
    assert.deepEqual(steps.map((s) => text(findAll(s, (e) => hasClass(e, 'ts-label'))[0])), ['PROPOSED', 'DATA LOSS', 'LOGIC BYPASS', 'SAFE', 'APPROVED', 'EXECUTED', 'VERIFIED'])
    const detail = findAll(root, (e) => hasClass(e, 'trail-detail'))[0]
    await tick()
    await tick()
    assert.ok(text(detail).includes('1 protected row would be deleted') && text(detail).includes('orders: 3 → 2'))
    assert.ok(text(detail).includes('patches_release_sold_out'), 'the trigger name comes from the signed receipt')
    await fire(steps[2], 'click')
    assert.ok(text(detail).includes('work around database logic'), 'a click opens another step')
    assert.equal(ctx.ui.homeStep, 'v1', 'the chosen step is kept for the next render')
    const link = findAll(detail, (e) => e.tag === 'a')[0]
    await fire(link, 'click')
    assert.deepEqual(went.at(-1), ['recorded', `#/missions/${A}/denied`, A])
  })

  it('shows four experiment cards, each linking to its mission evidence, and the honest limit of the recovery check', async () => {
    const { homeScreen } = await screens()
    const { ctx, went } = mk()
    const root = homeScreen(ctx)
    const cards = findAll(root, (e) => hasClass(e, 'xcard'))
    assert.deepEqual(cards.map((c) => text(findAll(c, (e) => e.tag === 'h3')[0])), ['Hidden Trigger', 'Logic Bypass', 'Safe Execution', 'Recovery'])
    assert.ok(text(cards[0]).includes('DATA LOSS DETECTED') && text(cards[0]).includes('orders 3 → 2'))
    assert.ok(text(cards[2]).includes('0 protected rows lost') && text(cards[2]).includes('equals the rehearsal'))
    // Demo B's verification receipt predates the list of checks: shown as checks unknown, with the provenance limit.
    assert.ok(text(cards[3]).includes('RECOVERED · CHECKS UNKNOWN') && !text(cards[3]).includes('RECOVERED · VERIFIED'), text(cards[3]))
    assert.ok(text(cards[3]).includes('did not compare database grants'))
    assert.ok(hasClass(cards[3], 'warn'), 'not green')
    assert.ok(text(cards[3]).includes('only the resource types named in the mission contract'))
    for (const [i, [href, mission]] of [['impact', A], [`missions/${A}/denied`, A], [`missions/${A}/verified`, A], ['recovery', B]].entries()) {
      const a = findAll(cards[i], (e) => e.tag === 'a')[0]
      assert.equal(a.attrs.href, `#/${href}`)
      await fire(a, 'click')
      assert.deepEqual(went.at(-1), ['recorded', `#/${href}`, mission])
    }
    assert.ok(text(root).includes('How this run was recorded') && text(root).includes('not written by a live agent'), 'what was scripted is said on the page')
  })

  it('metrics: the fallback says "No verified test report"; a real report shows its counts, commit and source', async () => {
    const { homeScreen } = await screens()
    const none = text(homeScreen(mk().ctx))
    assert.ok(none.includes('No verified test report') && none.includes('no test report file'))
    assert.ok(!/\d+ \/ \d+/.test(none), 'no invented number')
    const report = { passed: 429, failed: 0, skipped: 0, total: 429, commit: 'ab'.repeat(20), finished_at: '2026-11-19T19:00:00Z', source: 'local', run_url: null, dirty: true }
    const shown = text(homeScreen(mk({ metrics: { state: 'ok', report } }).ctx))
    assert.ok(/429 \/ 429/.test(shown) && shown.includes('automated tests passing') && shown.includes('commit abababa'))
    assert.ok(shown.includes('local run with uncommitted changes'), 'a local, dirty run is not presented as CI')
    const failing = text(homeScreen(mk({ metrics: { state: 'ok', report: { ...report, passed: 428, failed: 1 } } }).ctx))
    assert.ok(failing.includes('1 automated test failing'))
    const stale = text(homeScreen(mk({ metrics: { state: 'stale', reason: 'the test report is 40 days old' } }).ctx))
    assert.ok(stale.includes('No verified test report') && stale.includes('40 days old'))
  })

  it('has no fake action: without a verified recording there is no demo button, and an altered one is flagged', async () => {
    const { homeScreen } = await screens()
    const none = homeScreen(mk({ sources: sources({ recorded: { available: false, integrity: { ok: false, problems: ['no recorded run found'] }, missions: [], provenance: null } }), recStates: {} }).ctx)
    assert.ok(text(findAll(none, (e) => e.tag === 'button' && hasClass(e, 'home-primary'))[0]).includes('Get Started with Kiro'), 'onboarding is real without a recording')
    assert.equal(findAll(none, (e) => e.tag === 'button' && text(e).includes('Explore Verified Demo')).length, 0, 'no demo button without a verified recording')
    assert.equal(findAll(none, (e) => hasClass(e, 'xcard')).length, 0, 'no card without evidence')
    assert.ok(text(none).includes('No verified recorded run'))
    const altered = homeScreen(mk({ sources: sources({ recorded: { available: true, integrity: { ok: false, problems: ['file changed since the export: operator.pub'] }, missions: [A, B], provenance: null } }), recStates: {} }).ctx)
    assert.ok(text(altered).includes('does not match its manifest') && text(altered).includes('operator.pub'))
    assert.equal(findAll(altered, (e) => e.tag === 'button' && text(e).includes('Explore Verified Demo')).length, 0)
    assert.equal(findAll(altered, (e) => hasClass(e, 'xcard')).length, 0)
  })

  it('before the API has answered (or when it refused the token) Home never claims that nothing exists', async () => {
    const { homeScreen } = await screens()
    const root = homeScreen(mk({ sources: null, metrics: null, recStates: {} }).ctx)
    const t = text(root)
    assert.ok(t.includes('The Console API has not answered yet'), t)
    assert.ok(!t.includes('No verified recorded run') && !t.includes('No verified test report'), 'no absence is claimed from a failed read')
    assert.equal(findAll(root, (e) => e.tag === 'button' && text(e).includes('Explore Verified Demo')).length, 0)
    const app = readFileSync(path.join(STATIC, 'app.js'), 'utf8')
    assert.match(app, /if \(loadError\) \{/, 'every screen checks the load error first')
    assert.match(app, /e\.status === 401/, 'a refused token has its own message')
    assert.match(app, /console token is no longer valid/)
    assert.match(readFileSync(path.join(STATIC, 'index.html'), 'utf8'), /rel="icon" href="data:,"/, 'no favicon request that ends in 404')
  })

  it('a live mission that needs a decision gets a banner that opens the Approval Center; with none there is no banner', async () => {
    const { homeScreen } = await screens()
    assert.equal(findAll(homeScreen(mk().ctx), (e) => hasClass(e, 'home-pending')).length, 0)
    const { ctx, went } = mk({ pending: 1, sources: sources({ live: { available: true, missions: 1 } }) })
    const root = homeScreen(ctx)
    const banner = findAll(root, (e) => hasClass(e, 'home-pending'))[0]
    assert.ok(text(banner).includes('1 mission needs your decision') && text(banner).includes('Review & Decide'))
    await fire(banner, 'click')
    assert.deepEqual(went.at(-1), ['live', '#/approvals'])
  })
})

describe('Evidence steps and navigation', () => {
  it('every step and card link is a route the Console has', () => {
    const route = /^(impact|recovery|approvals|missions\/mission-[a-z0-9-]+\/(proposed|rehearsed|denied|repaired|approved|executed|verified))$/
    for (const s of evidenceSteps(states[A].story.result, A)) assert.match(s.href, route, s.id)
    for (const c of experimentCards(states, null).filter((x) => !x.missing)) assert.match(c.href, route, c.id)
  })
  it('steps follow the chain: a plan that was never approved shows no approval or run', () => {
    const story = structuredClone(states[A].story.result)
    story.requests = []
    story.runs = []
    const labels = evidenceSteps(story, A).map((s) => s.label)
    assert.deepEqual(labels, ['PROPOSED', 'DATA LOSS', 'LOGIC BYPASS', 'SAFE'])
  })
  it('the shell has a Home tab first, opens on Home, offers keys 1 to 8, and keeps scroll and open panels on a refresh', () => {
    const html = readFileSync(path.join(STATIC, 'index.html'), 'utf8')
    const tabs = [...html.matchAll(/data-screen="(\w+)"/g)].map((m) => m[1])
    assert.deepEqual(tabs, ['home', 'missions', 'impact', 'approvals', 'recovery', 'evidence', 'proof', 'setup'])
    assert.match(html, /id="sourcebar"/)
    const app = readFileSync(path.join(STATIC, 'app.js'), 'utf8')
    assert.match(app, /screen: 'home', arg: null/, 'an unknown route is Home')
    assert.match(app, /const ORDER = \['home', 'missions', 'impact', 'approvals', 'recovery', 'evidence', 'proof', 'setup'\]/)
    assert.match(app, /n >= 1 && n <= ORDER\.length/)
    assert.match(app, /render\(\{ keep: true \}\)/, 'the poll re-renders with the view state kept')
    assert.match(app, /window\.scrollTo\(0, s\.y\)/)
    assert.match(app, /details\[open\] > summary/)
  })
  it('the Home files load nothing from outside and respect reduced motion', () => {
    const css = readFileSync(path.join(STATIC, 'style.css'), 'utf8')
    assert.ok(!/url\(|@import|https?:\/\//.test(css.replace(/https?:\/\/www\.w3\.org/g, '')), 'no external resource in the css')
    for (const f of ['home.js', 'app.js']) assert.ok(!/https?:\/\/|import\(['"]http/.test(readFileSync(path.join(STATIC, f), 'utf8').replace(/https:\/\/github\.com\//g, '')), f)
    assert.match(css, /prefers-reduced-motion: reduce/)
  })
})
