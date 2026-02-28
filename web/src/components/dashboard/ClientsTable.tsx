import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Pencil, Trash2 } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { EditClientDialog } from "@/components/client/EditClientDialog";
import { DeleteClientDialog } from "@/components/client/DeleteClientDialog";
import { TOOLS } from "@/lib/constants";
import type { Client } from "@/types/api";

interface Props {
  clients: Client[];
  onUpdated: () => void;
}

/** Format an elapsed millisecond duration as a concise uptime string, e.g. "2h 15m". */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return "< 1m";
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const days = Math.floor(totalSeconds / 86400);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Format a past date as a relative "X ago" string. */
function formatTimeAgo(date: Date): string {
  const ms = Date.now() - date.getTime();
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return "just now";
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  return `${minutes}m ago`;
}

export function ClientsTable({ clients, onUpdated }: Props) {
  const [editClient, setEditClient] = useState<Client | null>(null);
  const [deleteClientId, setDeleteClientId] = useState<string | null>(null);

  if (clients.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No clients connected yet.</p>
    );
  }

  // Group clients by origin (fallback to "Unknown origin" for empty string)
  const groups = new Map<string, Client[]>();
  for (const client of clients) {
    const key = client.origin || "Unknown origin";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(client);
  }

  return (
    <>
      {[...groups.entries()].map(([origin, groupClients]) => (
        <div key={origin} className="mb-6">
          <h3 className="text-sm font-semibold text-muted-foreground mb-2 font-mono">
            {origin}
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Activity</TableHead>
                <TableHead>Tools</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groupClients.map((client) => {
                // Navigate to the first configured payload tool, falling back to logs
                const firstTool =
                  TOOLS.find((t) => t.isPayload && client.payloads.includes(t.key)) ??
                  TOOLS.find((t) => !t.isPayload);

                // "Activity" display — prefix makes meaning unambiguous at a glance
                const connectedAt = new Date(client.connectedAt);
                const disconnectedAt = client.disconnectedAt
                  ? new Date(client.disconnectedAt)
                  : null;
                const activityLabel = client.connected
                  ? `up ${formatDuration(Date.now() - connectedAt.getTime())}`
                  : disconnectedAt
                  ? formatTimeAgo(disconnectedAt)
                  : formatTimeAgo(connectedAt);
                const activityTooltip = client.connected
                  ? `Connected at ${connectedAt.toLocaleString()}`
                  : disconnectedAt
                  ? `Disconnected at ${disconnectedAt.toLocaleString()}`
                  : `Last connected at ${connectedAt.toLocaleString()}`;

                return (
                  <TableRow key={client.id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        to={firstTool ? firstTool.route(client.id) : `/clients/${client.id}`}
                        className="hover:text-primary transition-colors"
                      >
                        {client.id}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {client.ip || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={client.connected ? "default" : "destructive"}>
                        {client.connected ? "connected" : "disconnected"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-default">{activityLabel}</span>
                        </TooltipTrigger>
                        <TooltipContent>{activityTooltip}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {TOOLS.map(({ key, icon: Icon, title, route, isPayload }) => {
                          const isActive =
                            !isPayload || client.payloads.includes(key);
                          return isActive ? (
                            <Tooltip key={key}>
                              <TooltipTrigger asChild>
                                <Link
                                  to={route(client.id)}
                                  className="p-1 rounded hover:bg-accent"
                                >
                                  <Icon className="h-4 w-4" />
                                </Link>
                              </TooltipTrigger>
                              <TooltipContent>{title}</TooltipContent>
                            </Tooltip>
                          ) : (
                            <Tooltip key={key}>
                              <TooltipTrigger asChild>
                                <span className="p-1 opacity-25 cursor-default">
                                  <Icon className="h-4 w-4" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>{title}</TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setEditClient(client)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteClientId(client.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ))}

      <EditClientDialog
        client={editClient}
        open={!!editClient}
        onOpenChange={(open) => { if (!open) setEditClient(null); }}
        onClose={onUpdated}
      />
      <DeleteClientDialog
        clientId={deleteClientId}
        open={!!deleteClientId}
        onOpenChange={(open) => { if (!open) setDeleteClientId(null); }}
        onDeleted={() => { setDeleteClientId(null); onUpdated(); }}
      />
    </>
  );
}
