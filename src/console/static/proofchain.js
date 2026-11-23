// Proof chain: the hidden-trigger story of `justrunme judge --hidden-trigger` in five steps,
// DATA LOSS detected, DENIED, SAFE plan, RECOVERED, VERIFIED. Every value comes from the saved
// judge report the Console was started with (`console --judge-report <file>`): the fields of
// result.story.hidden_trigger, result.counts and result.judge, and the status of each judge step
// in result.steps. A field the report does not hold shows "unavailable" and its step is never
// green; a failed judge step is red. Nothing here holds a number of its own.
import { h, icon, stateBox } from './ui.js'

export const UNAVAILABLE = 'unavailable'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const int = Number.isInteger
const str = (v) => typeof v === 'string' && v !== ''
/** The table counts of a rows_lost object, only when every one is an integer. */
const counts = (v) => (isObj(v) && Object.keys(v).length > 0 && Object.values(v).every(int) ? Object.entries(v) : null)
const lostText = (n) => (n === 1 ? 'an order lost' : `${n} orders lost`)

/** The judge steps a proof step rests on, each with the status the report records. */
function judgeSteps(report, ids) {
  const list = Array.isArray(report?.steps) ? report.steps : []
  return ids.map((id) => {
    const s = list.find((x) => isObj(x) && x.id === id)
    return { id, status: ['passed', 'failed', 'skipped'].includes(s?.status) ? s.status : UNAVAILABLE }
  })
}

/**
 * Tone of a step: red when a judge step failed or a value contradicts the step; green only when
 * every field is there, every judge step passed and the values say what the step claims.
 */
function toneOf(fieldsOk, judged, expected) {
  if (judged.some((j) => j.status === 'failed')) return 'bad'
  if (!fieldsOk) return 'mute'
  if (!expected) return 'bad'
  return judged.every((j) => j.status === 'passed') ? 'ok' : 'mute'
}

function step(key, label, ids, report, read) {
  const judged = judgeSteps(report, ids)
  const r = read()
  const tone = toneOf(r !== null, judged, r?.expected === true)
  return r === null
    ? { key, label, tone, value: UNAVAILABLE, facts: [], judged }
    : { key, label, tone, value: r.value, facts: r.facts, judged }
}

/** The five steps, from a judge report (the `result` of the judge output). */
export function proofChain(report) {
  const ht = report?.story?.hidden_trigger
  const d = ht?.dangerous
  const safe = ht?.safe
  const sel = ht?.selection
  const undo = ht?.undo
  const c = report?.counts
  const j = report?.judge
  return [
    step('loss', 'DATA LOSS detected', ['hidden_rehearse_dangerous'], report, () => {
      const t = d?.trigger_fired
      if (!str(d?.verdict) || !int(d?.orders_before) || !int(d?.orders_after) || !isObj(t) || !str(t.trigger)) return null
      const lost = d.orders_before - d.orders_after
      return {
        value: `orders ${d.orders_before} → ${d.orders_after}`,
        facts: [lost > 0 ? lostText(lost) : `${lost} orders lost`, `verdict ${d.verdict}`, `trigger ${t.trigger}`],
        expected: d.verdict === 'DATA LOSS' && lost > 0,
      }
    }),
    step('denied', 'DENIED', ['hidden_deny'], report, () => {
      if (!str(ht?.denied?.error)) return null
      return { value: ht.denied.error, facts: ['the real run is blocked'], expected: ht.denied.error === 'DATA_LOSS' }
    }),
    step('safe', 'SAFE plan', ['hidden_rehearse_safe', 'hidden_compare'], report, () => {
      const rows = counts(safe?.rows_lost)
      if (!str(safe?.verdict) || rows === null || !int(safe.rows_lost.orders) || !str(sel?.recommended)) return null
      return {
        value: `${safe.rows_lost.orders} lost`,
        facts: [`verdict ${safe.verdict}`, ...rows.map(([t, n]) => `${t} ${n} lost`), `recommended ${sel.recommended}`],
        expected: safe.verdict === 'SAFE' && rows.every(([, n]) => n === 0),
      }
    }),
    step('recovered', 'RECOVERED', ['hidden_undo'], report, () => {
      if (!str(undo?.status) || !str(undo?.verification)) return null
      return { value: undo.status, facts: [`recovery verification ${undo.verification}`], expected: undo.status === 'RECOVERED' && undo.verification === 'PASS' }
    }),
    step('verified', 'VERIFIED', ['verify', 'offline_verify'], report, () => {
      if (!int(c?.receipts_verified) || !int(c?.mismatches) || !str(j?.status)) return null
      return {
        value: `${c.receipts_verified} receipts verified / ${c.mismatches} mismatches`,
        facts: [`judge ${j.status}`],
        expected: c.mismatches === 0 && c.receipts_verified > 0 && j.status === 'PASS',
      }
    }),
  ]
}

const ICON = { ok: 'check', bad: 'cross', mute: 'dash' }
const STATUS_TONE = { passed: 'ok', failed: 'bad' }

/** One step: a header button (number, icon, status, value) that expands the facts below it. */
function stepView(s, i) {
  const li = h('li', { class: `pc-step ${s.tone}`, 'data-step': s.key })
  const detailId = `pc-detail-${s.key}`
  const toggle = h('button', {
    type: 'button',
    class: 'pc-head-row',
    'aria-expanded': 'false',
    'aria-controls': detailId,
    onClick: () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true'
      toggle.setAttribute('aria-expanded', String(open))
      li.className = `pc-step ${s.tone}${open ? ' open' : ''}`
    },
  },
  h('span', { class: 'pc-n', text: String(i + 1) }),
  h('span', { class: 'pc-ico' }, icon(ICON[s.tone] ?? 'dash')),
  h('span', { class: 'pc-label', text: s.label }),
  h('span', { class: 'pc-value', text: s.value }),
  h('span', { class: 'pc-chev', 'aria-hidden': 'true' }))
  li.append(toggle,
    h('div', { class: 'pc-detail', id: detailId },
      ...s.facts.map((f) => h('span', { class: 'pc-fact', text: f })),
      ...s.judged.map((j) => h('span', { class: `pc-judge ${STATUS_TONE[j.status] ?? 'mute'}`, 'data-judge': j.id, text: `${j.id}: ${j.status}` }))))
  return li
}

function stepsView(steps) {
  return h('ol', { class: 'pc-steps', 'aria-label': 'Proof chain' }, steps.map(stepView))
}

/**
 * The screen. `ctx.judge` is what GET /api/judge-report returned: { state, file, reason, report },
 * or { state: 'error', reason } when the Console could not read it.
 */
export function proofChainScreen(_state, ctx) {
  const jr = ctx?.judge
  if (!jr) return stateBox('loading', 'Reading the judge report…', '')
  if (jr.state === 'none') {
    return stateBox('empty', 'No judge report is loaded',
      'Save a judge run and open it here: node src/cli/index.js judge --hidden-trigger > judge.json, then node src/cli/index.js console --judge-report judge.json')
  }
  if (jr.state !== 'loaded' || !isObj(jr.report)) {
    return stateBox('error', 'The judge report cannot be shown', jr.reason ?? 'the judge report is not readable')
  }
  const steps = proofChain(jr.report)
  const j = jr.report.judge
  const overall = str(j?.status) ? j.status : UNAVAILABLE
  const elapsed = int(j?.elapsed_ms) ? `${(j.elapsed_ms / 1000).toFixed(1)} s` : null
  return h('div', { class: 'proofchain' },
    h('div', { class: 'pc-head' },
      h('h1', { text: 'Proof chain' }),
      h('span', { class: `pc-overall ${overall === 'PASS' && steps.every((s) => s.tone === 'ok') ? 'ok' : overall === 'FAIL' ? 'bad' : 'mute'}`, 'data-overall': '', text: `judge ${overall}` }),
      h('span', { class: 'pc-source muted', text: [jr.file ? `from ${jr.file}` : null, elapsed].filter(Boolean).join(' · ') })),
    jr.report.story?.hidden_trigger && comparisonView(jr.report, steps),
    stepsView(steps))
}

function comparisonView(report, steps) {
  const loss = steps.find((s) => s.key === 'loss')
  const denied = steps.find((s) => s.key === 'denied')
  const hidden = report.story.hidden_trigger
  const run = hidden.run
  const copyResult = hidden.dangerous?.order_2_missing === true ? loss.value + ' · Order #2 disappeared' : loss.value
  const cancelled = run?.ok === true && run.order_2_status === 'cancelled'
    && judgeSteps(report, ['hidden_run'])[0].status === 'passed'
  function card(label, detail, tone) {
    return h('div', { class: 'pc-comparison-card' },
      h('strong', { text: label }), h('span', { class: tone, text: detail }))
  }
  return h('section', { class: 'pc-comparison', 'aria-label': 'Hidden-trigger run at a glance' },
    card('Rehearsal copy', loss.tone === 'ok' ? copyResult : 'Order loss unconfirmed', ''),
    card('Target database', denied.tone === 'ok' ? 'Dangerous plan blocked before execution' : 'Denial unconfirmed', ''),
    card('After the approved run', cancelled ? 'Order #2 · cancelled, not deleted' : 'Order #2 status unavailable', ''))
}
