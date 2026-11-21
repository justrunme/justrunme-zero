/**
 * Child-process helpers. Arguments are always passed as an argv array (no shell),
 * so values from contracts or file names cannot be interpreted by a shell.
 */

import { spawn, execFileSync } from 'node:child_process'
import { errorSummary } from '../privacy/redact.js'

/** Default cap on combined stdout+stderr bytes kept from one child. */
export const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024

/**
 * @param {string} cmd
 * @param {string[]} args
 * Output beyond `maxOutputBytes` (stdout and stderr combined) kills the child (or its
 * group) and fails closed: the result has `outputOverflow: true` and a nonzero code
 * even if the child exited 0. Kept output never exceeds the cap.
 * With `group`, the child leads its own process group: `killGroup` then stops it
 * and everything it started (for example the `docker compose` of a CLI child),
 * and a Ctrl-C at the terminal reaches only the caller, which decides.
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, input?: string | Buffer, timeoutMs?: number, group?: boolean, maxOutputBytes?: number, onSpawn?: (child: import('node:child_process').ChildProcess) => void }} [opts]
 * @returns {Promise<{ code: number, stdout: string, stderr: string, timedOut: boolean, outputOverflow: boolean }>}
 */
export function run(cmd, args, { cwd, env, input, timeoutMs = 120000, group = false, maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES, onSpawn } = {}) {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) throw new RangeError('maxOutputBytes must be a positive safe integer')
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'], detached: group })
    if (onSpawn) onSpawn(child)
    const out = []
    const err = []
    let timedOut = false
    let outputOverflow = false
    let kept = 0
    const take = (list) => (d) => {
      const room = maxOutputBytes - kept
      if (d.length > room) {
        if (room > 0) list.push(d.subarray(0, room))
        kept = maxOutputBytes
        if (!outputOverflow) {
          outputOverflow = true
          if (group) killGroup(child)
          else child.kill('SIGKILL')
        }
        return
      }
      kept += d.length
      list.push(d)
    }
    const timer = setTimeout(() => {
      timedOut = true
      if (group) killGroup(child)
      else child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', take(out))
    child.stderr.on('data', take(err))
    child.on('error', (e) => {
      const message = Buffer.from(String(e.message))
      const room = maxOutputBytes - kept
      if (message.length > room) outputOverflow = true
      if (room > 0) err.push(message.subarray(0, room))
      kept += Math.min(room, message.length)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const exit = outputOverflow ? (code || 1) : (code ?? 1)
      resolve({ code: exit, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), timedOut, outputOverflow })
    })
    child.stdin.on('error', () => {})
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}

/** SIGKILL to the whole process group of a child started with `group: true`. */
export function killGroup(child, signal = 'SIGKILL') {
  try {
    process.kill(-child.pid, signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // already gone
    }
  }
}

/** True while any process of the group led by `pid` is still alive. */
export function groupAlive(pid) {
  try {
    process.kill(-pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string, input?: string | Buffer }} [opts]
 * @returns {Buffer} stdout; throws on non-zero exit
 */
export function runSync(cmd, args, { cwd, input } = {}) {
  return execFileSync(cmd, args, { cwd, input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
}

/** @returns {Promise<string>} stdout; rejects with a short message on failure */
export async function runOk(cmd, args, opts) {
  const r = await run(cmd, args, opts)
  if (r.code !== 0) {
    throw new Error(`${cmd} ${args.slice(0, 3).join(' ')} failed (exit ${r.code}${r.timedOut ? ', timeout' : ''}${r.outputOverflow ? ', output limit exceeded' : ''}): ${errorSummary(r.stderr)}`)
  }
  return r.stdout
}
