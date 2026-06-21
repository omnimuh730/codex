import { Loader2, Bot, FileText, Zap } from "lucide-react";
import type { HealthData } from "../../hooks/use-dashboard";
import { SettingsSection } from "./SettingsSection";

export function SettingsView({ health }: { health: HealthData | null }) {
  if (!health) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
        <Loader2 size={16} className="animate-spin" />Loading configuration…
      </div>
    );
  }

  const sections = [
    {
      section: "Backend",
      icon: Zap,
      items: [
        { label: "MongoDB database", value: health.mongoDb },
        { label: "MongoDB URI", value: health.mongoUri },
        { label: "Service healthy", value: health.ok ? "Yes" : "No" },
      ],
    },
    {
      section: "OpenAI",
      icon: Bot,
      items: [
        { label: "Default model", value: health.model },
        { label: "API key configured", value: health.keyPresent ? "Yes" : "No" },
        { label: "Auto-submit default", value: health.autoSubmit ? "On" : "Off" },
      ],
    },
    {
      section: "Paths",
      icon: FileText,
      items: [
        { label: "Resume data", value: health.resumeDataPath },
        { label: "Playwright cwd", value: health.playwrightCwd },
        { label: "Applications log", value: health.applicationsLog },
      ],
    },
  ];

  return (
    <div className="max-w-2xl space-y-4">
      {sections.map(({ section, icon, items }) => (
        <SettingsSection key={section} section={section} icon={icon} items={items} />
      ))}
    </div>
  );
}
