// Per-run pause / resume / stop control for the agent loop.
//
// A run can pause two ways, both cleared by the same Resume:
//  - HANDOFF: codex ends a turn with `paused` (a step only a human can do).
//  - MANUAL:  the user clicks Pause → we abort the in-flight codex turn (the headed
//    browser stays open via its persistent session) and mark the run paused.
// Resume (dashboard → POST /api/runs/:id/resume) unblocks the run, which continues
// the SAME browser via codex thread-resume.
//
// STOP (dashboard → POST /api/runs/:id/stop) is terminal: it aborts the current
// turn AND unblocks any pause-wait, so the run loop exits promptly; the caller then
// closes the run's browser session. `stopped` is sticky so the loop never resumes.

const runs = new Map(); // runId -> { ac, manualPaused, stopped, resumeResolve }

function rec(runId) {
  let r = runs.get(runId);
  if (!r) {
    r = { ac: null, manualPaused: false, stopped: false, resumeResolve: null };
    runs.set(runId, r);
  }
  return r;
}

/** Start tracking a run; returns the AbortSignal for the first turn. */
export function registerRun(runId) {
  const r = rec(runId);
  r.ac = new AbortController();
  r.manualPaused = false;
  r.stopped = false;
  return r.ac.signal;
}

/** The CURRENT turn's AbortSignal (replaced with a fresh one after each resume). */
export function runSignal(runId) {
  return runs.get(runId)?.ac?.signal;
}

/** Manual pause: abort the in-flight codex turn (browser stays open). */
export function pauseRun(runId) {
  const r = runs.get(runId);
  if (!r?.ac || r.manualPaused || r.stopped) return false;
  r.manualPaused = true;
  r.ac.abort();
  return true;
}

export function wasManuallyPaused(runId) {
  return !!runs.get(runId)?.manualPaused;
}

/** Stop a run for good: abort the current turn and release any pause-wait. */
export function stopRun(runId) {
  const r = runs.get(runId);
  if (!r || r.stopped) return false;
  r.stopped = true;
  r.ac?.abort();
  // If the loop is parked awaiting resume, release it so it can exit.
  if (r.resumeResolve) {
    const resolve = r.resumeResolve;
    r.resumeResolve = null;
    resolve("__stopped__");
  }
  return true;
}

export function wasStopped(runId) {
  return !!runs.get(runId)?.stopped;
}

/** Resolves (with a note) when the run is resumed or stopped. */
export function awaitHumanResume(runId) {
  return new Promise((resolve) => {
    rec(runId).resumeResolve = resolve;
  });
}

/** Resume a paused run (handoff or manual). Returns false if not paused. */
export function resumeRun(runId, note = "") {
  const r = runs.get(runId);
  if (!r?.resumeResolve || r.stopped) return false;
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
