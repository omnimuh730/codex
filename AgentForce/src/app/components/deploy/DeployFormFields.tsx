import type { ModelOption, ProfileOption, SourceOption } from "./types";

export function DeployFormFields({
  profiles, profileId, setProfileId,
  models, model, setModel, loadingMeta,
  sources, source, setSource,
  startIndex, setStartIndex, endIndex, setEndIndex,
  posted, sourceTitle, rangeCount,
}: {
  profiles: ProfileOption[];
  profileId: string;
  setProfileId: (v: string) => void;
  models: ModelOption[];
  model: string;
  setModel: (v: string) => void;
  loadingMeta: boolean;
  sources: SourceOption[];
  source: string;
  setSource: (v: string) => void;
  startIndex: number;
  setStartIndex: (v: number) => void;
  endIndex: number;
  setEndIndex: (v: number) => void;
  posted: number;
  sourceTitle: string;
  rangeCount: number;
}) {
  return (
    <>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-foreground">Applicant Profile</span>
        <select
          value={profileId}
          onChange={e => setProfileId(e.target.value)}
          className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          required
        >
          <option value="">Select profile from MongoDB…</option>
          {profiles.map(p => (
            <option key={p.id} value={p.id}>{p.fullName || p.name} · {p.email || p.resumeFolderUrl}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-foreground">Model</span>
        <select
          value={model}
          onChange={e => setModel(e.target.value)}
          disabled={!profileId || loadingMeta}
          className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
          required
        >
          <option value="">{loadingMeta ? "Loading models…" : "Select model…"}</option>
          {models.map(m => (
            <option key={m.id} value={m.id}>{m.id}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold text-foreground">
          Job Source <span className="text-muted-foreground font-normal">— posted, not yet applied</span>
        </span>
        <select
          value={source}
          onChange={e => setSource(e.target.value)}
          disabled={!profileId || !sources.length}
          className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
          required
        >
          <option value="">{!profileId ? "Select a profile first…" : sources.length ? "Select job source…" : "No posted jobs found"}</option>
          {sources.map(s => (
            <option key={s.title} value={s.title}>{s.title} · {s.type} — {s.posted} posted</option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-foreground">Start index</span>
          <input
            type="number"
            min={0}
            max={Math.max(0, posted - 1)}
            value={startIndex}
            onChange={e => setStartIndex(Math.max(0, parseInt(e.target.value || "0", 10) || 0))}
            className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-foreground">
            End index <span className="text-muted-foreground font-normal">(exclusive)</span>
          </span>
          <input
            type="number"
            min={startIndex + 1}
            max={posted}
            value={endIndex}
            onChange={e => setEndIndex(Math.max(startIndex + 1, parseInt(e.target.value || "0", 10) || 0))}
            className="w-full rounded-xl border border-border bg-white px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </label>
      </div>

      {sourceTitle && (
        <p className="text-xs text-muted-foreground -mt-1">
          {posted} posted {sourceTitle} job{posted === 1 ? "" : "s"} · agent will auto-bid{" "}
          <span className="font-semibold text-primary">{rangeCount}</span> one by one (index {startIndex}–{Math.max(startIndex, Math.min(endIndex, posted) - 1)}).
        </p>
      )}
    </>
  );
}
