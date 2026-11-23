/**
 * Exit codes of the justrunme CLI (T18). Stable: CI scripts may depend on them.
 * Every non-zero result also prints JSON with `error.code` naming the exact reason.
 */

export const EXIT = Object.freeze({
  OK: 0, // command did what was asked; for rehearse: verdict SAFE
  INTERNAL: 1, // unexpected error (bug or environment failure)
  USAGE: 2, // unknown command, missing or invalid argument
  CONFIG: 3, // contract or target file invalid, operator key missing
  DATA_LOSS: 10, // rehearse: verdict DATA LOSS (measured, nothing real touched)
  REHEARSAL_FAILED: 11, // rehearse: a step failed in the copy, or the copy did not start
  NO_PLAN_SELECTED: 12, // compare: no plan survived the rule
  RUN_FAILED: 13, // run: a step failed in the real run; the capture is ready for undo
  RECOVERY_FAILED: 14, // undo: restore or verification did not reach RECOVERED
  COMPARISON_REFUSED: 20, // compare refused (base or conditions differ, report invalid, ...)
  AUTHORIZATION_REFUSED: 21, // authorize refused (DATA_LOSS, FIDELITY_MISMATCH, PLAN_NOT_SELECTED, ...)
  RUN_REFUSED: 22, // run refused (no authorization, expired, target changed, ...)
  UNDO_REFUSED: 23, // undo refused (capture invalid, unsupported resource)
  MAINTENANCE_REFUSED: 24, // reanchor or lock recovery refused
  REHEARSAL_REFUSED: 25, // rehearse refused before running anything (SELF_REFERENCE, UNBINDABLE_STEP, CHAIN_INVALID)
  RUN_INCOMPLETE: 15, // run: completed, but steps that need approval were skipped
  REHEARSAL_UNCLEAN: 16, // rehearse: copy not fully removed (containers, volumes, network or worktree left)
  EMERGENCY_RECOVERED: 17, // undo --emergency-recovery: RECOVERED and verified, evidence_status "unverified" (journal, not chain)
  INTEGRITY: 30, // verify or replay found a broken chain, a policy violation or a bad selection;
  //               or a command did its work but could not record it (error.code RESULT_UNRECORDED)
  JUDGE_FAILED: 40, // judge: a step did not match, or the 60 s budget was exceeded
  JUDGE_ENVIRONMENT: 41, // judge: Docker unavailable or the demo database could not be prepared
  APPROVAL_REFUSED: 26, // approve or deny refused (request unknown, expired, answered, changed files, ...)
  CHAIN_LOCKED: 31, // the receipt chain lock is held or stuck; see `justrunme lock inspect`
  LOGIC_CHANGE: 18, // rehearse: verdict LOGIC CHANGE (an existing trigger, rule or function removed or redefined)
  LOGIC_BYPASS: 19, // rehearse: verdict LOGIC BYPASS (database logic switched off, skipped or replaced, even temporarily)
  UNVERIFIABLE: 27, // rehearse: the observers or the plan role of the rehearsal cannot be trusted
  INVARIANT_VIOLATED: 28, // rehearse: an invariant of the mission does not hold after the plan
  REQUIREMENT_UNMET: 29, // rehearse: a required change of the mission was not made
  CONFLICT: 32, // rehearse: the mission's requirements cannot all hold (CONFLICT: requirements unsatisfiable); nothing ran
  RECOVERY_UNVERIFIED: 33, // undo: restored and nothing failed, but a required check could not be made (RESTORED_UNVERIFIED)
  THRESHOLD_EXCEEDED: 37, // rehearse: max_rows_deleted policy threshold breached
  GATE_INACTIVE: 34, // gate-probe: the probe command ran unblocked (INACTIVE)
  GATE_UNKNOWN: 35, // gate-probe: no proof either way yet (UNKNOWN; never means blocked)
  RECOVERY_NOT_PROVEN: 36, // chaos: the recovery rehearsal did not end RECOVERY PROVEN (see the verdict)
})

/** Exit code for a rehearsal verdict. */
const VERDICT_EXIT = { SAFE: EXIT.OK, 'DATA LOSS': EXIT.DATA_LOSS, 'LOGIC CHANGE': EXIT.LOGIC_CHANGE, 'LOGIC BYPASS': EXIT.LOGIC_BYPASS, UNVERIFIABLE: EXIT.UNVERIFIABLE, 'INVARIANT VIOLATED': EXIT.INVARIANT_VIOLATED, 'REQUIREMENT UNMET': EXIT.REQUIREMENT_UNMET, 'THRESHOLD EXCEEDED': EXIT.THRESHOLD_EXCEEDED }
export const verdictExit = (verdict) => VERDICT_EXIT[verdict] ?? EXIT.REHEARSAL_FAILED
