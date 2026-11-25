import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runExitCode } from '../src/cli/commands.js'
import { EXIT } from '../src/cli/codes.js'

describe('run exit status is fail-closed on measured outcome', () => {
  const result = { ok: true, skipped_needs_approval: [], outcome: { matches: true, differences: [] } }
  it('returns success only for a measured match', () => assert.equal(runExitCode(result), EXIT.OK))
  it('returns failure for a measured mismatch', () => assert.equal(runExitCode({ ...result, outcome: { matches: false, differences: [{ what: 'row mismatch' }] } }), EXIT.RUN_FAILED))
  it('returns failure for unmeasurable or missing outcome', () => {
    for (const outcome of [null, undefined, { matches: null, differences: [] }]) {
      assert.equal(runExitCode({ ...result, outcome }), EXIT.RUN_FAILED)
    }
  })
  it('returns failure for failed steps even if measurements match', () => assert.equal(runExitCode({ ...result, ok: false }), EXIT.RUN_FAILED))
  it('returns incomplete for skipped steps with a measured match', () => assert.equal(runExitCode({ ...result, skipped_needs_approval: ['manual'] }), EXIT.RUN_INCOMPLETE))
})
