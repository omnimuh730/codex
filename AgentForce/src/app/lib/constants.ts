export const mono = "font-['JetBrains_Mono'] tabular-nums";

export const HELP_TEXT = `Available commands:
  status              Show system status
  list agents         List deploy runs and their state
  list applications   List recently applied jobs
  clear               Clear terminal output
  help                Show this help message`;

export const PHASES = ["selecting", "navigating", "planning", "filling", "review", "submitting", "verifying"];

export const PHASE_LABEL: Record<string, string> = {
  starting: "Booting",
  selecting: "Matching résumé",
  navigating: "Navigating",
  planning: "Reading form",
  filling: "Filling",
  review: "Reviewing",
  review_pending: "Review gate",
  submitting: "Submitting",
  verifying: "Verifying",
};

export const VIEW_TITLES: Record<string, string> = {
  dashboard: "Monitor & Orchestrate",
  agents: "Agent Control",
  terminal: "Terminal",
  settings: "Settings",
};
