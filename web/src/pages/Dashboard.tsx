import { useState, useEffect, useRef } from "react";
import { Link as RouterLink } from "react-router-dom";
import { toast } from "sonner";
import { usePolling } from "@/hooks/use-polling";
import { CreateLinkForm } from "@/components/dashboard/CreateLinkForm";
import { LinksTable } from "@/components/dashboard/LinksTable";
import { ClientsTable } from "@/components/dashboard/ClientsTable";
import { Separator } from "@/components/ui/separator";
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
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      Loading…
    </div>
  );
}

export default function Dashboard() {
  const [c2Url, setC2Url] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((cfg) => { if (cfg.c2Url) setC2Url(cfg.c2Url); })
      .catch(() => {});
  }, []);

  const {
    data: links,
    error: linksError,
    loading: linksLoading,
    refetch: refetchLinks,
  } = usePolling<Link[]>("/api/links", 5000);

  const {
    data: clients,
    error: clientsError,
    loading: clientsLoading,
    refetch: refetchClients,
  } = usePolling<Client[]>("/api/clients", 5000);

  // Show error toasts when polling errors occur
  useEffect(() => {
    if (linksError) toast.error("Failed to load links", { description: linksError });
  }, [linksError]);

  useEffect(() => {
    if (clientsError) toast.error("Failed to load clients", { description: clientsError });
  }, [clientsError]);

  /**
   * Track the previous client snapshot to diff for connect/disconnect events.
   * Use a ref so we don't trigger re-renders. `null` means "first poll — skip".
   */
  const prevClientsRef = useRef<Map<string, boolean> | null>(null);

  useEffect(() => {
    if (!clients) return;

    const current = new Map(clients.map((c) => [c.id, c.connected]));
    const prev = prevClientsRef.current;

    if (prev === null) {
      // First poll — just capture the snapshot, no toasts
      prevClientsRef.current = current;
      return;
    }

    for (const [id, connected] of current) {
      const origin = clients.find((c) => c.id === id)?.origin ?? "";
      const label = `${id.slice(0, 8)}… ${origin ? `from ${origin}` : ""}`.trim();

      if (!prev.has(id)) {
        toast("Client connected", { description: label });
      } else if (!prev.get(id) && connected) {
        toast("Client reconnected", { description: label });
      } else if (prev.get(id) && !connected) {
        toast("Client disconnected", { description: label });
      }
    }

    prevClientsRef.current = current;
  }, [clients]);

  function refetchAll() {
    refetchLinks();
    refetchClients();
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">domviewer dashboard</h1>
        <div className="flex items-center gap-4">
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            New Link
          </Button>
          <RouterLink to="/logs" className="text-sm text-blue-600 hover:underline">
            Global Logs
          </RouterLink>
        </div>
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Payload Link</DialogTitle>
          </DialogHeader>
          <CreateLinkForm
            onCreated={refetchAll}
            onClose={() => setCreateDialogOpen(false)}
            c2Url={c2Url ?? undefined}
          />
        </DialogContent>
      </Dialog>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Payload Links</h2>
        {linksLoading ? (
          <Spinner />
        ) : (
          <LinksTable
            links={links ?? []}
            clients={clients ?? []}
            serverAddr={c2Url ?? window.location.origin}
            onUpdated={refetchAll}
          />
        )}
      </section>

      <Separator />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Connected Clients{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({clients?.length ?? 0})
          </span>
        </h2>
        {clientsLoading ? (
          <Spinner />
        ) : (
          <ClientsTable clients={clients ?? []} onUpdated={refetchAll} />
        )}
      </section>
    </div>
  );
}
