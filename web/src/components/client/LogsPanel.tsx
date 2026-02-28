import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useWebSocket } from "@/hooks/use-websocket";
import { LogsTable } from "@/components/logs/LogsTable";
import { Badge } from "@/components/ui/badge";
import { buildViewerWsUrl, buildLogViewerWsUrl } from "@/lib/utils";
import type { LogEntry } from "@/types/api";

const LEVELS = ["debug", "info", "warn", "error"] as const;

interface LogsPanelProps {
  /** Omit for global logs */
  clientId?: string;
  /** Restrict display to these source strings */
  sourcesFilter?: string[];
  /** Called for each incoming log entry (for auto-detection) */
  onLog?: (entry: LogEntry) => void;
  /** Called when WS status changes */
  onStatusChange?: (status: "connecting" | "open" | "closed") => void;
}

/**
 * Self-contained log viewer panel. Connects to the log viewer WS and
 * renders a filterable table. Accepts an optional `sourcesFilter` to
 * narrow displayed entries (e.g. while monitoring a module being loaded).
 */
export function LogsPanel({
  clientId,
  sourcesFilter,
  onLog,
  onStatusChange,
}: LogsPanelProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [enabledLevels, setEnabledLevels] = useState<Set<string>>(
    new Set(["info", "warn", "error"])
  );
  // Keep onLog in a ref so the onMessage callback stays stable
  const onLogRef = useRef(onLog);
  useEffect(() => { onLogRef.current = onLog; }, [onLog]);

  const wsUrl = useMemo(
    () => (clientId ? buildViewerWsUrl(clientId, "logs") : buildLogViewerWsUrl()),
    [clientId]
  );

  const onMessage = useCallback((event: MessageEvent) => {
    let msg: { type: string; logs?: LogEntry[]; entry?: LogEntry };
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }
    if (msg.type === "init" && msg.logs) {
      setLogs(msg.logs);
      msg.logs.forEach((e) => onLogRef.current?.(e));
    } else if (msg.type === "log" && msg.entry) {
      setLogs((prev) => [...prev, msg.entry!]);
      onLogRef.current?.(msg.entry);
    }
  }, []);

  const { status } = useWebSocket(wsUrl, { onMessage });

  // Propagate WS status to parent if needed
  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  const toggleLevel = useCallback((level: string) => {
    setEnabledLevels((prev) => {
      const next = new Set(prev);
      next.has(level) ? next.delete(level) : next.add(level);
      return next;
    });
  }, []);

  const filteredLogs = useMemo(() => {
    let list = logs.filter((l) => enabledLevels.has(l.level));
    if (sourcesFilter) {
      list = list.filter((l) => sourcesFilter.includes(l.source));
    }
    return list;
  }, [logs, enabledLevels, sourcesFilter]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-sm text-muted-foreground">Filter:</span>
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => toggleLevel(level)}
            className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            <Badge
              variant={enabledLevels.has(level) ? "default" : "outline"}
              className="cursor-pointer select-none"
            >
              {level}
            </Badge>
          </button>
        ))}
        <span className="text-xs text-muted-foreground ml-auto">
          {filteredLogs.length} / {logs.length} entries
        </span>
      </div>
      <LogsTable logs={filteredLogs} showClientId={!clientId} />
    </div>
  );
}
