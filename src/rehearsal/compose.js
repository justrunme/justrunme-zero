/**
 * Docker Compose target access (R2.2, R2.5).
 *
 * A target is one Compose project: { project, composeFile, dbService, dbUser, dbName }.
 * All database access goes through `docker compose exec -T <db> psql`, so no host
 * port and no host Postgres client is needed. Rehearsal copies are started with an
 * override that removes published ports, so they never collide with the real stack.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run, runOk } from '../util/exec.js'

/** Largest plain-SQL dump accepted; above it the dump fails closed (output limit exceeded). */
export const PG_DUMP_MAX_OUTPUT_BYTES = 1024 * 1024 * 1024
/** Largest database server log read; above it serverLog throws, never returns a partial log. */
export const SERVER_LOG_MAX_OUTPUT_BYTES = 64 * 1024 * 1024

const PROJECT_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/

/**
 * `env`, when present, is the whole environment of every docker process started for
 * this target (the judge pins one local daemon this way); absent means the caller's.
 * @typedef {{ project: string, composeFile: string, dbService: string, dbUser: string, dbName: string, overrideFile?: string, env?: NodeJS.ProcessEnv }} Target
 */

export function assertTarget(t) {
  if (!PROJECT_RE.test(t.project)) throw new Error(`invalid compose project name: ${t.project}`)
  for (const k of ['dbService', 'dbUser', 'dbName']) {
    if (!/^[A-Za-z0-9_-]{1,63}$/.test(t[k])) throw new Error(`invalid target field ${k}`)
  }
  if (t.planUser !== undefined && t.planUser !== null && !/^[a-z_][a-z0-9_]{0,62}$/.test(t.planUser)) throw new Error('invalid target field planUser')
}

/**
 * Override that drops every published port of the listed services (Compose `!reset`).
 * With `isolate`, the project's default network is also `internal`: Docker gives its
 * containers no default route and no published ports. A rehearsal copy holds a dump
 * of the real database and runs SQL the agent wrote, so it gets nothing to talk to
 * (assertIsolated checks the outcome; a test reads the routing table).
 */
export function writeNoPortsOverride(services, { isolate = false } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jrm-override-'))
  const file = path.join(dir, 'no-ports.override.yml')
  const network = isolate ? 'networks:\n  default:\n    internal: true\n' : ''
  writeFileSync(file, 'services:\n' + services.map((s) => `  ${s}:\n    ports: !reset []\n`).join('') + network)
  return file
}

function baseArgs(t) {
  assertTarget(t)
  const args = ['compose', '-p', t.project, '-f', t.composeFile]
  if (t.overrideFile) args.push('-f', t.overrideFile)
  return args
}

/**
 * `docker compose exec` costs about 0.25 s more than `docker exec` on the same
 * container, and one mission runs it dozens of times. The container id of a
 * service is looked up once per process and forgotten whenever this process
 * brings the project up or down. If the container was replaced behind our back,
 * `docker exec` fails on the stale id; nothing runs against another container.
 */
const containerIds = new Map()
const containerKey = (t, service) => `${t.project}\u0000${t.composeFile}\u0000${service}`

async function containerOf(t, service) {
  const key = containerKey(t, service)
  const known = containerIds.get(key)
  if (known) return known
  const id = (await runOk('docker', [...baseArgs(t), 'ps', '-q', service], { env: t.env })).trim().split('\n')[0]
  if (!/^[0-9a-f]{12,64}$/.test(id)) throw new Error(`service ${service} of project ${t.project} is not running`)
  containerIds.set(key, id)
  return id
}

const forget = (t) => {
  for (const key of [...containerIds.keys()]) if (key.startsWith(t.project + '\u0000')) containerIds.delete(key)
}

/** @param {Target} t */
export async function up(t, services) {
  forget(t)
  await runOk('docker', [...baseArgs(t), 'up', '-d', '--wait', '--wait-timeout', '90', ...services], { timeoutMs: 180000, env: t.env })
}

/** Remove containers, networks and volumes of the project; never throws. */
export async function down(t) {
  forget(t)
  return run('docker', [...baseArgs(t), 'down', '-v', '--remove-orphans', '--timeout', '5'], { timeoutMs: 120000, env: t.env })
}

/**
 * Run SQL in the target database. `input` is fed on stdin (used for files and dumps).
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export async function psql(t, { sql, input, singleTransaction = false, asPlan = false }) {
  assertTarget(t)
  let container
  try {
    container = await containerOf(t, t.dbService)
  } catch (err) {
    // Same contract as before: psql resolves with a non-zero code instead of throwing.
    return { code: 1, stdout: '', stderr: String(err.message), timedOut: false }
  }
  // T25 v2: plan steps connect as the target's plan role (never through SET ROLE).
  const user = asPlan ? t.planUser ?? t.dbUser : t.dbUser
  const args = ['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', t.dbName, '-At', '-F', '\t']
  if (singleTransaction) args.push('-1')
  if (sql !== undefined) args.push('-c', sql)
  return run('docker', args, { input, timeoutMs: 120000, env: t.env })
}

/**
 * Plain-SQL dump of the target database. With `privileges`, grants and revokes are kept
 * (T25 v2: the plan role must have in the copy exactly the rights it has for real; the
 * role itself is created in the copy before the dump is loaded).
 */
export async function dump(t, { privileges = false } = {}) {
  assertTarget(t)
  return runOk('docker', ['exec', '-i', await containerOf(t, t.dbService), 'pg_dump', '-U', t.dbUser, '-d', t.dbName, '--no-owner', ...(privileges ? [] : ['--no-privileges'])], { timeoutMs: 120000, env: t.env, maxOutputBytes: PG_DUMP_MAX_OUTPUT_BYTES })
}

/** Everything the database container wrote to stdout and stderr so far (the server log). */
export async function serverLog(t) {
  assertTarget(t)
  const r = await run('docker', ['logs', await containerOf(t, t.dbService)], { timeoutMs: 60000, env: t.env, maxOutputBytes: SERVER_LOG_MAX_OUTPUT_BYTES })
  if (r.outputOverflow) throw new Error('docker logs failed: output limit exceeded, log would be incomplete')
  if (r.code !== 0) throw new Error(`docker logs failed: ${errorSummaryLine(r.stderr)}`)
  return r.stdout + '\n' + r.stderr
}

const errorSummaryLine = (s) => String(s).trim().split('\n').slice(-1)[0]?.slice(0, 200) ?? ''

/**
 * Proves, from Docker itself, that the database container of a rehearsal copy has
 * no way out: it is not in host or shared network mode and every network it is
 * attached to is `internal`. The override file asks for this; a Compose file that
 * names its own networks or a network mode could silently defeat it, so the
 * engine checks the result before any agent SQL runs and fails closed.
 * @param {Target} t
 */
export async function assertIsolated(t) {
  const id = await containerOf(t, t.dbService)
  const fields = (await runOk('docker', ['inspect', '--format', '{{.HostConfig.NetworkMode}} {{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}', id], { env: t.env })).trim().split(/\s+/).filter(Boolean)
  const [mode, ...networks] = fields
  if (mode === 'host' || String(mode).startsWith('container:')) throw new Error(`the rehearsal copy is not isolated: network mode ${mode}`)
  for (const name of networks) {
    const internal = (await runOk('docker', ['network', 'inspect', '--format', '{{.Internal}}', name], { env: t.env })).trim()
    if (internal !== 'true') throw new Error(`the rehearsal copy is not isolated: network ${name} is not internal`)
  }
}

/** Same target, connected to another database of the same server (for CREATE / RENAME DATABASE). */
export const withDatabase = (t, dbName) => ({ ...t, dbName })

/**
 * HTTP status of a GET from inside a service container (no host port needed).
 * @returns {Promise<number>} 0 when the request could not be made
 */
export const HEALTH_SERVICE_RE = /^[A-Za-z0-9_-]{1,63}$/
export const HEALTH_URL_RE = /^http:\/\/[A-Za-z0-9.:-]+\/[A-Za-z0-9/_-]*$/

export async function httpStatusInService(t, service, url) {
  if (!HEALTH_SERVICE_RE.test(service)) throw new Error('invalid service name')
  if (!HEALTH_URL_RE.test(url)) throw new Error('invalid health url')
  const code = `fetch(${JSON.stringify(url)}).then(r=>console.log(r.status)).catch(()=>console.log(0))`
  const r = await run('docker', [...baseArgs(t), 'exec', '-T', service, 'node', '-e', code], { timeoutMs: 20000, env: t.env })
  const n = Number.parseInt(r.stdout.trim(), 10)
  return Number.isFinite(n) ? n : 0
}

/** Image ID (content digest) per running service. */
export async function imageDigests(t) {
  const ids = (await runOk('docker', [...baseArgs(t), 'ps', '-q'], { env: t.env })).split('\n').filter(Boolean)
  const images = {}
  for (const id of ids) {
    const out = (await runOk('docker', ['inspect', '--format', '{{index .Config.Labels "com.docker.compose.service"}}\t{{.Image}}', id], { env: t.env })).trim()
    const [service, image] = out.split('\t')
    images[service] = image
  }
  return Object.fromEntries(Object.entries(images).sort(([a], [b]) => a.localeCompare(b)))
}
