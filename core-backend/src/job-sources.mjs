// Canonical job-source (ATS / job board) registry. Self-contained copy so AgentForce
// does not depend on the demo/ folder. Each entry maps a source title to host token(s)
// (pipe-separated) used to classify an apply link.
export const JobSource = [
  { type: "Legal", title: "LinkedIn", url: "linkedin.com" },
  { type: "Legal", title: "Indeed", url: "indeed.com" },
  { type: "Legal", title: "ZipRecruiter", url: "ziprecruiter.com" },
  { type: "Legal", title: "Wellfound", url: "wellfound.com" },
  { type: "Autobid", title: "Greenhouse", url: "greenhouse.io" },
  { type: "Autobid", title: "Workday", url: "myworkdayjobs.com | myworkdaysite.com" },
  { type: "Extension", title: "Workable", url: "workable.com" },
  { type: "Extension", title: "Ashby", url: "ashbyhq.com" },
  { type: "Extension", title: "Lever", url: "lever.co" },
  { type: "OneStep", title: "Jobvite", url: "jobvite.com" },
  { type: "OneStep", title: "SmartRecruiters", url: "smartrecruiters.com" },
  { type: "OneStep", title: "BambooHR", url: "bamboohr.com" },
  { type: "OneStep", title: "Recruitee", url: "recruitee.com" },
  { type: "OneStep", title: "Teamtailor", url: "teamtailor.com" },
  { type: "OneStep", title: "Personio", url: "personio.com" },
  { type: "OneStep", title: "Rippling", url: "rippling.com" },
  { type: "OneStep", title: "Dover", url: "dover.com" },
  { type: "OneStep", title: "Applytojob", url: "applytojob.com" },
  { type: "OneStep", title: "Jobdiva", url: "jobdiva.com" },
  { type: "OneStep", title: "Breezy", url: "breezy.hr" },
  { type: "OneStep", title: "Gusto", url: "gusto.com" },
  { type: "OneStep", title: "Rippling-ATS", url: "rippling-ats.com" },
  { type: "OneStep", title: "Pinpointhq", url: "pinpointhq.com" },
  { type: "OneStep", title: "Freshteam", url: "freshteam.com" },
  { type: "OneStep", title: "Recruiterflow", url: "recruiterflow.com" },
  { type: "OneStep", title: "Gem", url: "gem.com" },
  { type: "MultiStep", title: "OracleCloud", url: "oraclecloud.com" },
  { type: "MultiStep", title: "Paylocity", url: "paylocity.com" },
  { type: "MultiStep", title: "ADP", url: "adp.com" },
  { type: "MultiStep", title: "iCIMS", url: "icims.com" },
  { type: "MultiStep", title: "UltiPro", url: "ultipro.com" },
  { type: "MultiStep", title: "UKG", url: "ukg.net" },
  { type: "MultiStep", title: "Paycom", url: "paycomonline.net" },
  { type: "MultiStep", title: "DayforceHCM", url: "dayforcehcm.com" },
  { type: "MultiStep", title: "Zohorecruit", url: "zohorecruit.com" },
  { type: "MultiStep", title: "BestJobTool", url: "bestjobtool.com" },
  { type: "MultiStep", title: "Taleo", url: "taleo.net" },
  { type: "Other", title: "Other", url: "" },
];

/** All source titles in declared order. */
export const JobSourceTitles = JobSource.map((s) => s.title);

/** Source titles grouped by `type`, preserving declaration order. */
export const JobSourceGroups = (() => {
  const order = [];
  const byType = new Map();
  for (const s of JobSource) {
    if (!byType.has(s.type)) { byType.set(s.type, []); order.push(s.type); }
    byType.get(s.type).push(s.title);
  }
  return order.map((type) => ({ type, titles: byType.get(type) }));
})();

/** Host tokens (lowercased) for each non-"Other" source, longest-first. */
const SOURCE_TOKENS = JobSource
  .filter((s) => s.title !== "Other" && s.url)
  .flatMap((s) =>
    String(s.url).split("|").map((t) => t.trim().toLowerCase()).filter(Boolean).map((token) => ({ token, title: s.title })),
  )
  .sort((a, b) => b.token.length - a.token.length);

/** Canonical job source for an apply link (e.g. jobs.ashbyhq.com → "Ashby"). */
export function inferJobSource(applyLink) {
  const url = String(applyLink ?? "").trim().toLowerCase();
  if (!url) return "Other";
  let host = url;
  if (host.startsWith("https://")) host = host.slice(8);
  else if (host.startsWith("http://")) host = host.slice(7);
  const slash = host.indexOf("/");
  if (slash !== -1) host = host.slice(0, slash);
  for (const { token, title } of SOURCE_TOKENS) {
    if (host.includes(token)) return title;
  }
  return "Other";
}
