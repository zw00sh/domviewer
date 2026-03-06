import { useState, useEffect } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useDashboard } from "@/hooks/use-dashboard";
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

// Re-export types to satisfy TypeScript (imported but referenced by child components)
export type { Link, Client };

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

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">domviewer dashboard</h1>
        <div className="flex items-center gap-4">
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            New Link
          </Button>
          <RouterLink to="/logs" className="text-sm text-primary hover:underline">
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
            onCreated={refetch}
            onClose={() => setCreateDialogOpen(false)}
            c2Url={c2Url ?? undefined}
          />
        </DialogContent>
      </Dialog>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Payload Links</h2>
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

      <Separator />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">
          Connected Clients{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({clients.length})
          </span>
        </h2>
        {loading ? (
          <Spinner />
        ) : (
          <ClientsTable clients={clients} onUpdated={refetch} />
        )}
      </section>
    </div>
  );
}
