import { Zap } from "lucide-react";
import { mono } from "../../lib/constants";
import type { ResumeMatch } from "./types";

export function LiveRunResumeMatch({ resumeMatch }: { resumeMatch: ResumeMatch }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
        <Zap size={12} className="text-violet-500" />JD skill match → résumé
      </p>
      <div className="rounded-xl border border-border overflow-hidden">
        {(resumeMatch.jobTitle || resumeMatch.jobDescription || (resumeMatch.jobSkills && resumeMatch.jobSkills.length > 0)) && (
          <div className="px-3.5 py-2.5 border-b border-border bg-secondary/20 space-y-2">
            {(resumeMatch.jobTitle || resumeMatch.jobCompany) && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Job</p>
                <p className="text-sm font-semibold text-foreground leading-snug">
                  {resumeMatch.jobTitle || "—"}{resumeMatch.jobCompany ? ` @ ${resumeMatch.jobCompany}` : ""}
                </p>
              </div>
            )}
            {resumeMatch.jobSkills && resumeMatch.jobSkills.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">Listed skills</p>
                <div className="flex flex-wrap gap-1">
                  {resumeMatch.jobSkills.map(s => (
                    <span key={s} className="text-[11px] text-foreground/80 bg-secondary border border-border rounded-md px-1.5 py-0.5">{s}</span>
                  ))}
                </div>
              </div>
            )}
            {resumeMatch.jobDescription && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Description</p>
                <p className="text-xs text-foreground/75 leading-relaxed max-h-28 overflow-auto whitespace-pre-wrap">{resumeMatch.jobDescription}</p>
              </div>
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 px-3.5 py-2 border-b border-border bg-secondary/40">
          <span className="text-sm font-semibold text-foreground truncate">{resumeMatch.resumeStack || resumeMatch.bestResume?.name || "—"}</span>
          {resumeMatch.bestResume?.scorePercent != null && (
            <span className="text-xs font-bold text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5 shrink-0">{resumeMatch.bestResume.scorePercent}% match</span>
          )}
        </div>
        {resumeMatch.skillProfile
          ? <pre className={`${mono} text-[11px] leading-relaxed text-foreground/80 px-3.5 py-2 max-h-44 overflow-auto whitespace-pre`}>{resumeMatch.skillProfile}</pre>
          : resumeMatch.analysisError
            ? <p className="text-xs text-amber-700 bg-amber-50 px-3.5 py-2">{resumeMatch.analysisError}</p>
            : <p className="text-xs text-muted-foreground px-3.5 py-2">JD skill profile not available — resumeCatalog ranking did not run.</p>}
        {resumeMatch.topResumes && resumeMatch.topResumes.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2 border-t border-border">
            <span className="text-xs text-muted-foreground">alternatives:</span>
            {resumeMatch.topResumes.slice(1).map(r => (
              <span key={r.name} className="text-xs text-muted-foreground bg-secondary rounded-md px-1.5 py-0.5">{r.name} · {r.scorePercent}%</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
