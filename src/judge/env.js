/**
 * Real backend of the judge scenario (T19): a throwaway workspace, a throwaway
 * operator key and a Postgres container of the demo stack, all created for this one
 * run and removed at its end, on failure, and on Ctrl-C or SIGTERM.
 *
 * What the judge never touches: the operator's key directory, the current
 * workspace, any existing Compose project. Every child process (the CLI, git,
 * docker) gets an allowlisted environment: PATH, HOME, TMPDIR, LANG and the
 * DOCKER_* client settings, plus a throwaway JUSTRUNME_HOME and git settings that
 * ignore the caller's git configuration. Database and cloud credentials in the
 * caller's environment are not passed on. HOME and DOCKER_CONFIG are, because the
 * Docker client needs them; a remote DOCKER_HOST is refused.
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'
import { down, psql, up, writeNoPortsOverride } from '../rehearsal/compose.js'
import { measureDatabase } from '../rehearsal/measure.js'
import { chainPath, receiptHash, verifyChain } from '../receipts/chain.js'
import { loadPublicKey, publicKeyHex } from '../receipts/keys.js'
import { groupAlive, killGroup, run } from '../util/exec.js'
import { PreflightError, checkDockerCli, checkDockerDaemon, checkNode } from './preflight.js'

const DEMO_DIR = fileURLToPath(new URL('../../demo/', import.meta.url))
const CLI_FILE = fileURLToPath(new URL('../cli/index.js', import.meta.url))

// Fresh SQL written for this demo. The dangerous plan "consolidates" orders but keeps
// only the rows with quantity >= 10; the safe plan only adds a column.
export const DANGEROUS_SQL = 'CREATE TABLE orders_v2 AS SELECT id, patch_id, quantity FROM orders WHERE quantity >= 10;\nDROP TABLE orders;\nALTER TABLE orders_v2 RENAME TO orders;\n'
export const SAFE_SQL = "ALTER TABLE orders ADD COLUMN status TEXT NOT NULL DEFAULT 'new';\n"
// Hidden-trigger case: the plan is one innocent UPDATE; the loss comes from a trigger in the database.
export const HIDDEN_DANGEROUS_SQL = 'UPDATE patches SET available_count = 0 WHERE id = 1;\n'
export const HIDDEN_SAFE_SQL = 'SELECT cancel_patch_orders(1);\nUPDATE patches SET available_count = 0 WHERE id = 1;\n'
// Database-side state the plan does not show: order status, cancel_patch_orders() and the trigger that deletes open orders.
export const HIDDEN_TRIGGER_SQL = `ALTER TABLE orders ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
CREATE FUNCTION cancel_patch_orders(p INT) RETURNS INT LANGUAGE sql AS $$ WITH c AS (UPDATE orders SET status = 'cancelled' WHERE patch_id = p AND status = 'open' RETURNING 1) SELECT count(*)::int FROM c $$;
CREATE FUNCTION release_sold_out() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.available_count = 0 THEN DELETE FROM orders WHERE patch_id = NEW.id AND status = 'open'; END IF; RETURN NEW; END $$;
CREATE TRIGGER patches_release_sold_out AFTER UPDATE OF available_count ON patches FOR EACH ROW EXECUTE FUNCTION release_sold_out();
`
const MIGRATIONS = { dangerous: 'demo/migrations/003_consolidate_orders.sql', safe: 'demo/migrations/003_add_order_status.sql', hidden_dangerous: 'demo/migrations/004_mark_hollow_creek_sold_out.sql', hidden_safe: 'demo/migrations/004_cancel_orders_then_mark_sold_out.sql' }
const SQL = { dangerous: DANGEROUS_SQL, safe: SAFE_SQL, hidden_dangerous: HIDDEN_DANGEROUS_SQL, hidden_safe: HIDDEN_SAFE_SQL }

export class JudgeEnvironmentError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const PASS_THROUGH = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'XDG_RUNTIME_DIR', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT', 'DOCKER_DEFAULT_PLATFORM', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY']

/** @param {NodeJS.ProcessEnv} env */
export function childEnv(env, home) {
  // GIT_CONFIG_*: the caller's git configuration (hooks path, signing, aliases) plays no part.
  const out = { JUSTRUNME_HOME: home, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
  for (const k of PASS_THROUGH) if (env[k] !== undefined) out[k] = env[k]
  return out
}

/** A socket on this machine (a forwarded socket cannot be told apart; the README says so). */
export const isLocalEndpoint = (host) => typeof host === 'string' && /^(unix|npipe):\/\/\/\S+$/.test(host)

/**
 * The endpoint of the context the Docker CLI would use, from
 * `docker context ls --format '{{.Current}}\t{{.DockerEndpoint}}'`. The CLI has
 * already applied DOCKER_HOST, DOCKER_CONTEXT and the configured current context.
 */
export function currentEndpoint(listing) {
  const current = String(listing)
    .split('\n')
    .map((l) => l.trim().split('\t'))
    .filter(([flag, endpoint]) => flag === 'true' && endpoint)
  return current.length === 1 ? current[0][1] : null
}

/**
 * Resolve the daemon once, refuse anything but a local socket, and return the
 * environment that pins it: every docker process of the judge gets this
 * DOCKER_HOST and no DOCKER_CONTEXT, so none of them can reach another daemon.
 */
async function pinLocalDocker(env, probe = run) {
  const base = childEnv(env, os.tmpdir())
  const r = await probe('docker', ['context', 'ls', '--format', '{{.Current}}\t{{.DockerEndpoint}}'], { timeoutMs: 20000, env: base })
  if (r.code !== 0) throw new JudgeEnvironmentError('DOCKER_UNAVAILABLE', 'Docker is not available; the judge demo needs a running Docker daemon (the rest of JustRunMe does not)')
  const endpoint = currentEndpoint(r.stdout)
  if (!isLocalEndpoint(endpoint)) throw new JudgeEnvironmentError('REMOTE_DOCKER', 'the active Docker context does not point at a local socket; the judge demo runs only against a local Docker')
  const { DOCKER_CONTEXT: _context, ...rest } = base
  return { ...rest, DOCKER_HOST: endpoint }
}

/** Names that identify what this judge run created, for removal when it ends early. */
export const projectNames = (suffix) => ({ stack: `jrm-judge-${suffix}`, rehearsalPrefix: `jrm-reh-judge${suffix}-` })

const SWEEPS = [
  { kind: 'container', list: ['ps', '-a', '-q'], rm: ['rm', '-f', '-v'] },
  { kind: 'volume', list: ['volume', 'ls', '-q'], rm: ['volume', 'rm', '-f'] },
  { kind: 'network', list: ['network', 'ls', '-q'], rm: ['network', 'rm'] },
]

/**
 * One pass over the containers, volumes and networks of the rehearsal copies the
 * child CLI started. A list command that fails (daemon unreachable, timeout) is an
 * error, never "nothing found": silence from a dead daemon must not read as clean.
 * @param {string} prefix
 * @param {NodeJS.ProcessEnv} env
 * @param {typeof run} [docker] injectable runner, same shape as `run`
 * @returns {Promise<{ found: { kind: string, id: string }[], errors: string[] }>}
 */
export async function sweepRehearsalDetailed(prefix, env, docker = run) {
  const found = []
  const errors = []
  for (const { kind, list, rm } of SWEEPS) {
    const r = await docker('docker', [...list, '--filter', `name=${prefix}`], { env, timeoutMs: 30000 })
    if (r.code !== 0) {
      errors.push(`${kind}_list_failed`)
      continue
    }
    const ids = r.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
    for (const id of ids) found.push({ kind, id })
    if (ids.length > 0) {
      const removed = await docker('docker', [...rm, ...ids], { env, timeoutMs: 60000 })
      if (removed.code !== 0) errors.push(`${kind}_remove_failed`)
    }
  }
  return { found, errors }
}

/**
 * Remove the rehearsal copies and prove it. `ok` is true only when two sweeps in a
 * row found nothing and no docker command failed; otherwise `status` is
 * 'leftovers' (objects still there) or 'unverified' (docker could not be asked).
 * @returns {Promise<{ ok: boolean, status: 'clean' | 'leftovers' | 'unverified', leftovers: { kind: string, id: string }[], errors: string[] }>}
 */
export async function cleanupRehearsalCopies(prefix, env, { docker = run, ...sweepOptions } = {}) {
  let last = { found: [], errors: [] }
  const quiet = await sweepUntilQuiet(async () => {
    last = await sweepRehearsalDetailed(prefix, env, docker)
    return last.found.length + last.errors.length
  }, sweepOptions)
  const ok = quiet && last.found.length === 0 && last.errors.length === 0
  const status = ok ? 'clean' : last.found.length > 0 ? 'leftovers' : 'unverified'
  return { ok, status, leftovers: last.found, errors: [...new Set(last.errors)] }
}

/**
 * Signal handling that never exits before cleanup has finished. Handlers stay
 * installed until then, so a repeated Ctrl-C or SIGTERM is absorbed (and noted)
 * instead of falling back to the default, which would kill the process mid-cleanup.
 * @param {{ cleanup: () => Promise<{ ok?: boolean } | void>, proc?: { on: Function, removeListener: Function, stderr?: { write: Function } }, exit?: (code: number) => void }} deps
 */
export function installSignalGuard({ cleanup, proc = process, exit = (code) => process.exit(code) }) {
  let running = null
  let repeats = 0
  const handlers = ['SIGINT', 'SIGTERM'].map((sig) => {
    const h = () => {
      if (running) {
        repeats++
        return
      }
      running = Promise.resolve()
        .then(cleanup)
        .catch(() => ({ ok: false }))
        .then((status) => {
          const clean = !status || status.ok !== false
          if (!clean) proc.stderr?.write('judge cleanup incomplete: leftovers or unverified state; see the cleanup status\n')
          remove()
          exit(sig === 'SIGINT' ? 130 : 143)
        })
    }
    return [sig, h]
  })
  const remove = () => {
    for (const [s, h] of handlers) proc.removeListener(s, h)
  }
  for (const [s, h] of handlers) proc.on(s, h)
  return { remove, repeats: () => repeats, done: () => running }
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Sweep until the daemon is quiet. A `docker compose up` that was killed may have
 * requests in flight that the daemon still completes (a volume can appear after a
 * single sweep; CI saw exactly that). Stop after two clean sweeps in a row, or at
 * the deadline (then whatever is left is reported by the caller's own check).
 */
export async function sweepUntilQuiet(sweep, { deadlineMs = 30000, intervalMs = 500, now = Date.now, sleep = pause } = {}) {
  const end = now() + deadlineMs
  let clean = 0
  while (clean < 2 && now() < end) {
    clean = (await sweep()) === 0 ? clean + 1 : 0
    if (clean < 2) await sleep(intervalMs)
  }
  return clean >= 2
}

/** @returns {Promise<{ backend: object, missionId: string, imagesCached: boolean, cleanup: () => Promise<import('./report.js').CleanupStatus>, cleanupStatus: () => object | null }>} */
export async function createBackend({ env = process.env, probe = run, nodeVersion = process.versions.node, docker = run } = {}) {
  // Preflight: nothing below this block runs, and nothing is created, unless it passes.
  let cleanEnv
  try {
    checkNode(nodeVersion)
    if (env.DOCKER_HOST && !env.DOCKER_HOST.startsWith('unix://')) {
      throw new JudgeEnvironmentError('REMOTE_DOCKER', 'DOCKER_HOST points at a remote daemon; the judge demo runs only against a local Docker')
    }
    await checkDockerCli(probe, childEnv(env, os.tmpdir()))
    cleanEnv = await pinLocalDocker(env, probe)
    await checkDockerDaemon(probe, cleanEnv)
  } catch (err) {
    if (err instanceof PreflightError) throw new JudgeEnvironmentError(err.code, err.message)
    throw err
  }
  const suffix = randomBytes(4).toString('hex')
  const missionId = `judge-${suffix}`
  const names = projectNames(suffix)
  const version = await run('docker', ['version', '--format', '{{.Server.Version}}'], { timeoutMs: 20000, env: cleanEnv })
  if (version.code !== 0) throw new JudgeEnvironmentError('DOCKER_UNAVAILABLE', 'Docker is not available; the judge demo needs a running Docker daemon (the rest of JustRunMe does not)')

  let repoDir = null
  let home = null
  let overrideFile = null
  let real = null
  let stackDown = false
  const children = new Set()
  const track = (child) => {
    children.add(child)
    child.on('close', () => children.delete(child))
  }
  // Fail closed: the status is 'clean' only when every step was verified.
  const cleanup = async () => {
    const errors = []
    // The CLI children lead their own process groups: this stops them and the docker
    // processes they started, then waits (bounded) until those groups are gone.
    const groups = [...children].map((c) => c.pid).filter(Boolean)
    for (const c of children) killGroup(c)
    for (let i = 0; i < 50 && groups.some(groupAlive); i++) await pause(100)
    if (groups.some(groupAlive)) errors.push('processes_alive')
    if (real && real.env && !stackDown) {
      stackDown = (await down(real)).code === 0
      if (!stackDown) errors.push('stack_down_failed')
    }
    const copies = await cleanupRehearsalCopies(names.rehearsalPrefix, cleanEnv, { docker })
    errors.push(...copies.errors)
    const leftovers = [...copies.leftovers]
    if (real && real.env && !stackDown) leftovers.push({ kind: 'stack', id: names.stack })
    for (const d of [repoDir, home, overrideFile && path.dirname(overrideFile)]) {
      if (!d) continue
      try {
        rmSync(d, { recursive: true, force: true })
      } catch {
        errors.push('directory_remove_failed')
        // base name only: no absolute paths in output
        leftovers.push({ kind: 'directory', id: path.basename(d) })
      }
    }
    const ok = errors.length === 0 && copies.ok && leftovers.length === 0
    const status = ok ? 'clean' : leftovers.length > 0 ? 'leftovers' : 'unverified'
    return { ok, status, leftovers, errors: [...new Set(errors)] }
  }
  let cleanupStatus = null
  let finishing = null
  // Installed before anything is created: Ctrl-C during the first `up` removes it too.
  const guard = installSignalGuard({ cleanup: () => finish() })
  const finish = () => {
    // Concurrent and repeated callers share one cleanup and its status.
    finishing ??= cleanup().catch(() => ({ ok: false, status: 'unverified', leftovers: [], errors: ['cleanup_failed'] })).then((st) => (cleanupStatus = st))
    return finishing
  }

  try {
    repoDir = mkdtempSync(path.join(os.tmpdir(), 'jrm-judge-'))
    home = mkdtempSync(path.join(os.tmpdir(), 'jrm-judge-keys-'))
    overrideFile = writeNoPortsOverride(['db', 'app'])
    real = { project: names.stack, composeFile: path.join(repoDir, 'demo/docker-compose.yml'), dbService: 'db', dbUser: 'demo_user', dbName: 'pumpkin_patch', overrideFile }
    // The demo approves by itself: a throwaway passphrase for a throwaway approver key, used only inside this run.
    const runEnv = { ...cleanEnv, JUSTRUNME_HOME: home, JUSTRUNME_APPROVER_PASSPHRASE: randomBytes(16).toString('hex') }
    real.env = runEnv

    mkdirSync(path.join(repoDir, 'demo/migrations'), { recursive: true })
    copyFileSync(path.join(DEMO_DIR, 'docker-compose.yml'), path.join(repoDir, 'demo/docker-compose.yml'))
    for (const f of ['001_init.sql', '002_seed_data.sql']) copyFileSync(path.join(DEMO_DIR, 'migrations', f), path.join(repoDir, 'demo/migrations', f))
    writeFileSync(path.join(repoDir, '.gitignore'), '.justrunme/\n')
    writeFileSync(path.join(repoDir, 'justrunme.target.json'), JSON.stringify({ project: names.stack, compose_file: 'demo/docker-compose.yml', db_service: 'db', db_user: 'demo_user', db_name: 'pumpkin_patch' }))
    const git = (...args) =>
      execFileSync('git', ['-c', 'user.name=judge', '-c', 'user.email=judge@judge.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: repoDir, stdio: 'pipe', env: runEnv })
    git('init', '-q')
    git('add', '.')
    git('commit', '-q', '-m', 'judge base')

    const image = parse(readFileSync(path.join(repoDir, 'demo/docker-compose.yml'), 'utf8')).services.db.image
    const imagesCached = (await run('docker', ['image', 'inspect', image], { timeoutMs: 20000, env: runEnv })).code === 0

    await up(real, ['db'])
    for (const f of ['001_init.sql', '002_seed_data.sql']) {
      const r = await psql(real, { input: readFileSync(path.join(repoDir, 'demo/migrations', f)) })
      if (r.code !== 0) throw new JudgeEnvironmentError('SEED_FAILED', `seeding the demo database failed: ${r.stderr.trim().split('\n').slice(-1)[0]}`)
    }

    const cli = async (args, environment) => {
      const r = await run(process.execPath, [CLI_FILE, ...args, '--repo', repoDir], { env: environment, timeoutMs: 120000, group: true, onSpawn: track })
      let out = null
      try {
        out = JSON.parse(r.stdout)
      } catch {
        // an unparseable stdout is a failed step, not a crash
      }
      return { exit: r.code, out }
    }
    const chain = chainPath(repoDir, missionId)
    let original = null

    const backend = {
      cli: (args) => cli(args, runEnv),
      // No PATH at all: the verifier must not need Docker, git or anything else.
      offlineCli: (args) => cli(args, { JUSTRUNME_HOME: home, PATH: '' }),
      measure: () => measureDatabase((sql) => psql(real, { sql })),
      async useMigration(kind) {
        for (const [k, rel] of Object.entries(MIGRATIONS)) if (k !== kind) rmSync(path.join(repoDir, rel), { force: true })
        writeFileSync(path.join(repoDir, MIGRATIONS[kind]), SQL[kind])
        writeFileSync(
          path.join(repoDir, 'justrunme.mission.yaml'),
          stringify({
            id: missionId,
            objective: 'Add order status tracking to the demo service',
            allowed_paths: ['demo/migrations/'],
            protected_tables: ['orders', 'patches'],
            ...(kind.startsWith('hidden_') ? { required_changes: [{ table: 'orders', where: { id: 2 }, set: { status: 'cancelled' } }] } : {}),
            time_limit_seconds: 300,
            irreversible_actions: [],
            plan: [{ id: 'migrate', tool: 'sql_migration', args: [MIGRATIONS[kind]], reversibility: true }],
            resources: { databases: ['pumpkin_patch'], config_files: [], compose_services: ['db'] },
          })
        )
      },
      async readOrderTwoStatus() {
        const result = await psql(real, { sql: 'SELECT status FROM public.orders WHERE id = 2' })
        if (result.code !== 0) throw new JudgeEnvironmentError('MEASUREMENT_FAILED', 'Could not read order #2 on the demo target')
        return result.stdout.trim() || null
      },
      async installHiddenTrigger() {
        const r = await psql(real, { sql: HIDDEN_TRIGGER_SQL })
        if (r.code !== 0) throw new JudgeEnvironmentError('SEED_FAILED', `installing the hidden trigger failed: ${r.stderr.trim().split('\n').slice(-1)[0]}`)
      },
      async stopStack() {
        // Only counts as stopped when docker says so; otherwise cleanup tries again.
        stackDown = (await down(real)).code === 0
      },
      corruptChain() {
        original = readFileSync(chain)
        const bad = Buffer.from(original)
        bad[30] = bad[30] ^ 1
        writeFileSync(chain, bad)
      },
      restoreChain() {
        if (original) writeFileSync(chain, original)
        original = null
      },
      readReceipts() {
        const publicKey = loadPublicKey(home)
        const v = verifyChain({ repoDir, home, publicKey, missionId })
        return { publicKey: publicKey ? publicKeyHex(publicKey) : null, receipts: v.receipts.map((r) => ({ seq: r.seq, kind: r.kind, verdict: r.verdict ?? null, hash: receiptHash(r) })) }
      },
    }
    // `cleanup` is idempotent and resolves with the same status every time.
    const cleanupAndRelease = async () => {
      const st = await finish()
      if (!guard.done()) guard.remove()
      return st
    }
    return { backend, missionId, imagesCached, cleanup: cleanupAndRelease, cleanupStatus: () => cleanupStatus }
  } catch (err) {
    const st = await finish()
    if (!guard.done()) guard.remove()
    if (err && typeof err === 'object' && !st.ok) err.cleanup = st
    throw err
  }
}
