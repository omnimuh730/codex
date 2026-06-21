import {
  LayoutDashboard, Bot, Terminal, Settings,
} from "lucide-react";
import type { RunSummary } from "../../hooks/use-dashboard";
import type { View } from "../../types";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuBadge,
} from "../ui/sidebar";

const NAV_ITEMS: { key: View; label: string; icon: typeof LayoutDashboard }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "agents", label: "Agents", icon: Bot },
  { key: "terminal", label: "Terminal", icon: Terminal },
  { key: "settings", label: "Settings", icon: Settings },
];

export function AppSidebarNav({ view, onViewChange, errorCount }: {
  view: View;
  onViewChange: (view: View) => void;
  errorCount: number;
}) {
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
            <SidebarMenuItem key={key}>
              <SidebarMenuButton
                isActive={view === key}
                tooltip={label}
                onClick={() => onViewChange(key)}
              >
                <Icon size={16} />
                <span>{label}</span>
                {key === "agents" && errorCount > 0 && (
                  <SidebarMenuBadge className="bg-red-500 text-white">{errorCount}</SidebarMenuBadge>
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export { NAV_ITEMS };
