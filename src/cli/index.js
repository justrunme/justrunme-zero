#!/usr/bin/env node
/**
 * justrunme CLI (T18): JSON on stdout by default, `--text` for people, stable exit
 * codes (src/cli/codes.js). No colour codes are ever written. Output is redacted
 * (home paths, e-mail addresses, credential values) before it is printed.
 *
 *   justrunme keys init
 *   justrunme rehearse | authorize | run
 *   justrunme compare [plan_id ...]
 *   justrunme undo <capture_id> [--resource files|config_files|postgres|containers ...]
 *   justrunme verify | replay [--receipt <hash>] | status | receipt [--seq n]
 *   justrunme reanchor --reason "<text>"
 *   justrunme lock inspect | lock recover [--sha256 <hash>] --reason "<text>"
 *   justrunme approver init [--passphrase-stdin]
 *   justrunme approvals [request_id]
 *   justrunme approve <request_id> --confirm <plan_id> [--passphrase-stdin]
 *   justrunme deny <request_id> --reason "<text>"
 *   justrunme history                       # versions, approvals, runs and the links between them
 *   justrunme evidence                      # Gate Health, ProofDebt, recovery readiness (read only)
 *   justrunme gate-probe start|status|finish  # is the agent's session gated? (exit 0 ACTIVE, 34 INACTIVE, 35 UNKNOWN)
 *   justrunme chaos [--fault-after <n>]     # rehearse the recovery on a disposable twin (exit 0 RECOVERY PROVEN, else 36)
 *   justrunme judge [--hidden-trigger]      # one-command demo; the flag adds the hidden-trigger case (90 s budget)
 *   justrunme console [--port n]            # local Console on 127.0.0.1; keeps running
 * Common options: --repo <dir> (default: current directory), --mission <id>, --text.
 */

import { realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { redactDeep } from '../privacy/redact.js'
import { keyHome } from '../receipts/keys.js'
import { EXIT } from './codes.js'
import * as cmd from './commands.js'
import { JudgeEnvironmentError, createBackend } from '../judge/env.js'
import { runJudge } from '../judge/index.js'
import { evidenceCmd, gateProbeCmd } from './evidence-commands.js'
import { chaosCmd } from './chaos-command.js'

const MISSION_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/
const OPTIONS = {
  repo: { type: 'string' },
  mission: { type: 'string' },
  text: { type: 'boolean', default: false },
  reason: { type: 'string' },
  sha256: { type: 'string' },
  receipt: { type: 'string' },
  seq: { type: 'string' },
  resource: { type: 'string', multiple: true },
  plan: { type: 'string' },
  'passphrase-stdin': { type: 'boolean', default: false },
  'emergency-recovery': { type: 'boolean', default: false },
  'hidden-trigger': { type: 'boolean', default: false },
  confirm: { type: 'string' },
  'fault-after': { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
}

const USAGE = 'usage: justrunme <keys init|rehearse|compare|authorize|run|undo|verify|replay|status|receipt|reanchor|lock|judge|approver|approvals|approve|deny|history|evidence|gate-probe|chaos|console> [options]'

/**
 * `judge --hidden-trigger`: the default judge steps plus the hidden-trigger case, under its own
 * named budget (HIDDEN_TRIGGER_BUDGET_MS). Plain `judge` stays in commands.js and is not changed.
 */
async function judgeHiddenTrigger({ opts }) {
  if (opts.repo !== undefined || opts.mission !== undefined) throw new cmd.CliError(EXIT.USAGE, 'USAGE', 'judge builds its own workspace; it takes no --repo or --mission')
  let report
  try {
    report = await runJudge({ create: () => createBackend(), hiddenTrigger: true })
  } catch (err) {
    if (err instanceof JudgeEnvironmentError) throw new cmd.CliError(EXIT.JUDGE_ENVIRONMENT, err.code, err.message)
    throw err
  }
  return { exit: report.judge.status === 'PASS' ? EXIT.OK : EXIT.JUDGE_FAILED, result: report }
}

async function dispatch(command, rest, repoDir, opts) {
  const ctx = { repoDir, opts }
  switch (command) {
    case 'keys':
      if (rest[0] !== 'init') break
      return cmd.keysInit()
    case 'rehearse':
      return cmd.rehearseCmd(ctx)
    case 'compare':
      return cmd.compareCmd({ ...ctx, planIds: rest })
    case 'authorize':
      return cmd.authorizeCmd(ctx)
    case 'run':
      return cmd.runCmd(ctx)
    case 'undo':
      return cmd.undoCmd({ ...ctx, captureId: rest[0] })
    case 'verify':
      return cmd.verifyCmd(ctx)
    case 'replay':
      return cmd.replayCmd(ctx)
    case 'status':
      return cmd.statusCmd(ctx)
    case 'receipt':
      return cmd.receiptCmd(ctx)
    case 'reanchor':
      return cmd.reanchorCmd(ctx)
    case 'lock':
      return cmd.lockCmd({ ...ctx, action: rest[0] })
    case 'judge':
      return opts['hidden-trigger'] ? judgeHiddenTrigger(ctx) : cmd.judgeCmd(ctx)
    case 'approver':
      if (rest[0] !== 'init') break
      return cmd.approverInit(ctx)
    case 'approvals':
      return cmd.approvalsCmd({ ...ctx, id: rest[0] })
    case 'approve':
      return cmd.approveCmd({ ...ctx, id: rest[0] })
    case 'deny':
      return cmd.denyCmd({ ...ctx, id: rest[0] })
    case 'history':
      return cmd.historyCmd(ctx)
    case 'evidence':
      return evidenceCmd(ctx)
    case 'gate-probe':
      return gateProbeCmd({ ...ctx, action: rest[0] })
    case 'chaos':
      return chaosCmd(ctx)
    case 'console':
      throw new cmd.CliError(EXIT.USAGE, 'USAGE', 'console is a long-running server; start it from the command line: justrunme console [--port n]')
  }
  throw new cmd.CliError(EXIT.USAGE, 'USAGE', USAGE)
}

/**
 * Up to three summary lines for `judge --text`, taken only from values the scenario
 * recorded in result.story. A value that is absent produces no line, so a failed or
 * partial run never shows a verdict, a count or a SAFE that was not measured.
 */
export function judgeSummaryLines(story) {
  const lines = []
  const lost = (rows) => {
    const nums = rows && typeof rows === 'object' ? Object.entries(rows).filter(([, n]) => Number.isFinite(n)) : []
    return nums.length === 0 ? '' : `, rows lost: ${nums.reduce((a, [, n]) => a + n, 0)} (${nums.map(([t, n]) => `${t} ${n}`).join(', ')})`
  }
  for (const [label, p] of [['dangerous plan', story?.dangerous], ['safe plan', story?.safe]]) {
    if (typeof p?.verdict === 'string') lines.push(`${label}: ${p.verdict}${lost(p.rows_lost)}`)
  }
  const removed = story?.selection?.removed
  if (Array.isArray(removed) && removed.length > 0) lines.push(`removed from selection: ${removed.length} plan${removed.length === 1 ? '' : 's'}`)
  const h = story?.hidden_trigger
  const d = h?.dangerous
  if (typeof d?.verdict === 'string' && Number.isFinite(d.orders_before) && Number.isFinite(d.orders_after)) {
    lines.push(`hidden trigger${typeof h.trigger === 'string' ? ` ${h.trigger}` : ''}: ${d.verdict}, orders ${d.orders_before} -> ${d.orders_after}`)
    if (typeof h.safe?.verdict === 'string') lines.push(`hidden trigger safe alternative: ${h.safe.verdict}${lost(h.safe.rows_lost)}`)
  }
  return lines
}

export function textOf(out) {
  const lines = [`${out.command}: ${out.ok ? 'ok' : 'not ok'} (exit ${out.exit_code})`]
  if (out.error) {
    lines.push(`${out.error.code}: ${out.error.message}`)
    if (out.error.detail !== undefined) lines.push(JSON.stringify(out.error.detail))
  }
  if (out.command === 'judge' && out.result?.steps) {
    const j = out.result.judge
    lines.push(`${j.status} in ${(j.elapsed_ms / 1000).toFixed(1)} s (budget ${j.budget_ms / 1000} s, ${j.budget_enforced ? 'enforced' : 'not enforced: images were downloaded'})`)
    for (const l of judgeSummaryLines(out.result.story)) lines.push(`  ${l}`)
    for (const s of out.result.steps) lines.push(`  ${s.status === 'passed' ? 'ok  ' : s.status === 'failed' ? 'FAIL' : 'skip'} ${s.title}${s.duration_ms === undefined ? '' : ` (${(s.duration_ms / 1000).toFixed(1)} s)`}`)
    lines.push(`receipts verified: ${out.result.counts.receipts_verified}, mismatches: ${out.result.counts.mismatches}, policy violations: ${out.result.counts.policy_violations}`)
  } else if (out.result) {
    for (const [k, v] of Object.entries(out.result)) lines.push(`${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : v}`)
  }
  return lines.map(printable).join('\n') + '\n'
}

/**
 * @param {string[]} argv
 * @returns {Promise<{ exit: number, output: object }>}
 */
export async function main(argv) {
  let parsed
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
  } catch (err) {
    return { exit: EXIT.USAGE, output: { command: null, ok: false, exit_code: EXIT.USAGE, error: { code: 'USAGE', message: err.message } } }
  }
  const [command = null, ...rest] = parsed.positionals
  const opts = parsed.values
  let exit
  let body
  try {
    if (opts.help) return { exit: EXIT.OK, text: opts.text, output: { command, ok: true, exit_code: EXIT.OK, result: { usage: USAGE } } }
    if (!command) throw new cmd.CliError(EXIT.USAGE, 'USAGE', USAGE)
    if (opts.mission !== undefined && !MISSION_RE.test(opts.mission)) throw new cmd.CliError(EXIT.USAGE, 'USAGE', 'invalid --mission')
    if (opts.plan !== undefined && !['rehearse', 'authorize', 'run'].includes(command)) throw new cmd.CliError(EXIT.USAGE, 'USAGE', '--plan exists only for rehearse, authorize and run')
    if (opts['hidden-trigger'] && command !== 'judge') throw new cmd.CliError(EXIT.USAGE, 'USAGE', '--hidden-trigger exists only for judge')
    if (opts['fault-after'] !== undefined && command !== 'chaos') throw new cmd.CliError(EXIT.USAGE, 'USAGE', '--fault-after exists only for chaos')
    if (opts['emergency-recovery'] && command !== 'undo') throw new cmd.CliError(EXIT.USAGE, 'USAGE', '--emergency-recovery exists only for undo')
    if (opts.confirm !== undefined && command !== 'undo' && command !== 'approve') throw new cmd.CliError(EXIT.USAGE, 'USAGE', '--confirm exists only for undo and approve')
    if (opts['passphrase-stdin'] && !['approver', 'approve', 'authorize'].includes(command)) throw new cmd.CliError(EXIT.USAGE, 'USAGE', '--passphrase-stdin exists only for approver init, approve and authorize')
    const repoDir = path.resolve(opts.repo ?? process.cwd())
    const r = await dispatch(command, rest, repoDir, opts)
    exit = r.exit
    body = { result: r.result }
  } catch (err) {
    if (err instanceof cmd.CliError) {
      exit = err.exit
      body = { error: { code: err.code, message: err.message, ...(err.detail !== undefined ? { detail: err.detail } : {}) } }
    } else if (err?.code === 'CHAIN_LOCKED') {
      exit = EXIT.CHAIN_LOCKED
      body = { error: { code: 'CHAIN_LOCKED', message: String(err.message) } }
    } else {
      exit = EXIT.INTERNAL
      body = { error: { code: 'INTERNAL', message: String(err?.message ?? err) } }
    }
  }
  const out = { command, ok: exit === EXIT.OK, exit_code: exit, ...body }
  const pairs = [[keyHome(), '$JUSTRUNME_HOME'], [path.resolve(opts.repo ?? process.cwd()), '$REPO']]
  // judge works in temporary directories whose names can appear in error text.
  if (command === 'judge') for (const t of new Set([os.tmpdir(), tryReal(os.tmpdir())])) pairs.push([t, '$TMP'])
  return { exit, text: opts.text, output: redactDeep(scrubPaths(out, pairs)) }
}

/**
 * Replace local paths that redact() does not know (a key directory or workspace
 * outside the home directory) with placeholders, longest first.
 * @param {unknown} value
 * @param {[string, string][]} pairs
 */
export function scrubPaths(value, pairs) {
  const sorted = pairs.filter(([p]) => typeof p === 'string' && p.length > 1).sort((a, b) => b[0].length - a[0].length)
  const walk = (v) => {
    if (typeof v === 'string') return sorted.reduce((s, [p, label]) => s.split(p).join(label), v)
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  return walk(value)
}

const tryReal = (p) => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** Text mode: no control characters, so nothing can colour the terminal or fake a line. */
export const printable = (s) => String(s).replace(/[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g, '?')

const isEntry = (() => {
  try {
    return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()

/**
 * `justrunme console [--port n] [--repo dir] [--mission id] [--recorded dir] [--judge-report file]`: starts the local Console and
 * keeps running until interrupted. It prints one JSON line with the URL; the token is in
 * the fragment (#token=...), which the browser never sends to a server.
 * `--judge-report <file>` names the saved stdout of `justrunme judge --hidden-trigger`, read once and
 * read only, for the Proof chain screen; a missing or malformed file refuses the start (fail closed).
 */
async function runConsole(argv) {
  let parsed
  try {
    parsed = parseArgs({ args: argv, options: { repo: { type: 'string' }, mission: { type: 'string' }, port: { type: 'string' }, recorded: { type: 'string' }, 'judge-report': { type: 'string' } }, allowPositionals: false, strict: true })
  } catch (err) {
    process.stdout.write(JSON.stringify({ command: 'console', ok: false, exit_code: EXIT.USAGE, error: { code: 'USAGE', message: err.message } }) + '\n')
    process.exitCode = EXIT.USAGE
    return
  }
  const o = parsed.values
  const port = o.port === undefined ? 0 : Number(o.port)
  if (!Number.isInteger(port) || port < 0 || port > 65535 || (o.mission !== undefined && !MISSION_RE.test(o.mission))) {
    process.stdout.write(JSON.stringify({ command: 'console', ok: false, exit_code: EXIT.USAGE, error: { code: 'USAGE', message: 'invalid --port or --mission' } }) + '\n')
    process.exitCode = EXIT.USAGE
    return
  }
  const { startConsole } = await import('../console/server.js')
  const { loadJudgeReport } = await import('../console/judgereport.js')
  const judgeReport = loadJudgeReport(o['judge-report'] === undefined ? undefined : path.resolve(o['judge-report']))
  if (judgeReport.state === 'invalid') {
    process.stdout.write(JSON.stringify({ command: 'console', ok: false, exit_code: EXIT.USAGE, error: { code: 'JUDGE_REPORT_INVALID', message: `--judge-report ${judgeReport.file ?? ''}: ${judgeReport.reason}` } }) + '\n')
    process.exitCode = EXIT.USAGE
    return
  }
  // The recorded run (a signed export, opened read only) is offered next to the live workspace.
  // `--recorded <dir>` names another export; the one shipped in the repository is the default.
  const shipped = fileURLToPath(new URL('../../demo/recorded-run', import.meta.url))
  const c = await startConsole({ repoDir: path.resolve(o.repo ?? process.cwd()), mission: o.mission, port, recordedDir: o.recorded === undefined ? shipped : path.resolve(o.recorded), judgeReport })
  process.stdout.write(JSON.stringify({ command: 'console', ok: true, exit_code: EXIT.OK, result: { url: c.url, port: c.port, stop: 'Ctrl+C', ...(judgeReport.state === 'loaded' ? { judge_report: judgeReport.file, proof_chain_url: c.url.replace('/#token=', '/#/proof&token=') } : {}) } }) + '\n')
  const stop = async () => {
    await c.close()
    process.exit(EXIT.OK)
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

if (isEntry && process.argv[2] === 'console') {
  // Not awaited: the Console imports this module (for `main`), and a top-level await here
  // would keep this module evaluating while that import waits for it (a deadlock).
  runConsole(process.argv.slice(3)).catch((err) => {
    process.stdout.write(JSON.stringify(redactDeep({ command: 'console', ok: false, exit_code: EXIT.INTERNAL, error: { code: 'INTERNAL', message: String(err?.message ?? err) } })) + '\n')
    process.exitCode = EXIT.INTERNAL
  })
} else if (isEntry) {
  const { exit, text, output } = await main(process.argv.slice(2))
  process.stdout.write(text ? textOf(output) : JSON.stringify(output) + '\n')
  process.exitCode = exit
}
