import { useState } from "react";
import { WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditClientDialog } from "@/components/client/EditClientDialog";
import { TOOLS, getPayloadLabel } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Client } from "@/types/api";

interface PayloadStatusBannerProps {
  clientId: string;
  /** The payload key to check (e.g. "domviewer", "spider", "proxy", "keylogger", "cookies") */
  payloadKey: string;
  /** Whether the client is currently connected to C2. */
  clientConnected: boolean;
  /** Whether this payload is enabled in the client's config. */
  payloadEnabled: boolean;
  /**
   * Whether this payload has historical data (DB-backed payloads only).
   * When false and the client is offline + disabled, the banner returns null
   * so the panel can render its own OfflineGuardCard.
   */
  hasData?: boolean;
}

/**
 * Inline status banner for payload pages. Renders based on the following priority:
 *
 * | State                                    | Render                                          |
 * |------------------------------------------|-------------------------------------------------|
 * | Online + enabled                         | Nothing                                         |
 * | Online + disabled                        | Yellow "not enabled" banner + Enable button     |
 * | Offline + enabled                        | Red "offline — showing historical data" banner  |
 * | Offline + disabled + has data            | Red "offline — showing historical data" banner  |
 * | Offline + disabled + no data             | Nothing (panel renders its own OfflineGuardCard)|
 *
 * The yellow "disabled" banner ONLY appears when the client is online.
 */
export function PayloadStatusBanner({
  clientId,
  payloadKey,
  clientConnected,
  payloadEnabled,
  hasData,
}: PayloadStatusBannerProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [editClient, setEditClient] = useState<Client | null>(null);

  // Nothing to show — client is online and payload is enabled
  if (clientConnected && payloadEnabled) return null;

  // Offline + disabled + no data — panel renders its own guard card
  if (!clientConnected && !payloadEnabled && !hasData) return null;

  const tool = TOOLS.find((t) => t.key === payloadKey);
  const label = getPayloadLabel(payloadKey);
  const Icon = tool?.icon;

  async function openEnableDialog() {
    try {
      const res = await fetch(`/api/clients/${clientId}`);
      const client: Client = await res.json();
      setEditClient(client);
      setEditOpen(true);
    } catch {
      // ignore
    }
  }

  const bannerBase = "flex items-center gap-3 w-full border px-4 py-3 text-sm";

  // Online + disabled — show amber enable prompt
  if (clientConnected && !payloadEnabled) {
    return (
      <>
        <div
          role="alert"
          className={cn(
            bannerBase,
            "border-hacker-amber/30 bg-hacker-amber/5 text-hacker-amber border-glow-amber",
          )}
        >
          {Icon && (
            <Icon className="h-4 w-4 shrink-0 text-hacker-amber/70" />
          )}
          <span className="flex-1">
            <span className="font-medium">{label}</span> is not enabled for this client.{" "}
            <span className="text-hacker-amber/60">
              Any data shown below is historical.
            </span>
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={openEnableDialog}
            className="shrink-0 border-hacker-amber/30 text-hacker-amber hover:bg-hacker-amber/10 hover:text-hacker-amber hover:border-hacker-amber/50"
          >
            Enable {label}
          </Button>
        </div>

        <EditClientDialog
          client={editClient}
          open={editOpen}
          onOpenChange={setEditOpen}
          onClose={() => setEditOpen(false)}
          preEnablePayload={payloadKey}
        />
      </>
    );
  }

  // Offline (enabled or disabled+has data) — show red offline banner
  return (
    <div
      role="alert"
      className={cn(
        bannerBase,
        "border-hacker-red/30 bg-hacker-red/5 text-hacker-red/80 border-glow-red",
      )}
    >
      <WifiOff className="h-4 w-4 shrink-0 text-hacker-red/60" />
      <span>Client is offline — showing historical data.</span>
    </div>
  );
}
