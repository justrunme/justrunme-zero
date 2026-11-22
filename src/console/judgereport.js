/**
 * The saved judge report for the Proof chain screen: `justrunme judge --hidden-trigger > file`,
 * then `justrunme console --judge-report file`. The file is read once, read only, and never
 * written. It may hold the CLI envelope (`{"command":"judge",...,"result":<report>}`) or the
 * bare report of src/judge/report.js buildReport().
 *
 * Fail closed: a missing file, a file that is not JSON, an envelope of another command or an
 * envelope without a result is `invalid`, with the reason, and no report is returned. The
 * Console then shows nothing of it as verified.
 */

import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const MAX_BYTES = 8 * 1024 * 1024

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const invalid = (file, reason) => ({ state: 'invalid', file, reason, report: null })

/**
 * @param {string|undefined|null} file
 * @returns {{ state: 'none'|'loaded'|'invalid', file: string|null, reason: string|null, report: object|null }}
 */
export function loadJudgeReport(file) {
  if (file === undefined || file === null) return { state: 'none', file: null, reason: null, report: null }
  if (typeof file !== 'string' || file === '') return invalid(null, 'no judge report file was named')
  const name = path.basename(file)
  let text
  try {
    const st = statSync(file)
    if (!st.isFile()) return invalid(name, 'the judge report is not a regular file')
    if (st.size > MAX_BYTES) return invalid(name, 'the judge report file is too large')
    text = readFileSync(file, 'utf8')
  } catch (err) {
    return invalid(name, err?.code === 'ENOENT' ? 'the judge report file does not exist' : 'the judge report file cannot be read')
  }
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return invalid(name, 'the judge report file is not valid JSON')
  }
  if (!isObject(data)) return invalid(name, 'the judge report file does not hold a JSON object')
  let report = data
  if ('command' in data) {
    if (data.command !== 'judge') return invalid(name, 'the file is the output of another command, not of judge')
    if (!isObject(data.result)) return invalid(name, 'the judge output holds no report (the judge run did not produce one)')
    report = data.result
  }
  if (!isObject(report.judge) || !Array.isArray(report.steps)) return invalid(name, 'the file is not a judge report')
  return { state: 'loaded', file: name, reason: null, report }
}
