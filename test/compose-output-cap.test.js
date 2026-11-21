import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dump, serverLog, PG_DUMP_MAX_OUTPUT_BYTES, SERVER_LOG_MAX_OUTPUT_BYTES } from '../src/rehearsal/compose.js'
import { DEFAULT_MAX_OUTPUT_BYTES } from '../src/util/exec.js'

test('named caps: pg_dump is 1 GiB and above the default', () => {
  assert.equal(PG_DUMP_MAX_OUTPUT_BYTES, 1024 ** 3)
  assert.ok(PG_DUMP_MAX_OUTPUT_BYTES > DEFAULT_MAX_OUTPUT_BYTES)
  assert.ok(SERVER_LOG_MAX_OUTPUT_BYTES > DEFAULT_MAX_OUTPUT_BYTES)
})

// A fake `docker` first on PATH (given as the target's whole env, as the judge does).
function fakeTarget(t, script, name) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jrm-fakedocker-'))
  const file = path.join(dir, 'docker')
  writeFileSync(file, `#!${process.execPath}\n${script}\n`)
  chmodSync(file, 0o755)
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { project: name, composeFile: '/x/compose.yml', dbService: 'db', dbUser: 'u', dbName: 'd', env: { PATH: dir } }
}

test('dump accepts output above the 8 MiB default (passes the larger cap)', async (t) => {
  const target = fakeTarget(t, `
const a = process.argv.slice(2)
if (a.includes('ps')) { console.log('abcdef012345'); process.exit(0) }
if (a[0] === 'exec') { process.stdout.write('x'.repeat(9 * 1024 * 1024), () => process.exit(0)); return }
process.exit(1)`, 'capdump')
  const out = await dump(target)
  assert.equal(out.length, 9 * 1024 * 1024)
})

test('serverLog fails closed when the log exceeds its cap, never returns a partial log', async (t) => {
  const target = fakeTarget(t, `
const a = process.argv.slice(2)
if (a.includes('ps')) { console.log('abcdef012345'); process.exit(0) }
if (a[0] === 'logs') { const c = Buffer.alloc(1024 * 1024, 120); const w = () => { while (process.stdout.write(c)); process.stdout.once('drain', w) }; w() }
else process.exit(1)`, 'caplogs')
  await assert.rejects(serverLog(target), /output limit exceeded/)
})

test('serverLog returns a small log whole', async (t) => {
  const target = fakeTarget(t, `
const a = process.argv.slice(2)
if (a.includes('ps')) { console.log('abcdef012345'); process.exit(0) }
if (a[0] === 'logs') { process.stdout.write('hello', () => process.exit(0)); return }
process.exit(1)`, 'caplogsok')
  assert.equal(await serverLog(target), 'hello\n')
})
