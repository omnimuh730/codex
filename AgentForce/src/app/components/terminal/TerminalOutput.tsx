import { useEffect, useRef } from "react";
import type { TerminalLine } from "../../types";
import { mono } from "../../lib/constants";
import { terminalLineColor } from "../../lib/status-styles";

export function TerminalOutput({ lines }: { lines: TerminalLine[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-0.5" style={{ minHeight: 400 }}>
      {lines.map(line => (
        <div
          key={line.id}
          className={`${mono} leading-relaxed whitespace-pre-wrap break-all`}
          style={{ fontSize: 12.5, color: terminalLineColor(line.type) }}
        >
          {line.content}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
