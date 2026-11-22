// Console shell: token, API calls, routing, refresh, and the missions of the workspace.
// The token arrives in the URL fragment (#token=...), is kept in sessionStorage for
// this tab only, and is removed from the address bar at once.
//
// Two sources: the live workspace (reads and approvals) and the recorded run (a signed
// export, read only). Home is the entry point; the other screens work on one source at a time.

import { badge, h, stateBox } from './ui.js'
import { approvalsScreen, impactScreen, missionsScreen, noticeBar, recoveryScreen } from './screens.js'
import { homeScreen } from './home.js'
import { setupScreen } from './onboarding.js'
import { evidenceScreen } from './evidence.js'
import { proofChainScreen } from './proofchain.js'

const SCREENS = {
  home: (state, ctx) => homeScreen(ctx),
  setup: (state, ctx) => setupScreen(ctx),
  missions: missionsScreen,
  impact: impactScreen,
  approvals: approvalsScreen,
  recovery: recoveryScreen,
  evidence: evidenceScreen,
  proof: proofChainScreen,
}
const KEY = 'justrunme-console-token'

// #token=<hex> or #/<route>&token=<hex>
const fromHash = /token=([0-9a-f]{64})/.exec(location.hash)
if (fromHash) {
  sessionStorage.setItem(KEY, fromHash[1])
  // Keep the route (#/missions/<id>/<node>) and drop only the token.
  const route = /^#\/(\w+(?:\/[\w.-]+){0,2})/.exec(location.hash)?.[1]
  history.replaceState(null, '', `/#/${route && SCREENS[route.split('/')[0]] ? route : 'home'}`)
}
const token = sessionStorage.getItem(KEY)

/** An API error that keeps its code, so a refused token is not shown as missing data. */
class ApiError extends Error {
  constructor(code, message, status) {
    super(code ? `${code}: ${message}` : message)
    this.code = code
    this.status = status
  }
}

async function raw(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(data?.error?.code ?? null, data?.error?.message ?? `HTTP ${res.status}`, res.status)
  return data
}

const view = document.getElementById('view')
const chainstate = document.getElementById('chainstate')
const picker = document.getElementById('missionpick')
const sourcebar = document.getElementById('sourcebar')
const ui = { source: 'live' }
const empty = () => ({ list: [], next: {}, single: null, error: null })
const store = { live: empty(), recorded: empty() }
let sources = null // what each source offers (GET /api/sources)
let metrics = null // the test report, or why there is none
let judge = null // the saved judge report of the Proof chain screen (GET /api/judge-report), or why there is none
let lastText = ''
let setup = null // { mode: 'live' | 'recorded', status, error } for the Setup screen
let loadError = null // why the Console API could not be read; while set, no screen shows data or its absence

/** The data of the source the current screen works on. */
const S = () => store[ui.source] ?? store.live
const missionsOf = () => S().list
const statesOf = () => S().next

/** #/<screen>[/<arg>[/<sub>]]: for Missions, arg is the mission id and sub is a Flight Recorder node. */
const routeOf = () => {
  const m = /^#\/(\w+)(?:\/([\w.-]+))?(?:\/(\w+))?/.exec(location.hash)
  return m && SCREENS[m[1]] ? { screen: m[1], arg: m[2] ?? null, sub: m[3] ?? null } : { screen: 'home', arg: null, sub: null }
}

const pendingOf = (st) => st?.approvals?.result?.requests?.filter((q) => q.state === 'pending').length ?? 0
const livePending = () => store.live.list.reduce((n, m) => n + pendingOf(store.live.next[m.mission_id]), 0)

/** The mission the other screens show: the opened one, the picked one, one waiting for approval, or the first. */
function current() {
  const r = routeOf()
  const ids = missionsOf().map((m) => m.mission_id)
  const states = statesOf()
  if (r.screen === 'missions' && r.arg && ids.includes(r.arg)) ui.mission = r.arg
  if (ui.mission && ids.includes(ui.mission)) return ui.mission
  return ids.find((id) => pendingOf(states[id]) > 0) ?? ids.find((id) => states[id]?.story?.ok) ?? ids[0] ?? null
}

/** The API, scoped to the current source and mission: GET with ?mission=, POST with { mission }. */
function api(path, opts = {}) {
  const m = current()
  const rec = ui.source === 'recorded'
  if (opts.body) return raw(path, { ...opts, body: { ...opts.body, ...(m ? { mission: m } : {}), ...(rec ? { source: 'recorded' } : {}) } })
  const q = [m ? `mission=${encodeURIComponent(m)}` : null, rec ? 'source=recorded' : null].filter(Boolean).join('&')
  return raw(q ? `${path}${path.includes('?') ? '&' : '?'}${q}` : path, opts)
}

function renderChainState(state) {
  const v = state?.verify
  const s = state?.story?.result
  const pills = []
  if (v?.result) {
    const chainOk = v.result.chain_findings.length === 0
    pills.push(badge(chainOk ? `chain verified · ${v.result.receipts}` : 'chain does not verify', chainOk ? 'ok' : 'bad', chainOk ? 'bolt' : 'cross'))
    const other = v.result.policy_findings.length + v.result.selections.filter((x) => !x.ok).length
    if (chainOk && other > 0) pills.push(h('a', { href: '#/recovery', class: 'pill bad', text: `${other} policy finding${other === 1 ? '' : 's'}` }))
  } else if (v?.error) pills.push(badge(v.error.code, 'mute'))
  if (s?.history) pills.push(badge(s.history.ok ? 'history intact' : 'history altered', s.history.ok ? 'ok' : 'bad', s.history.ok ? 'check' : 'cross'))
  const pending = ui.source === 'live' ? livePending() : 0
  if (pending > 0) pills.push(h('a', { href: '#/approvals', class: 'pill warn pulse', text: `${pending} awaiting approval` }))
  chainstate.replaceChildren(...pills)
}

function renderPicker(cur) {
  if (!picker) return
  const list = missionsOf()
  const states = statesOf()
  picker.parentElement.hidden = list.length < 2
  picker.replaceChildren(...list.map((m) => h('option', { value: m.mission_id, selected: m.mission_id === cur, text: `${m.mission_id}${pendingOf(states[m.mission_id]) ? ' · needs approval' : ''}` })))
}

/** The strip under the header: which source this screen shows, and the way back. */
function renderSourceBar(home) {
  if (!sourcebar) return
  if (home || ui.source !== 'recorded') {
    sourcebar.hidden = true
    sourcebar.replaceChildren()
    return
  }
  const back = h('button', { type: 'button', class: 'ghost', text: sources?.live?.available ? 'Switch to the live workspace' : 'Back to Home' })
  back.addEventListener('click', () => go(sources?.live?.available ? 'live' : 'recorded', sources?.live?.available ? '#/missions' : '#/home'))
  sourcebar.hidden = false
  sourcebar.replaceChildren(h('span', { class: 'rec-badge' }, 'RECORDED RUN · READ ONLY'), h('span', { class: 'muted', text: 'A genuine signed run, opened without Docker or PostgreSQL. Approve, Reject and Undo are not available here.' }), h('span', { class: 'spacer' }), back)
}

/** Open a screen of one source: the other source's missions are not the ones the picker lists. */
function go(source, hash, mission = null) {
  ui.source = source
  ui.pickedSource = true
  ui.mission = mission
  ui.request = null
  ui.notice = null
  if (location.hash === hash) render()
  else location.hash = hash
}

/** What a poll must not undo: scroll position, opened <details> and expanded SQL panels. */
function viewState() {
  return {
    y: window.scrollY,
    open: [...view.querySelectorAll('details[open] > summary')].map((s) => s.textContent),
    expanded: [...view.querySelectorAll('.sqlpanel')].map((p) => p.classList.contains('expanded')),
  }
}
function restoreViewState(s) {
  for (const d of view.querySelectorAll('details')) if (s.open.includes(d.querySelector('summary')?.textContent)) d.setAttribute('open', '')
  view.querySelectorAll('.sqlpanel').forEach((p, i) => p.classList.toggle('expanded', s.expanded[i] === true))
  window.scrollTo(0, s.y)
}

function render({ keep = false } = {}) {
  const r = routeOf()
  const home = r.screen === 'home' || r.screen === 'setup'
  const kept = keep ? viewState() : null
  for (const a of document.querySelectorAll('.tabs a')) a.classList.toggle('active', a.dataset.screen === r.screen)
  document.body.classList.toggle('is-home', home)
  renderSourceBar(home || r.screen === 'proof')
  if (!token) {
    view.replaceChildren(stateBox('empty', 'No console token', 'Open the URL that `justrunme console` printed; it carries the token for this session.'))
    return
  }
  if (loadError) {
    chainstate.replaceChildren(badge('not connected', 'bad', 'cross'))
    picker.parentElement.hidden = true
    view.replaceChildren(loadErrorBox(loadError))
    return
  }
  const cur = current()
  const state = cur ? statesOf()[cur] : S().single
  const all = missionsOf().map((m) => ({ mission_id: m.mission_id, state: statesOf()[m.mission_id] })).filter((m) => m.state)
  const ctx = {
    api, reload, rerender: render, ui, route: r, all, mission: cur, readOnly: ui.source === 'recorded', setup, titles: titlesOf(), judge,
    home: {
      sources, metrics, pending: livePending(), recStates: store.recorded.next, go, source: ui.source,
      receipt: (mission, seq) => raw(`/api/receipt/${seq}?mission=${encodeURIComponent(mission)}&source=recorded`),
    },
  }
  if (home) {
    chainstate.replaceChildren()
    picker.parentElement.hidden = true
    view.replaceChildren(SCREENS[r.screen](null, ctx))
    if (r.screen === 'setup' && setup === null) loadSetup()
  } else if (r.screen === 'proof') {
    // The Proof chain reads only the saved judge report, never the missions of a source.
    chainstate.replaceChildren()
    picker.parentElement.hidden = true
    view.replaceChildren(SCREENS.proof(null, ctx))
  } else {
    if (!state) {
      chainstate.replaceChildren()
      if (S().error) view.replaceChildren(stateBox('error', 'The Console cannot read the missions', S().error))
      else view.replaceChildren(stateBox('empty', 'No missions here', ui.source === 'live' ? 'This workspace has no mission yet. Open Home to explore the recorded run.' : 'The recorded run has no such mission.', h('a', { href: '#/home', text: 'Back to Home' })))
      return
    }
    renderChainState(state)
    renderPicker(cur)
    if (ui.notice && ui.notice.mission !== cur) ui.notice = null // a mission switch ends the confirmation
    const note = noticeBar(ui.notice, state, ctx, cur)
    view.replaceChildren(...(note ? [note] : []), SCREENS[r.screen](state, ctx))
  }
  if (kept) restoreViewState(kept)
}

async function readSource(source) {
  const q = source === 'recorded' ? 'source=recorded' : ''
  const list = await raw(`/api/missions${q ? `?${q}` : ''}`)
  const next = {}
  const ids = list.missions.map((m) => m.mission_id)
  await Promise.all(ids.map(async (id) => {
    next[id] = await raw(`/api/state?mission=${encodeURIComponent(id)}${q ? `&${q}` : ''}`)
  }))
  return { list: list.missions, next, single: ids.length === 0 && source === 'live' ? await raw('/api/state') : null, error: null }
}

/** Mission titles: only the verified recorded run carries them (its manifest); live missions keep their ids. */
function titlesOf() {
  if (ui.source !== 'recorded' || !sources?.recorded?.integrity?.ok) return {}
  return Object.fromEntries(Object.entries(sources.recorded.provenance?.missions ?? {}).filter(([, m]) => typeof m?.title === 'string').map(([id, m]) => [id, m.title]))
}

/** Setup reads the live workspace only; with no workspace it stays informational and reads nothing. */
async function loadSetup() {
  if (!sources?.live?.available) {
    setup = { mode: 'recorded', status: null, error: null }
  } else {
    setup = { mode: 'live', status: null, error: null, loading: true }
    try {
      setup = { mode: 'live', status: await raw('/api/setup'), error: null }
    } catch (e) {
      setup = { mode: 'live', status: null, error: e.message }
    }
  }
  if (routeOf().screen === 'setup') render()
}

/** What the page says when the Console API cannot be read: never "no data", always the reason. */
function loadErrorBox(e) {
  const retry = h('button', { type: 'button', text: 'Try again' })
  retry.addEventListener('click', () => {
    view.replaceChildren(stateBox('loading', 'Loading…', 'Reading the missions from the signed chain.'))
    reload()
  })
  if (e.status === 401) {
    return stateBox('error', 'This page\'s console token is no longer valid', 'Every start of `justrunme console` makes a new token, so a tab opened before a restart is refused (401). Open the URL the Console printed last; nothing is shown until the API can be read.', retry)
  }
  return stateBox('error', 'The Console cannot read the missions', e.message, retry)
}

async function reload() {
  try {
    sources = await raw('/api/sources')
    metrics = await raw('/api/metrics').catch((e) => (e.status === 401 ? Promise.reject(e) : { state: 'invalid', reason: 'the test report could not be read' }))
    judge = await raw('/api/judge-report').catch((e) => (e.status === 401 ? Promise.reject(e) : { state: 'error', reason: `the judge report could not be read: ${e.message}`, report: null }))
    loadError = null
  } catch (e) {
    loadError = e
    render()
    return
  }
  // The live workspace is always read (as before); the recorded run is immutable, so once is enough.
  store.live = await readSource('live').catch((e) => ({ ...empty(), error: e.message }))
  if (sources.recorded.available && sources.recorded.integrity.ok && store.recorded.list.length === 0) {
    store.recorded = await readSource('recorded').catch((e) => ({ ...empty(), error: e.message }))
  }
  if (!ui.pickedSource) ui.source = sources.live.available || !(sources.recorded.available && sources.recorded.integrity.ok) ? 'live' : 'recorded'
  lastText = JSON.stringify(store.live)
  render()
}

/**
 * Refresh when the live chains changed. While the operator is typing, only a change of the
 * mission on screen re-renders it (a new request, report or state must reset the review box);
 * never while an approve, deny or undo is being submitted. The recorded run never changes.
 */
async function poll() {
  if (document.hidden || !token || ui.submitting || loadError) return
  const typing = [...view.querySelectorAll('input, textarea')].some((el) => (el.type === 'checkbox' ? el.checked : el.value !== '') || el === document.activeElement)
  try {
    const got = await readSource('live')
    const text = JSON.stringify(got)
    if (text === lastText) return
    const onLive = ui.source === 'live'
    const cur = onLive ? current() : null
    const mine = (x) => JSON.stringify([x?.story, x?.approvals])
    if (onLive && typing && mine(got.next[cur]) === mine(store.live.next[cur])) return
    if (ui.submitting) return
    store.live = got
    lastText = text
    if (onLive || routeOf().screen === 'home') render({ keep: true })
  } catch (e) {
    // A refused token stops the page from showing stale data; anything else: the next poll tries again.
    if (e?.status === 401 && !loadError) {
      loadError = e
      render()
    }
  }
}

// Keys 1 to 8 open the eight screens; Escape closes a SQL panel shown over the full width.
// Proof chain is also accessible via tab 7; the printed URL opens the saved report directly.
const ORDER = ['home', 'missions', 'impact', 'approvals', 'recovery', 'evidence', 'proof', 'setup']
document.addEventListener('keydown', (e) => {
  const t = e.target
  if (e.key === 'Escape') {
    for (const p of document.querySelectorAll('.sqlpanel.expanded')) {
      p.classList.remove('expanded')
      p.querySelector('[aria-pressed="true"][aria-label^="Show this SQL"]')?.setAttribute('aria-pressed', 'false')
    }
    return
  }
  if (e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName ?? '') || t?.isContentEditable) return
  const n = Number(e.key)
  if (n >= 1 && n <= ORDER.length) location.hash = `#/${ORDER[n - 1]}`
})

picker?.addEventListener('change', (e) => {
  ui.mission = e.target.value
  if (routeOf().screen === 'missions' && routeOf().arg) location.hash = `#/missions/${ui.mission}`
  else render()
})
window.addEventListener('hashchange', () => {
  view.focus({ preventScroll: true })
  render()
})
if (token) await reload()
else render()
setInterval(poll, 4000)
