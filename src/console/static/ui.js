// Small DOM helpers. Every value is set as text or as a plain attribute; nothing is
// ever parsed as HTML, so SQL, agent notes and reasons cannot inject markup.

const EVENT = /^on[A-Z]/

/**
 * h('div', { class: 'x', onClick: fn, text: 'hi' }, child, 'text', [more])
 * Attributes named on<Event> become listeners; `text` sets textContent.
 */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue
    if (k === 'text') el.textContent = String(v)
    else if (k === 'class') el.className = v
    else if (EVENT.test(k)) el.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k === 'style' || k === 'innerHTML') throw new Error('not allowed: ' + k)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)))
  }
  return el
}

export const short = (hash, n = 12) => (typeof hash === 'string' ? hash.replace(/^sha256:/, '').slice(0, n) : '—')

export function fmtTime(iso) {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  return new Date(t).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')
}

export function pill(text, kind = '') {
  return h('span', { class: `pill ${kind}`, text })
}

export const verdictKind = (v) => (v === 'SAFE' ? 'ok' : ['THRESHOLD EXCEEDED', 'DATA LOSS', 'FAILED', 'LOGIC CHANGE', 'LOGIC BYPASS', 'INVARIANT VIOLATED', 'REQUIREMENT UNMET', 'UNVERIFIABLE'].includes(v) ? 'bad' : 'warn')

// Inline SVG icons, built with the DOM (no markup parsing, no external asset).
const SVG = 'http://www.w3.org/2000/svg'
const ICONS = {
  bolt: ['M13 2 4 14h6l-1 8 9-12h-6z'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  cross: ['M6 6l12 12M18 6 6 18'],
  copy: ['M9 9h10v11H9z', 'M5 15V4h10'],
  lock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  dash: ['M7 12h10'],
  spark: ['M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z'],
  eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z', 'M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z'],
  expand: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
  shield: ['M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z'],
  alert: ['M12 3l10 18H2z', 'M12 10v5', 'M12 18v.5'],
}
/** icon('bolt') -> an <svg> that takes its colour from the text colour around it. */
export function icon(name, label = '') {
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('class', `icon ${name}`)
  if (label) {
    svg.setAttribute('role', 'img')
    svg.setAttribute('aria-label', label)
  } else svg.setAttribute('aria-hidden', 'true')
  for (const d of ICONS[name] ?? []) {
    const path = document.createElementNS(SVG, 'path')
    path.setAttribute('d', d)
    svg.append(path)
  }
  return svg
}
/** A badge with an optional icon in front: tone is ok | warn | bad | fix | mute | info. */
export const badge = (text, tone = 'info', ico = null) => h('span', { class: `pill ${tone}` }, ico ? icon(ico) : null, text)
/** A short hash with a button that copies the full value. */
export function hashChip(full, shown = 14) {
  if (typeof full !== 'string') return h('span', { class: 'muted mono', text: '—' })
  const btn = h('button', { type: 'button', class: 'copy', 'aria-label': `Copy ${full}`, title: 'Copy the full hash' }, icon('copy'))
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(full)
      btn.setAttribute('title', 'Copied')
    } catch {
      btn.setAttribute('title', 'Copy failed: select the text instead')
    }
  })
  return h('span', { class: 'hash' }, h('code', { class: 'mono', title: full, text: short(full, shown) }), btn)
}
/** Loading, empty and error states share one look: kind is loading | empty | error. */
export function stateBox(kind, title, text, ...actions) {
  return h('div', { class: `statebox ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, h('h2', { text: title }), text ? h('p', { text }) : null, actions.length ? h('div', { class: 'row' }, actions) : null)
}

/** Line diff by longest common subsequence: [{ sign: ' ' | '-' | '+', text }]. */
export function lineDiff(a, b) {
  const x = String(a ?? '').replace(/\n$/, '').split('\n')
  const y = String(b ?? '').replace(/\n$/, '').split('\n')
  if (x.length * y.length > 400_000) return [...x.map((text) => ({ sign: '-', text })), ...y.map((text) => ({ sign: '+', text }))]
  const m = x.length
  const n = y.length
  const L = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (x[i] === y[j]) {
      out.push({ sign: ' ', text: x[i] })
      i++
      j++
    } else if (L[i + 1][j] >= L[i][j + 1]) out.push({ sign: '-', text: x[i++] })
    else out.push({ sign: '+', text: y[j++] })
  }
  while (i < m) out.push({ sign: '-', text: x[i++] })
  while (j < n) out.push({ sign: '+', text: y[j++] })
  return out
}

export function diffView(lines) {
  return h('div', { class: 'diff', role: 'region', 'aria-label': 'SQL difference' },
    lines.map((l) => h('div', { class: `ln ${l.sign === '-' ? 'rm' : l.sign === '+' ? 'add' : ''}` }, h('span', { class: 'sign', text: l.sign }), h('span', { text: l.text }))))
}

/** The SQL of a version as one text: each file under a comment with its path. */
export const sqlOf = (v) => (v?.files ?? []).map((f) => `-- ${f.path}\n${f.sql ?? '-- (not in the history archive)'}`).join('\n')

// ---- SQL as the readable artifact: highlighting, line numbers, copy, full width, compare ----

const SQL_KEYWORDS = new Set(('select from where and or not null is in as on update set insert into values delete create drop alter table trigger function ' +
  'replace or begin commit rollback returns return language plpgsql if exists then else end case when join left right inner outer group by order having limit ' +
  'distinct union all with cascade constraint primary key foreign references default check unique index view temp temporary grant revoke to enable disable ' +
  'execute procedure each row before after for declare perform raise exception truncate column add rename session_replication_role local true false').split(' '))

/** One line of SQL as tokens: comment | string | number | keyword | ident | punct | space. No markup is parsed. */
export function sqlTokens(line) {
  const out = []
  const re = /(--.*$)|('(?:[^']|'')*'?)|(\$[A-Za-z_]*\$)|(\b\d+(?:\.\d+)?\b)|("(?:[^"]|"")*"?)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|([^\sA-Za-z0-9_'"$-]+|-|\$)/g
  let m
  while ((m = re.exec(line)) !== null) {
    if (m[0] === '') {
      re.lastIndex++
      continue
    }
    const kind = m[1] ? 'comment' : m[2] || m[3] ? 'string' : m[4] ? 'number' : m[5] ? 'ident' : m[6] ? (SQL_KEYWORDS.has(m[6].toLowerCase()) ? 'keyword' : 'ident') : m[7] ? 'space' : 'punct'
    out.push({ kind, text: m[0] })
  }
  return out
}

const codeLine = (text) => sqlTokens(text).map((t) => (t.kind === 'space' || t.kind === 'punct' ? t.text : h('span', { class: `t-${t.kind}`, text: t.text })))

/** Copy a text to the clipboard, saying so on the button. */
function copyButton(getText, label = 'Copy SQL') {
  const btn = h('button', { type: 'button', class: 'ghost tool', 'aria-label': label }, icon('copy'), ` ${label}`)
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(getText())
      btn.replaceChildren(icon('check'), ' Copied')
    } catch {
      btn.replaceChildren(icon('cross'), ' Copy failed')
    }
  })
  return btn
}

/** A button that shows its panel over the whole width of the window; Escape or the button again closes it. */
function expandButton(panel) {
  const btn = h('button', { type: 'button', class: 'ghost tool', 'aria-pressed': 'false', 'aria-label': 'Show this SQL over the full width' }, icon('expand'), ' Full width')
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') !== 'true'
    btn.setAttribute('aria-pressed', on ? 'true' : 'false')
    if (on) panel.classList?.add('expanded')
    else panel.classList?.remove('expanded')
  })
  return btn
}

/**
 * SQL in a wide, scrollable panel: line numbers, highlighting, whitespace kept, Copy SQL and
 * Full width. Long lines scroll inside the panel; the page never gets wider.
 */
export function sqlView(text, { title = 'SQL', sub = '' } = {}) {
  const src = String(text ?? '').replace(/\n$/, '')
  const lines = src.split('\n')
  const body = h('div', { class: 'code', role: 'region', 'aria-label': title, tabindex: '0' },
    lines.map((l, i) => h('div', { class: 'ln' }, h('span', { class: 'no', 'aria-hidden': 'true', text: String(i + 1) }), h('span', { class: 'src' }, codeLine(l)))))
  const panel = h('div', { class: 'sqlpanel' })
  panel.append(h('div', { class: 'sqlbar' }, h('span', { class: 'sqltitle', text: title }), sub ? h('span', { class: 'muted mono', text: sub }) : null, h('span', { class: 'spacer' }), h('span', { class: 'muted', text: `${lines.length} line${lines.length === 1 ? '' : 's'}` }), copyButton(() => src), expandButton(panel)), body)
  return panel
}

/**
 * Two SQL texts compared: side by side (one scroll container, so both sides move together)
 * or as a unified diff. `ui` keeps the chosen mode across re-renders.
 */
export function sqlCompare(a, b, { left = 'Left', right = 'Right', ui = {}, key = 'sqlMode' } = {}) {
  const ops = lineDiff(a, b)
  const panel = h('div', { class: 'sqlpanel compare' })
  const body = h('div', { class: 'code', role: 'region', 'aria-label': `SQL: ${left} against ${right}`, tabindex: '0' })
  const side = () => {
    // Pair a run of removed lines with the following run of added lines, row by row.
    const rows = []
    let i = 0
    let ln = 0
    let rn = 0
    while (i < ops.length) {
      if (ops[i].sign === ' ') {
        rows.push([{ no: ++ln, text: ops[i].text, kind: '' }, { no: ++rn, text: ops[i].text, kind: '' }])
        i++
        continue
      }
      const rm = []
      const add = []
      while (i < ops.length && ops[i].sign === '-') rm.push(ops[i++].text)
      while (i < ops.length && ops[i].sign === '+') add.push(ops[i++].text)
      for (let k = 0; k < Math.max(rm.length, add.length); k++) {
        rows.push([k < rm.length ? { no: ++ln, text: rm[k], kind: 'rm' } : null, k < add.length ? { no: ++rn, text: add[k], kind: 'add' } : null])
      }
    }
    const cell = (c) => (c ? h('div', { class: `cell ${c.kind}` }, h('span', { class: 'no', 'aria-hidden': 'true', text: String(c.no) }), h('span', { class: 'src' }, codeLine(c.text))) : h('div', { class: 'cell blank' }))
    return h('div', { class: 'sbs' }, h('div', { class: 'sbs-head' }, h('div', { text: left }), h('div', { text: right })), rows.map(([l, r]) => h('div', { class: 'sbs-row' }, cell(l), cell(r))))
  }
  const unified = () => {
    let ln = 0
    return ops.map((o) => h('div', { class: `ln ${o.sign === '-' ? 'rm' : o.sign === '+' ? 'add' : ''}` }, h('span', { class: 'no', 'aria-hidden': 'true', text: o.sign === '+' ? '' : String(++ln) }), h('span', { class: 'sign', text: o.sign }), h('span', { class: 'src' }, codeLine(o.text))))
  }
  const btnSide = h('button', { type: 'button', class: 'ghost tool seg' }, 'Side by side')
  const btnUni = h('button', { type: 'button', class: 'ghost tool seg' }, 'Unified')
  const show = (mode) => {
    ui[key] = mode
    btnSide.setAttribute('aria-pressed', mode === 'side' ? 'true' : 'false')
    btnUni.setAttribute('aria-pressed', mode === 'unified' ? 'true' : 'false')
    body.replaceChildren(...[mode === 'side' ? side() : unified()].flat())
  }
  btnSide.addEventListener('click', () => show('side'))
  btnUni.addEventListener('click', () => show('unified'))
  const changed = ops.filter((o) => o.sign !== ' ').length
  panel.append(h('div', { class: 'sqlbar' }, h('span', { class: 'sqltitle', text: `SQL: ${left} → ${right}` }), h('span', { class: 'muted', text: `${changed} changed line${changed === 1 ? '' : 's'}` }), h('span', { class: 'spacer' }),
    h('span', { class: 'segs', role: 'group', 'aria-label': 'Comparison mode' }, btnSide, btnUni), copyButton(() => String(b ?? ''), 'Copy right SQL'), expandButton(panel)), body)
  show(ui[key] === 'unified' ? 'unified' : 'side')
  return panel
}
