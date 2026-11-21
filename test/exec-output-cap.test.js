import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run, runOk, DEFAULT_MAX_OUTPUT_BYTES } from '../src/util/exec.js'

const node = process.execPath
const flood = 'process.stdout.write("x".repeat(100000)); process.stderr.write("y".repeat(100000))'

test('default cap is 8 MiB', () => {
  assert.equal(DEFAULT_MAX_OUTPUT_BYTES, 8 * 1024 * 1024)
})

test('overflow kills the child, bounds output and fails closed', async () => {
  const r = await run(node, ['-e', 'setInterval(()=>process.stdout.write("x".repeat(65536)),1)'], { maxOutputBytes: 1024, timeoutMs: 20000 })
  assert.equal(r.outputOverflow, true)
  assert.notEqual(r.code, 0)
  assert.equal(r.timedOut, false)
  assert.ok(Buffer.byteLength(r.stdout) + Buffer.byteLength(r.stderr) <= 1024)
})

test('overflow fails even when the child exits 0, combined across streams', async () => {
  const r = await run(node, ['-e', flood], { maxOutputBytes: 150000 })
  assert.equal(r.outputOverflow, true)
  assert.notEqual(r.code, 0)
  assert.ok(Buffer.byteLength(r.stdout) + Buffer.byteLength(r.stderr) <= 150000)
})

test('overflow works with a process group', async () => {
  const r = await run(node, ['-e', flood], { maxOutputBytes: 1000, group: true })
  assert.equal(r.outputOverflow, true)
  assert.notEqual(r.code, 0)
})

test('normal output under the cap is unchanged', async () => {
  const r = await run(node, ['-e', 'process.stdout.write("hi"); process.stderr.write("err")'], { maxOutputBytes: 1024 })
  assert.equal(r.code, 0)
  assert.equal(r.stdout, 'hi')
  assert.equal(r.stderr, 'err')
  assert.equal(r.outputOverflow, false)
  assert.equal(r.timedOut, false)
})

test('output exactly at the cap is not an overflow', async () => {
  const r = await run(node, ['-e', 'process.stdout.write("x".repeat(100))'], { maxOutputBytes: 100 })
  assert.equal(r.code, 0)
  assert.equal(r.outputOverflow, false)
  assert.equal(r.stdout.length, 100)
})

test('timeout behavior is preserved', async () => {
  const r = await run(node, ['-e', 'setTimeout(()=>{},60000)'], { timeoutMs: 200 })
  assert.equal(r.timedOut, true)
  assert.equal(r.outputOverflow, false)
  assert.notEqual(r.code, 0)
})

test('runOk rejects on overflow even if the child exits 0', async () => {
  await assert.rejects(runOk(node, ['-e', flood], { maxOutputBytes: 1000 }), /output limit exceeded/)
})

test('runOk returns stdout for normal output', async () => {
  assert.equal(await runOk(node, ['-e', 'process.stdout.write("ok")']), 'ok')
})

test('invalid cap is rejected rather than disabling the limit', () => {
  for (const cap of [0, -1, Infinity, NaN, 1.5, '1024']) {
    assert.throws(() => run(node, ['-e', ''], { maxOutputBytes: cap }), RangeError)
  }
})
