export interface RunStep { seq: number; level: string; title: string; detail?: string }
export interface RunField { label: string; value: string; source: string }
export interface RunUsage {
  model?: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  costLabel?: string;
}

export interface RunMeta {
  role?: string;
  company?: string;
  profileName?: string;
  model?: string;
  resumeStack?: string;
}

export interface RunDone {
  result: string;
  message: string;
  usage?: RunUsage;
  submitted?: number;
  total?: number;
}

export interface RunJob {
  index: number;
  total: number;
  title: string;
  company: string;
}

export interface RunBatch {
  total: number;
  source: string;
}

export interface ResumeMatch {
  jobTitle?: string;
  jobCompany?: string;
  jobDescription?: string;
  jobSkills?: string[];
  skillProfile?: string;
  analysisError?: string | null;
  bestResume?: { name: string; scorePercent: number };
  topResumes?: { name: string; scorePercent: number }[];
  resumeStack?: string;
}

export interface Screenshot {
  label: string;
  dataUrl: string;
}

// Per-job slice of a batch run — each job keeps its own activity, fields, screenshot, etc.
export interface JobView {
  index: number;
  title: string;
  company: string;
  steps: RunStep[];
  fields: RunField[];
  shot: Screenshot | null;
  status: string;
  meta: RunMeta;
  resumeMatch: ResumeMatch | null;
  result?: string;
}
