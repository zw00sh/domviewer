import { useState, useEffect } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useDashboard } from "@/hooks/use-dashboard";
import { CreateLinkForm } from "@/components/dashboard/CreateLinkForm";
import { LinksTable } from "@/components/dashboard/LinksTable";
import { ClientsTable } from "@/components/dashboard/ClientsTable";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Link, Client } from "@/types/api";

function Spinner() {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
      <span className="text-hacker-green cursor-blink">&gt;_</span>
      <span className="text-muted-foreground">loading data...</span>
    </div>
  );
}

// Re-export types to satisfy TypeScript (imported but referenced by child components)
export type { Link, Client };

const ASCII_BANNER = `
 ██████╗  ██████╗ ███╗   ███╗██╗   ██╗██╗███████╗██╗    ██╗███████╗██████╗
 ██╔══██╗██╔═══██╗████╗ ████║██║   ██║██║██╔════╝██║    ██║██╔════╝██╔══██╗
 ██║  ██║██║   ██║██╔████╔██║██║   ██║██║█████╗  ██║ █╗ ██║█████╗  ██████╔╝
 ██║  ██║██║   ██║██║╚██╔╝██║╚██╗ ██╔╝██║██╔══╝  ██║███╗██║██╔══╝  ██╔══██╗
 ██████╔╝╚██████╔╝██║ ╚═╝ ██║ ╚████╔╝ ██║███████╗╚███╔███╔╝███████╗██║  ██║
 ╚═════╝  ╚═════╝ ╚═╝     ╚═╝  ╚═══╝  ╚═╝╚══════╝ ╚══╝╚══╝ ╚══════╝╚═╝  ╚═╝`.trim();

export default function Dashboard() {
  const [c2Url, setC2Url] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg) => { if (cfg.c2Url) setC2Url(cfg.c2Url); })
      .catch(() => {});
  }, []);

  const { links, clients, loading, refetch } = useDashboard();

  const connectedCount = clients.filter((c) => c.connected).length;

  return (
    <div className="max-w-6xl mx-auto py-6 px-4 space-y-6">
      {/* ASCII banner header */}
      <div className="animate-fade-in-up">
        <pre className="text-hacker-green glow-green text-[0.45rem] sm:text-[0.55rem] md:text-xs leading-tight select-none overflow-x-auto">
          {ASCII_BANNER}
        </pre>
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="text-hacker-green/60">v0.1.0</span>
          <span className="text-border">|</span>
          <span>c2 management console</span>
          <span className="text-border">|</span>
          <span className={connectedCount > 0 ? "text-hacker-green glow-green" : "text-muted-foreground"}>
            {connectedCount} active {connectedCount === 1 ? "session" : "sessions"}
          </span>
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="text-hacker-green">&gt;</span>
          <span>dashboard</span>
          <span className="cursor-blink text-hacker-green">_</span>
        </div>
        <div className="flex items-center gap-4">
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            + new_link
          </Button>
          <RouterLink
            to="/logs"
            className="text-xs text-muted-foreground hover:text-hacker-amber glow-amber transition-all"
          >
            [system_logs]
          </RouterLink>
        </div>
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>// create payload link</DialogTitle>
          </DialogHeader>
          <CreateLinkForm
            onCreated={refetch}
            onClose={() => setCreateDialogOpen(false)}
            c2Url={c2Url ?? undefined}
          />
        </DialogContent>
      </Dialog>

      {/* Payload Links section */}
      <section className="space-y-3 animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
        <div className="flex items-center gap-2">
          <span className="text-hacker-green text-xs">[01]</span>
          <h2 className="text-sm font-semibold uppercase tracking-wider">
            Payload Links
          </h2>
          <span className="text-xs text-muted-foreground">
            ({links.length})
          </span>
        </div>
        {loading ? (
          <Spinner />
        ) : (
          <LinksTable
            links={links}
            clients={clients}
            serverAddr={c2Url ?? window.location.origin}
            onUpdated={refetch}
          />
        )}
      </section>

      {/* Separator */}
      <div className="border-t border-border/50 relative">
        <span className="absolute -top-2.5 left-4 bg-background px-2 text-xs text-muted-foreground/40">
          ///
        </span>
      </div>

      {/* Clients section */}
      <section className="space-y-3 animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
        <div className="flex items-center gap-2">
          <span className="text-hacker-green text-xs">[02]</span>
          <h2 className="text-sm font-semibold uppercase tracking-wider">
            Connected Clients
          </h2>
          <span className="text-xs text-muted-foreground">
            ({clients.length})
          </span>
          {connectedCount > 0 && (
            <span className="text-xs text-hacker-green glow-green">
              {connectedCount} live
            </span>
          )}
        </div>
        {loading ? (
          <Spinner />
        ) : (
          <ClientsTable clients={clients} onUpdated={refetch} />
        )}
      </section>
    </div>
  );
}
