// Per-run pause/resume control for the agent loop.
//
// Two ways a run pauses, both resolved by the same Resume:
//  - HANDOFF: codex ends a turn with `paused` (a step only a human can do).
//  - MANUAL: the user clicks Pause → we abort the current codex turn (the headed
//    browser stays open via its persistent session) and mark the run paused.
// Resume (the dashboard button → /api/runs/:id/resume) unblocks the run, which
// continues the SAME browser via codex thread-resume.

const runs = new Map(); // runId -> { ac, manualPaused, resumeResolve }

function rec(runId) {
  let r = runs.get(runId);
  if (!r) {
    r = { ac: null, manualPaused: false, resumeResolve: null };
    runs.set(runId, r);
  }
  return r;
}

/** Start tracking a run; returns the AbortSignal to pass to the current turn. */
export function registerRun(runId) {
  const r = rec(runId);
  r.ac = new AbortController();
  r.manualPaused = false;
  return r.ac.signal;
}

/** The current turn's AbortSignal (fresh after each resume). */
export function runSignal(runId) {
  return runs.get(runId)?.ac?.signal;
}

/** Manual pause: abort the in-flight codex turn. */
export function pauseRun(runId) {
  const r = runs.get(runId);
  if (!r?.ac || r.manualPaused) return false;
  r.manualPaused = true;
  r.ac.abort();
  return true;
}

export function wasManuallyPaused(runId) {
  return !!runs.get(runId)?.manualPaused;
}

/** Returns a promise that resolves (with a note) when the run is resumed. */
export function awaitHumanResume(runId) {
  return new Promise((resolve) => {
    rec(runId).resumeResolve = resolve;
  });
}

/** Resume a paused run (handoff or manual). Returns false if not paused. */
export function resumeRun(runId, note = "") {
  const r = runs.get(runId);
  if (!r?.resumeResolve) return false;
  const resolve = r.resumeResolve;
  r.resumeResolve = null;
  r.manualPaused = false;
  r.ac = new AbortController(); // fresh signal for the resumed turn
  resolve(note || "The required step has been completed.");
  return true;
}

/** Whether a run is currently paused awaiting resume. */
export function isAwaitingHuman(runId) {
  return !!runs.get(runId)?.resumeResolve;
}

export function unregisterRun(runId) {
  runs.delete(runId);
}
