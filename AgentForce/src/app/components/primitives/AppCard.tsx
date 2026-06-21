import React from "react";

export function AppCard({ children, className = "", onClick, style }: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-card rounded-2xl border border-border ${className}`}
      style={{ boxShadow: "var(--shadow-sm)", ...style }}
    >
      {children}
    </div>
  );
}
