import React from "react";

export function AppButton({ children, variant = "default", size = "md", className = "", onClick, disabled, type = "button" }: {
  children: React.ReactNode;
  variant?: "primary" | "default" | "ghost" | "danger" | "outline";
  size?: "sm" | "md" | "lg";
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  const sizes = { sm: "px-3 py-1.5 text-xs", md: "px-4 py-2 text-sm", lg: "px-5 py-2.5 text-sm" };
  const variants = {
    primary: "bg-primary text-white hover:bg-primary/90 active:bg-primary/80 shadow-sm",
    default: "bg-white text-foreground border border-border hover:bg-secondary active:bg-muted shadow-xs",
    ghost: "text-muted-foreground hover:text-foreground hover:bg-secondary",
    danger: "bg-destructive text-white hover:bg-destructive/90 shadow-sm",
    outline: "border border-primary text-primary hover:bg-primary/5",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 font-medium rounded-xl transition-all duration-150 cursor-pointer select-none
        ${sizes[size]} ${variants[variant]}
        ${disabled ? "opacity-40 cursor-not-allowed pointer-events-none" : ""}
        ${className}`}
      style={variant === "primary" ? { boxShadow: "0 1px 2px rgba(232,68,42,0.25)" } : undefined}
    >
      {children}
    </button>
  );
}
