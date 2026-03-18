import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Pencil, Trash2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useClientStatus } from "@/hooks/use-client-status";
import { EditClientDialog } from "@/components/client/EditClientDialog";
import { DeleteClientDialog } from "@/components/client/DeleteClientDialog";
import { ToolNav } from "@/components/layout/ToolNav";

interface TopBarProps {
  clientId?: string;
  /** Optional current page URL shown inline after the client ID (e.g. for DomViewer) */
  currentUrl?: string;
}

/**
 * TopBar for tool pages. When clientId is provided, shows tool navigation,
 * client ID with copy + tooltip (IP/origin), C2 connection status dot, and
 * edit/delete actions. Without a clientId (global logs), renders a minimal
 * back link + title only.
 *
 * The status dot reflects the client's C2 connection state (from API polling),
 * not the viewer WebSocket connection.
 */
export function TopBar({ clientId, currentUrl }: TopBarProps) {
  if (!clientId) {
    return <GlobalTopBar />;
  }
  return <ClientTopBar clientId={clientId} currentUrl={currentUrl} />;
}

function GlobalTopBar() {
  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-card/80 text-card-foreground border-b border-border text-sm backdrop-blur-sm">
      <Link to="/" className="text-hacker-green/60 hover:text-hacker-green glow-green transition-all">
        &larr; dashboard
      </Link>
      <span className="text-muted-foreground">//</span>
      <span>system_logs</span>
    </div>
  );
}

function ClientTopBar({
  clientId,
  currentUrl,
}: {
  clientId: string;
  currentUrl?: string;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { client, refetch } = useClientStatus(clientId);

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
      <div className="flex items-center gap-4 px-4 py-2 bg-card/80 text-card-foreground border-b border-border text-sm backdrop-blur-sm">
        <Link to="/" className="text-hacker-green/60 hover:text-hacker-green glow-green transition-all">
          &larr; dashboard
        </Link>

        <span className="text-muted-foreground/40">//</span>

        <span className="flex items-center gap-2">
          {/* C2 connection status dot — reflects client.connected from API poll */}
          {client && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "inline-block w-2 h-2 rounded-full cursor-default",
                    client.connected
                      ? "bg-hacker-green pulse-green"
                      : "bg-hacker-red pulse-red"
                  )}
                />
              </TooltipTrigger>
              <TooltipContent>
                {client.connected ? "Connected to C2" : "Disconnected from C2"}
              </TooltipContent>
            </Tooltip>
          )}

          {/* Truncated client ID with copy icon, tooltip shows IP + origin */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={copyId}
                className="font-mono flex items-center gap-1 hover:text-hacker-green glow-green transition-all text-foreground/80"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-hacker-green" />
                ) : (
                  <Copy className="h-3 w-3 opacity-40" />
                )}
                {clientId.slice(0, 8)}...
              </button>
            </TooltipTrigger>
            <TooltipContent className="whitespace-pre">{tooltipContent}</TooltipContent>
          </Tooltip>

          {/* Optional current URL (e.g. from DomViewer) */}
          {currentUrl && (
            <span className="font-mono text-muted-foreground truncate max-w-xs text-xs">
              <span className="text-hacker-green/40">@</span> {currentUrl}
            </span>
          )}
        </span>

        {/* Tool nav + action buttons — shown once client data has loaded */}
        {client && (
          <div className="ml-auto flex items-center gap-1">
            <ToolNav
              clientId={clientId}
              payloads={client.payloads}
              hasData={client.hasData}
              activePath={location.pathname}
              connected={client.connected}
            />

            <div className="w-px h-4 bg-border mx-1" />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 hover:text-hacker-amber"
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
                  className="h-7 w-7 text-hacker-red/70 hover:text-hacker-red"
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
