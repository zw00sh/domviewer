import { useState, type ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePolling } from "@/hooks/use-polling";
import { EditClientDialog } from "@/components/client/EditClientDialog";
import { TOOLS, getPayloadLabel } from "@/lib/constants";
import type { Client } from "@/types/api";

interface PayloadPageGuardProps {
  clientId: string;
  /** The payload key to check (e.g. "domviewer", "spider", "proxy", "keylogger") */
  payloadKey: string;
  children: ReactNode;
}

/**
 * Guards a payload page. When the payload is not configured on the client,
 * renders a "not enabled" card with a button to open EditClientDialog.
 * While the client data is loading, or when the payload is enabled, renders children.
 */
export function PayloadPageGuard({ clientId, payloadKey, children }: PayloadPageGuardProps) {
  const [editOpen, setEditOpen] = useState(false);
  const { data: client, loading, refetch } = usePolling<Client>(
    `/api/clients/${clientId}`,
    5000
  );

  // While loading, render children (avoids flash of "not enabled" on first load)
  if (loading || !client) return <>{children}</>;

  // Payload is configured — render the page
  if (client.payloads.includes(payloadKey)) return <>{children}</>;

  // Payload not enabled — show the guard card
  const tool = TOOLS.find((t) => t.key === payloadKey);
  const label = getPayloadLabel(payloadKey);
  const Icon = tool?.icon;

  return (
    <>
      <div className="flex-1 flex items-center justify-center">
        <Card className="w-80 text-center">
          <CardHeader className="items-center gap-2">
            {Icon && <Icon className="h-8 w-8 text-muted-foreground" />}
            <CardTitle>{label} not enabled</CardTitle>
            <CardDescription>
              This payload is not configured for this client. Enable it to start
              collecting data.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setEditOpen(true)}>Enable {label}</Button>
          </CardContent>
        </Card>
      </div>

      <EditClientDialog
        client={client}
        open={editOpen}
        onOpenChange={setEditOpen}
        onClose={refetch}
      />
    </>
  );
}
