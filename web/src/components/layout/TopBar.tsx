import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Pencil, Trash2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { usePolling } from "@/hooks/use-polling";
import { TOOLS } from "@/lib/constants";
import { EditClientDialog } from "@/components/client/EditClientDialog";
import { DeleteClientDialog } from "@/components/client/DeleteClientDialog";
import type { Client } from "@/types/api";

interface TopBarProps {
  clientId?: string;
  /** WS connection status — omit to hide the indicator dot */
  status?: "connecting" | "open" | "closed";
  /** Optional current page URL shown inline after the client ID (e.g. for DomViewer) */
  currentUrl?: string;
}

/**
 * TopBar for tool pages. When clientId is provided, shows tool navigation,
 * client ID with copy + tooltip (IP/origin), WS status, and edit/delete actions.
 * Without a clientId (global logs), renders a minimal back link + title only.
 */
export function TopBar({ clientId, status, currentUrl }: TopBarProps) {
  if (!clientId) {
    return <GlobalTopBar />;
  }
  return <ClientTopBar clientId={clientId} status={status} currentUrl={currentUrl} />;
}

function GlobalTopBar() {
  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-card text-card-foreground border-b border-border text-sm">
      <Link to="/" className="text-primary/60 hover:text-primary">
        &larr; dashboard
      </Link>
      <span>Global Logs</span>
    </div>
  );
}

function ClientTopBar({
  clientId,
  status,
  currentUrl,
}: {
  clientId: string;
  status?: "connecting" | "open" | "closed";
  currentUrl?: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: client, refetch } = usePolling<Client>(
    `/api/clients/${clientId}`,
    10000
  );

  function copyId() {
    navigator.clipboard.writeText(clientId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const tooltipContent = client
    ? `IP: ${client.ip || "unknown"}\nOrigin: ${client.origin || "unknown"}`
    : clientId;

  return (
    <>
      <div className="flex items-center gap-4 px-4 py-2 bg-card text-card-foreground border-b border-border text-sm">
        <Link to="/" className="text-primary/60 hover:text-primary">
          &larr; dashboard
        </Link>

        <span className="flex items-center gap-2">
          {/* Truncated client ID with copy icon, tooltip shows IP + origin */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={copyId}
                className="font-mono flex items-center gap-1 hover:text-primary transition-colors"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3 opacity-50" />
                )}
                {clientId.slice(0, 8)}…
              </button>
            </TooltipTrigger>
            <TooltipContent className="whitespace-pre">{tooltipContent}</TooltipContent>
          </Tooltip>

          {/* Optional current URL (e.g. from DomViewer) */}
          {currentUrl && (
            <span className="font-mono text-muted-foreground truncate max-w-xs text-xs">
              • {currentUrl}
            </span>
          )}

          {status && (
            <span
              className={cn(
                "inline-block w-2 h-2 rounded-full",
                status === "open" ? "bg-green-500" : "bg-red-500"
              )}
            />
          )}
        </span>

        {/* Tool nav + action buttons — shown once client data has loaded */}
        {client && (
          <div className="ml-auto flex items-center gap-1">
            {TOOLS.map(({ key, icon: Icon, title, route, isPayload }) => {
              const isActive = location.pathname === route(clientId);
              const isEnabled = !isPayload || client.payloads.includes(key);
              return isEnabled ? (
                <Tooltip key={key}>
                  <TooltipTrigger asChild>
                    <Link
                      to={route(clientId)}
                      className={cn(
                        "p-1 rounded hover:bg-accent",
                        isActive && "bg-accent"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>{title}</TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip key={key}>
                  <TooltipTrigger asChild>
                    <Link
                      to={route(clientId)}
                      className="p-1 rounded opacity-30 hover:opacity-60 transition-opacity"
                    >
                      <Icon className="h-4 w-4" />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent>{title} (not enabled)</TooltipContent>
                </Tooltip>
              );
            })}

            <div className="w-px h-4 bg-border mx-1" />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setEditOpen(true)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit client</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete client</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

      <EditClientDialog
        client={client}
        open={editOpen}
        onOpenChange={setEditOpen}
        onClose={refetch}
      />
      <DeleteClientDialog
        clientId={clientId}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => navigate("/")}
      />
    </>
  );
}
