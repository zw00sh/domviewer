import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { LogEntry } from "@/types/api";

/** Maps log level to a terminal-style colour class. */
const levelColor: Record<string, string> = {
  debug: "text-zinc-500",
  info: "text-blue-400",
  warn: "text-yellow-400",
  error: "text-red-400",
};

interface LogsTableProps {
  logs: LogEntry[];
  showClientId?: boolean;
}

/**
 * Terminal-style log viewer. Each line shows: timestamp · [level] · source · clientId · message.
 * Auto-scrolls to the bottom when new entries arrive.
 */
export function LogsTable({ logs, showClientId = true }: LogsTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom whenever new entries arrive
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs.length]);

  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground">No logs yet.</p>;
  }

  return (
    <div
      ref={containerRef}
      className="font-mono text-xs bg-card border rounded-md p-3 overflow-auto max-h-[600px]"
    >
      {logs.map((entry, i) => (
        <div key={i} className="flex gap-2 leading-5 min-w-0">
          {/* Timestamp */}
          <span className="text-muted-foreground shrink-0">
            {new Date(entry.timestamp).toLocaleTimeString()}
          </span>
          {/* Level */}
          <span className={cn("shrink-0", levelColor[entry.level] ?? "text-foreground")}>
            [{entry.level}]
          </span>
          {/* Source */}
          <span className="text-muted-foreground shrink-0">{entry.source}</span>
          {/* Client ID (short) */}
          {showClientId && (
            <span className="text-muted-foreground shrink-0">
              {entry.clientId.slice(0, 8)}
            </span>
          )}
          {/* Message */}
          <span className="break-all">{entry.message}</span>
        </div>
      ))}
    </div>
  );
}
