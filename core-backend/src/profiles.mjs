import fs from "node:fs";
import path from "node:path";
import { PATHS } from "./config.mjs";

function eeoValue(raw) {
  if (!raw) return "decline";
  const v = String(raw).toLowerCase();
  if (v === "decline" || v.includes("prefer not") || v.includes("not to say")) return "decline";
  return raw;
}

function sponsorshipYes(raw, pref) {
  if (pref === true) return true;
  if (!raw) return false;
  return String(raw).toLowerCase() === "yes";
}

function workAuthorized(immigration, sponsorship) {
  const imm = String(immigration || "").toLowerCase();
  if (imm.includes("citizen") || imm.includes("permanent") || imm.includes("green")) return true;
  if (String(sponsorship || "").toLowerCase() === "no") return true;
  return false;
}

function buildSummary(p) {
  const current = (p.careers || []).find(c => c.endPresent) || (p.careers || [])[0];
  const edu = (p.education || [])[0];
  const parts = [];
  if (current) parts.push(`${current.title} at ${current.company}`);
  if (edu) parts.push(`${edu.diploma} from ${edu.school}`);
  if (parts.length) return parts.join(". ") + ".";
  return `${p.fullName || "Applicant"} — software engineer.`;
}

/** Map MongoDB account_info.autoBidProfile → agent fill profile shape. */
export function transformAutoBidProfile(account) {
  const p = account.autoBidProfile || {};
  return {
    accountId: String(account._id),
    accountName: account.name,
    fullName: p.fullName || account.name,
    firstName: p.firstName || "",
    lastName: p.lastName || "",
    preferredName: p.firstName || p.fullName?.split(" ")[0] || "",
    email: p.email || "",
    phone: p.phone || "",
    location: {
      city: p.city || "",
      state: p.state || "",
      country: p.country || "United States",
      postalCode: p.zipCode || "",
      address: p.address || "",
    },
    links: {
      linkedin: p.linkedin || "",
      github: p.github || "",
      portfolio: p.portfolioUrl || p.github || "",
    },
    workAuthorizedUS: workAuthorized(p.immigrationStatus, p.sponsorship),
    requiresSponsorship: sponsorshipYes(p.sponsorship, p.prefSponsorship),
    willingToRelocate: true,
    remotePreference: "remote",
    earliestStartDate: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10),
    pronouns: eeoValue(p.pronouns),
    howDidYouHear: "Company website",
    noticePeriod: "2 weeks",
    desiredSalary: p.desiredSalary || p.desiredSalaryMin || "",
    voluntarySelfId: {
      gender: eeoValue(p.gender || p.demographicGenderIdentity),
      raceEthnicity: eeoValue(p.demographicRaceEthnicity),
      veteranStatus: eeoValue(p.demographicMilitaryStatus),
      disabilityStatus: eeoValue(p.demographicDisability),
    },
    education: p.education || [],
    careers: p.careers || [],
    summary: buildSummary(p),
    resumeFolderUrl: p.resumeFolderUrl || "",
    resumeCatalog: account.resumeCatalog || {},
    openaiApiKey: p.openaiApiKey || "",
    deepseekApiKey: p.deepseekApiKey || "",
    openaiModel: p.openaiModel || "",
    // Secrets the agent uses to self-resolve gates (passed to codex via env, never
    // into the model prompt): Gmail (read OTP/verification emails) + a default
    // password for ATS register/sign-in.
    gmailAppPassword: p.gmailAppPassword || "",
    defaultPassword: p.defaultPassword || "",
  };
}

export function profileSummary(account) {
  const p = account.autoBidProfile || {};
  return {
    id: String(account._id),
    name: account.name,
    fullName: p.fullName || account.name,
    email: p.email || "",
    resumeFolderUrl: p.resumeFolderUrl || "",
    defaultModel: p.openaiModel || "",
    tier: account.tier || "",
    resumeStacks: Object.keys(account.resumeCatalog || {}),
  };
}

export function pickResumeStack(resumeCatalog, jobContext = "") {
  const stacks = Object.keys(resumeCatalog || {});
  if (!stacks.length) return null;
  const ctx = jobContext.toLowerCase();
  let best = stacks[0];
  let bestScore = -1;
  for (const stack of stacks) {
    let score = 0;
    const skills = resumeCatalog[stack] || {};
    for (const [skill, weight] of Object.entries(skills)) {
      if (ctx.includes(skill.toLowerCase())) score += Number(weight) || 0;
    }
    if (stack.toLowerCase().split(/[^a-z0-9+]+/).some(w => w.length > 2 && ctx.includes(w))) {
      score += 3;
    }
    if (score > bestScore) {
      bestScore = score;
      best = stack;
    }
  }
  return best;
}

/** First resume stack in catalog that has a PDF on disk (deploy-time validation only). */
export function firstResumeStackWithPdf(resumeCatalog, resumeFolderUrl) {
  for (const stack of Object.keys(resumeCatalog || {}).sort((a, b) => a.localeCompare(b))) {
    if (resolveResumePdf(resumeFolderUrl, stack)) return stack;
  }
  return null;
}

export function resumeFolderPath(resumeFolderUrl) {
  if (!resumeFolderUrl) return null;
  return path.join(PATHS.data, resumeFolderUrl);
}

export function listResumeStacks(resumeFolderUrl) {
  const dir = resumeFolderPath(resumeFolderUrl);
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort((a, b) => a.localeCompare(b));
}

/** Resolve an absolute path to a PDF resume inside a stack folder. */
export function resolveResumePdf(resumeFolderUrl, stackName) {
  const dir = resumeFolderPath(resumeFolderUrl);
  if (!dir) return null;
  const stackDir = path.join(dir, stackName);
  if (!fs.existsSync(stackDir)) return null;
  const pdf = fs.readdirSync(stackDir).find(f => f.toLowerCase().endsWith(".pdf"));
  return pdf ? path.join(stackDir, pdf) : null;
}

/** @deprecated Prefer attachResumeFromLibrary in user-resumes.mjs (MongoDB). */
export function attachResumePathSync(profile, { stackName } = {}) {
  const stack = stackName || firstResumeStackWithPdf(profile.resumeCatalog, profile.resumeFolderUrl) || "";
  const pdfPath = stack ? resolveResumePdf(profile.resumeFolderUrl, stack) : null;
  return {
    ...profile,
    resumeStack: stack || "",
    resumePath: pdfPath || "",
    resumeDir: profile.resumeFolderUrl ? resumeFolderPath(profile.resumeFolderUrl) : "",
  };
}
