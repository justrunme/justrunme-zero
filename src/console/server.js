/**
 * JustRunMe Console (T27): a local HTTP server on 127.0.0.1, built on node:http only.
 *
 * Who can talk to it:
 *   - every /api request needs `Authorization: Bearer <token>`; the token is random per
 *     start and reaches the browser in the URL fragment, which is never sent to a server;
 *   - the Host header must name this server (127.0.0.1 or localhost on our port), which
 *     defeats DNS rebinding;
 *   - a POST must carry an Origin of this server and a JSON body, so another web page
 *     cannot submit a form to it.
 * The static page holds no data; a strict Content-Security-Policy allows only our own
 * script and style. Writes are serialised: one approve, deny or undo at a time.
 * One Console serves every mission of its workspace (GET /api/missions); a call names one.
 */

import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createApi, InputError, listMissions } from './api.js'
import { main } from '../cli/index.js'
import { openRecorded, serialized, RECORDED_LABEL } from './recorded.js'
import { readTestReport } from './metrics.js'
import { setupStatus } from './setup.js'
import { loadJudgeReport } from './judgereport.js'

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/ui.js': ['ui.js', 'text/javascript; charset=utf-8'],
  '/model.js': ['model.js', 'text/javascript; charset=utf-8'],
  '/screens.js': ['screens.js', 'text/javascript; charset=utf-8'],
  '/home.js': ['home.js', 'text/javascript; charset=utf-8'],
  '/onboarding.js': ['onboarding.js', 'text/javascript; charset=utf-8'],
  '/evidence.js': ['evidence.js', 'text/javascript; charset=utf-8'],
  '/proofchain.js': ['proofchain.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
}
const STATIC_DIR = new URL('./static/', import.meta.url)
const MAX_BODY = 16 * 1024

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(data) })
  res.end(data)
}

const fail = (res, status, code, message) => send(res, status, { ok: false, error: { code, message } })

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (b) => {
      size += b.length
      if (size > MAX_BODY) {
        reject(new InputError('BODY_TOO_LARGE', 'request body too large'))
        req.destroy()
      } else chunks.push(b)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Constant-time comparison of the presented token. */
function tokenMatches(header, token) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(header ?? '')
  if (!m || m[1].length !== token.length) return false
  return timingSafeEqual(Buffer.from(m[1]), Buffer.from(token))
}

/**
 * `judgeReport` is the saved judge report of the Proof chain screen, as loadJudgeReport()
 * returns it (read once, read only); without it the screen says that no report is loaded.
 * @param {{ repoDir: string, mission?: string, port?: number, token?: string, cliPath?: string, env?: NodeJS.ProcessEnv, judgeReport?: ReturnType<typeof loadJudgeReport> }} cfg
 * @returns {Promise<{ url: string, port: number, token: string, close: () => Promise<void> }>}
 */
export async function startConsole({ repoDir, mission, port = 0, token = randomBytes(32).toString('hex'), cliPath, env, recordedDir, testReportFile, judgeReport = loadJudgeReport(undefined) }) {
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error('the console token must be 64 hex characters')
  // Live reads and recorded reads share one process, and the key directory comes from the
  // environment, so every in-process read goes through the same lock.
  const api = createApi({ repoDir, mission, cliPath, env, runMain: (argv) => serialized(() => main(argv)) })
  const recorded = openRecorded(recordedDir)
  /** The API a call asks for: the live workspace, or the read-only recorded run. */
  const apiFor = (source) => {
    if (source === undefined || source === null || source === '' || source === 'live') return api
    if (source !== 'recorded') throw new InputError('SOURCE_INVALID', 'source must be live or recorded')
    if (!recorded.available) throw new InputError('RECORDED_UNAVAILABLE', 'no recorded run is installed')
    if (!recorded.integrity.ok) throw new InputError('RECORDED_ALTERED', `the recorded run does not match its manifest: ${recorded.integrity.problems.slice(0, 3).join('; ')}`)
    return recorded.api
  }
  let actual = port
  let busy = false
  const hosts = () => new Set([`127.0.0.1:${actual}`, `localhost:${actual}`])
  const origins = () => new Set([`http://127.0.0.1:${actual}`, `http://localhost:${actual}`])

  const DEFAULT_REPORT = fileURLToPath(new URL('../../docs/test-report.json', import.meta.url))
  /** What each source offers, so the Home screen can choose between the live workspace and the recorded run. */
  function sources() {
    const live = listMissions(repoDir)
    return {
      ok: true,
      live: { available: live.length > 0 || Boolean(mission), missions: live.length },
      recorded: {
        available: recorded.available,
        label: RECORDED_LABEL,
        integrity: recorded.integrity,
        missions: recorded.manifest?.missions ?? [],
        provenance: recorded.integrity.ok ? recorded.manifest?.provenance ?? null : null,
        exported_at: recorded.manifest?.exported_at ?? null,
      },
    }
  }

  // GET routes take the mission from `?mission=<id>`; POST routes from the body. The API checks it.
  const routes = {
    'GET /api/sources': () => sources(),
    'GET /api/metrics': () => readTestReport(testReportFile ?? DEFAULT_REPORT),
    'GET /api/judge-report': () => ({ ok: judgeReport.state === 'loaded', ...judgeReport }),
    'GET /api/setup': () => setupStatus({ repoDir, runMain: (argv) => serialized(() => main(argv)) }),
    'GET /api/missions': (q) => apiFor(q.get('source')).missions(),
    'GET /api/state': (q) => apiFor(q.get('source')).state(q.get('mission')),
    'GET /api/replay': (q) => apiFor(q.get('source')).replay(q.get('mission')),
    'POST /api/approve': (body) => api.approve(body),
    'POST /api/deny': (body) => api.deny(body),
    'POST /api/undo': (body) => api.undo(body),
    'POST /api/gate-probe': (body) => api.gateProbe(body),
  }

  async function handle(req, res) {
    if (!hosts().has(req.headers.host ?? '')) return fail(res, 403, 'BAD_HOST', 'this server answers only to 127.0.0.1 or localhost on its own port')
    // Only an origin-relative path: "//host/x" or an absolute URL is not ours to parse.
    if (!/^\/(?!\/)/.test(req.url ?? '')) return fail(res, 400, 'BAD_PATH', 'bad request path')
    const url = new URL(req.url, 'http://127.0.0.1')
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname]
      return send(res, 200, await readFile(new URL(file, STATIC_DIR)), type)
    }
    if (!url.pathname.startsWith('/api/')) return fail(res, 404, 'NOT_FOUND', 'not found')
    if (!tokenMatches(req.headers.authorization, token)) return fail(res, 401, 'UNAUTHORIZED', 'a valid console token is required')

    if (req.method === 'POST') {
      if (!origins().has(req.headers.origin ?? '')) return fail(res, 403, 'BAD_ORIGIN', 'a POST must come from this console')
      if (!/^application\/json(;|$)/.test(req.headers['content-type'] ?? '')) return fail(res, 415, 'JSON_REQUIRED', 'a POST must have a JSON body')
    } else if (req.method !== 'GET') {
      return fail(res, 405, 'METHOD_NOT_ALLOWED', 'only GET and POST')
    }

    const one = /^\/api\/(approvals|receipt)\/([^/]+)$/.exec(url.pathname)
    const q = url.searchParams
    if (req.method === 'GET' && one) {
      const a = apiFor(q.get('source'))
      return send(res, 200, one[1] === 'approvals' ? await a.approval(one[2], q.get('mission')) : await a.receipt(one[2], q.get('mission')))
    }
    const route = routes[`${req.method} ${url.pathname}`]
    if (!route) return fail(res, 404, 'NOT_FOUND', 'not found')
    if (req.method === 'GET') return send(res, 200, await route(q))

    let body
    try {
      body = JSON.parse(await readBody(req))
    } catch (err) {
      if (err instanceof InputError) throw err
      throw new InputError('BAD_JSON', 'the body is not valid JSON')
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('BAD_JSON', 'the body must be a JSON object')
    if (body.source !== undefined && body.source !== 'live') return fail(res, 403, 'RECORDED_READ_ONLY', 'a recorded run is read only: it cannot be approved, rejected or undone')
    if (busy) return fail(res, 409, 'BUSY', 'another approve, deny or undo is running')
    busy = true
    try {
      return send(res, 200, await route(body))
    } finally {
      busy = false
    }
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) return res.destroy()
      if (err instanceof InputError) return fail(res, 400, err.code, err.message)
      fail(res, 500, 'INTERNAL', 'internal error')
    })
  })
  server.headersTimeout = 10_000
  server.requestTimeout = 15 * 60_000
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  actual = server.address().port
  return {
    url: `http://127.0.0.1:${actual}/#token=${token}`,
    port: actual,
    token,
    close: () => new Promise((resolve) => {
      recorded.close()
      server.closeAllConnections?.()
      server.close(() => resolve())
    }),
  }
}
