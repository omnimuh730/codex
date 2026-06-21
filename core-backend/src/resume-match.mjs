const SCORE_LINE = /^(.+?)\s+[█#\-*=.\u2588\u2593\u2592\u2591\s]+\s*(\d{1,2})\s*$/;
const SIMPLE_LINE = /^(.+?)\s+(\d{1,2})\s*$/;
const COLON_LINE = /^(.+?):\s*(\d{1,2})\s*$/;

function normalizeSkillName(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[./]/g, "");
}

function parseSkillLine(rawLine) {
  let line = String(rawLine ?? "")
    .trim()
    .replace(/^[-*•]\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s*/, "");
  if (!line || line.startsWith("---")) return null;

  for (const pattern of [SCORE_LINE, COLON_LINE, SIMPLE_LINE]) {
    const match = line.match(pattern);
    if (!match) continue;

    const score = Number(match[2]);
    if (!Number.isFinite(score) || score < 0 || score > 10) continue;

    let skill = match[1]
      .trim()
      .replace(/[█#\-*=.\u2588\u2593\u2592\u2591]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!skill || /^(output format|skill name|examples?)$/i.test(skill)) continue;

    return { skill, score };
  }

  const trailing = line.match(/^(.+?)\s+(\d{1,2})\s*$/);
  if (trailing) {
    const score = Number(trailing[2]);
    if (Number.isFinite(score) && score >= 0 && score <= 10) {
      const skill = trailing[1]
        .replace(/[█#\-*=.\u2588\u2593\u2592\u2591]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (skill) return { skill, score };
    }
  }

  return null;
}

export function parseSkillProfile(skillProfileText) {
  const scores = new Map();

  for (const line of String(skillProfileText ?? "").split("\n")) {
    const parsed = parseSkillLine(line);
    if (parsed) {
      scores.set(normalizeSkillName(parsed.skill), parsed.score);
    }
  }

  return scores;
}

function buildResumeSkillMap(resumeProfile) {
  const map = new Map();
  for (const [skill, score] of Object.entries(resumeProfile || {})) {
    map.set(normalizeSkillName(skill), Number(score) || 0);
  }
  return map;
}

function skillProfileArrayToMap(skillProfile) {
  if (!Array.isArray(skillProfile) || !skillProfile.length) return null;
  const map = {};
  for (const item of skillProfile) {
    const name = item?.name || item?.skill;
    if (!name) continue;
    map[name] = Number(item.strength ?? item.score) || 0;
  }
  return Object.keys(map).length ? map : null;
}

function lookupResumeScore(resumeScores, jdSkill) {
  const direct = resumeScores.get(jdSkill);
  if (direct !== undefined) return direct;

  for (const [skill, score] of resumeScores) {
    if (skill.includes(jdSkill) || jdSkill.includes(skill)) {
      return score;
    }
  }

  return 0;
}

export function scoreResume(jdScores, resumeProfile) {
  const resumeScores = buildResumeSkillMap(resumeProfile);
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [skill, jdScore] of jdScores) {
    if (jdScore <= 0) continue;
    const weight = jdScore * jdScore;
    totalWeight += weight;
    const resumeScore = lookupResumeScore(resumeScores, skill);
    weightedSum += weight * (Math.min(jdScore, resumeScore) / jdScore);
  }

  if (totalWeight === 0) return 0;
  return weightedSum / totalWeight;
}

export function rankResumes(jdSkillProfileText, resumesCatalog, topN = 3) {
  const jdScores = parseSkillProfile(jdSkillProfileText);
  if (jdScores.size === 0) {
    return [];
  }

  const ranked = Object.entries(resumesCatalog || {})
    .map(([name, profile]) => ({
      name,
      score: scoreResume(jdScores, profile),
    }))
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, topN);
}

/** Score uploaded resume against JD using doc skillProfile, catalog, or techStack tokens. */
export function scoreUploadedResume(jdScores, resume, catalog) {
  const fromDoc = skillProfileArrayToMap(resume?.skillProfile);
  if (fromDoc) return scoreResume(jdScores, fromDoc);

  const stackProfile = catalog?.[resume.techStack];
  if (stackProfile && typeof stackProfile === "object") {
    return scoreResume(jdScores, stackProfile);
  }

  const tokens = String(resume.techStack || "")
    .split(/[+,&/|()]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const fallbackProfile = Object.fromEntries(tokens.map((t, i) => [t, Math.max(5, 10 - i)]));
  return scoreResume(jdScores, fallbackProfile);
}

export function rankUploadedResumes(jdSkillProfileText, uploadedResumes, catalog, topN = 5) {
  const jdScores = parseSkillProfile(jdSkillProfileText);
  if (jdScores.size === 0) return [];

  return (uploadedResumes || [])
    .map((resume) => ({
      id: String(resume._id),
      fileName: resume.fileName,
      techStack: resume.techStack,
      score: scoreUploadedResume(jdScores, resume, catalog),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

/** Build a simple JD skill profile from job.skills when LLM analysis is unavailable. */
export function buildJdSkillProfileText(job) {
  const lines = [];
  for (const skill of job?.skills || []) {
    const name = String(skill || "").trim();
    if (name) lines.push(`${name} 8`);
  }
  return lines.join("\n");
}

export function formatJdSkillProfileDisplay(jdScores) {
  if (!jdScores?.size) return null;
  return [...jdScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([skill, score]) => `${skill} ${score}`)
    .join("\n");
}
