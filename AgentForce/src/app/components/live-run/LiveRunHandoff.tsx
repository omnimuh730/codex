import { useState } from "react";

// Shown when codex pauses for a human to complete a step (login, CAPTCHA,
// verification) in the open browser. Clicking Resume unblocks the run; the
// incoming activity then clears this banner.
export function LiveRunHandoff({ runId, reason }: { runId: string; reason: string }) {
  const [resuming, setResuming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const resume = async () => {
    setResuming(true);
    setErr(null);
    try {
      const r = await fetch(`/api/runs/${runId}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: "The human has completed the required step in the browser." }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setErr(j.error || `Resume failed (${r.status})`);
        setResuming(false);
      }
      // On success the next activity event clears the banner; leave button disabled.
    } catch (e) {
      setErr(String((e as Error).message));
      setResuming(false);
    }
  };

  return (
    <div className="mx-4 my-2 flex items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3">
      <span className="text-lg text-amber-600">⏸</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-amber-800">Human action needed</div>
        <div className="text-xs text-amber-700">{reason} — complete it in the open browser, then resume.</div>
        {err && <div className="mt-1 text-xs text-red-600">{err}</div>}
      </div>
      <button
        onClick={resume}
        disabled={resuming}
        className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {resuming ? "Resuming…" : "Resume"}
      </button>
    </div>
  );
}
