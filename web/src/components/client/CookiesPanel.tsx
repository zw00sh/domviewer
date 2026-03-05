import { useState, useMemo, useEffect } from "react";
import { useCookies } from "@/hooks/use-cookies";
import type { CookieEntry } from "@/hooks/use-cookies";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Cookie, List, Layers, Trash2, Download, Info } from "lucide-react";

interface CookiesPanelProps {
  clientId: string;
  onStatusChange?: (status: "connecting" | "open" | "closed") => void;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Displays captured cookie entries with "current" (deduplicated) and "history" views.
 *
 * Current view — shows the most recent value for each cookie name (last-write-wins).
 * History view — shows all cookie change events in chronological order.
 */
export function CookiesPanel({ clientId, onStatusChange }: CookiesPanelProps) {
  const { cookies, status, clearCookies } = useCookies(clientId);
  const [viewMode, setViewMode] = useState<"current" | "history">("current");

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  /**
   * Build a last-write-wins Map of name → CookieEntry for the "Current" view.
   * Cookies that were last seen as removed are excluded.
   */
  const currentCookies = useMemo<CookieEntry[]>(() => {
    const map = new Map<string, CookieEntry>();
    for (const entry of cookies) {
      map.set(entry.name, entry);
    }
    return Array.from(map.values()).filter((e) => !e.removed);
  }, [cookies]);

  function exportJson() {
    const data = viewMode === "current" ? currentCookies : cookies;
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cookies-${clientId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const isEmpty = viewMode === "current" ? currentCookies.length === 0 : cookies.length === 0;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Cookie className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Cookies</span>
          <Badge variant="secondary">{currentCookies.length} active</Badge>
        </div>
        <div className="flex-1" />

        {/* View mode toggle */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant={viewMode === "current" ? "secondary" : "ghost"}
                onClick={() => setViewMode("current")}
              >
                <Layers className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Current cookies</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant={viewMode === "history" ? "secondary" : "ghost"}
                onClick={() => setViewMode("history")}
              >
                <List className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Change history ({cookies.length} events)</TooltipContent>
          </Tooltip>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              onClick={exportJson}
              disabled={isEmpty}
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Export JSON</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={clearCookies}
              disabled={cookies.length === 0}
              data-testid="cookies-clear-btn"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Clear all entries</TooltipContent>
        </Tooltip>
      </div>

      {/* httpOnly limitation notice */}
      <div className="flex items-start gap-2 rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          Only JavaScript-accessible cookies are captured. Cookies with the{" "}
          <code className="font-mono bg-muted px-1 rounded">HttpOnly</code> flag are not visible
          to scripts and cannot be exfiltrated via this payload.
        </span>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="text-center py-12 text-muted-foreground">
          <Cookie className="h-8 w-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">
            {status === "connecting"
              ? "Connecting..."
              : viewMode === "current"
              ? "No active cookies found"
              : "No cookie changes captured yet"}
          </p>
        </div>
      )}

      {/* Current view — deduplicated last-write-wins */}
      {viewMode === "current" && currentCookies.length > 0 && (
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-48">Name</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="w-24 text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentCookies.map((entry, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                      {entry.name}
                    </code>
                  </TableCell>
                  <TableCell className="font-mono text-xs break-all max-w-xs">
                    {entry.value ?? <em className="not-italic text-muted-foreground">(empty)</em>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground text-right font-mono">
                    {formatTimestamp(entry.timestamp)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* History view — full chronological log */}
      {viewMode === "history" && cookies.length > 0 && (
        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Time</TableHead>
                <TableHead className="w-48">Name</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="w-20">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cookies.map((entry, i) => (
                <TableRow key={i} className={entry.removed ? "opacity-60" : undefined}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {formatTimestamp(entry.timestamp)}
                  </TableCell>
                  <TableCell>
                    <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                      {entry.name}
                    </code>
                  </TableCell>
                  <TableCell className="font-mono text-xs break-all max-w-xs">
                    {entry.removed ? (
                      <em className="not-italic text-muted-foreground">(removed)</em>
                    ) : entry.value ? (
                      entry.value
                    ) : (
                      <em className="not-italic text-muted-foreground">(empty)</em>
                    )}
                  </TableCell>
                  <TableCell>
                    {entry.removed ? (
                      <Badge variant="destructive" className="text-[10px] h-4 px-1">
                        removed
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px] h-4 px-1">
                        set
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
