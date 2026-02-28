import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LogsPanel } from "@/components/client/LogsPanel";
import { SpiderConfigFields } from "@/components/dashboard/SpiderConfigFields";
import { AVAILABLE_PAYLOADS, getPayloadLabel, DEFAULT_SPIDER_CONFIG } from "@/lib/constants";
import type { Client, LogEntry, SpiderConfig } from "@/types/api";

interface EditClientDialogProps {
  /** The client to edit. Pass null when no edit is pending (dialog will be closed). */
  client: Client | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called when the dialog closes, after any saves. Use to trigger a data refresh. */
  onClose: () => void;
}

export function EditClientDialog({
  client,
  open,
  onOpenChange,
  onClose,
}: EditClientDialogProps) {
  const [editPayloads, setEditPayloads] = useState<Record<string, boolean>>({});
  const [spiderConfig, setSpiderConfig] = useState<SpiderConfig>(DEFAULT_SPIDER_CONFIG);

  // Original server state, used for dirty comparison and reset.
  const [originalPayloads, setOriginalPayloads] = useState<Record<string, boolean>>({});
  const [originalSpiderConfig, setOriginalSpiderConfig] = useState<SpiderConfig>(DEFAULT_SPIDER_CONFIG);

  const [saving, setSaving] = useState(false);

  // Track whether the dialog was open on the previous render.
  const prevOpenRef = useRef(false);

  // Initialise form state only on the open transition (false → true) to avoid
  // polling-driven client prop updates resetting unsaved changes mid-session.
  useEffect(() => {
    if (open && !prevOpenRef.current && client) {
      const selected: Record<string, boolean> = {};
      for (const p of AVAILABLE_PAYLOADS) {
        selected[p] = client.payloads.includes(p);
      }
      const cfg = { ...DEFAULT_SPIDER_CONFIG, ...(client.config?.spider ?? {}) };
      setEditPayloads(selected);
      setOriginalPayloads(selected);
      setSpiderConfig(cfg);
      setOriginalSpiderConfig(cfg);
    }
    prevOpenRef.current = open;
  }, [client, open]);

  /** True when local state differs from what was last applied to the server. */
  const isDirty = useMemo(() => {
    for (const p of AVAILABLE_PAYLOADS) {
      if ((editPayloads[p] ?? false) !== (originalPayloads[p] ?? false)) return true;
    }
    // Only compare spider config when spider is enabled.
    if (editPayloads["spider"]) {
      if (spiderConfig.exfiltrate !== originalSpiderConfig.exfiltrate) return true;
      if (spiderConfig.limitTypes !== originalSpiderConfig.limitTypes) return true;
      if (spiderConfig.maxFileSize !== originalSpiderConfig.maxFileSize) return true;
    }
    return false;
  }, [editPayloads, originalPayloads, spiderConfig, originalSpiderConfig]);

  /** Toggle a payload locally — no network request. */
  function togglePayload(name: string, enabled: boolean) {
    setEditPayloads((prev) => ({ ...prev, [name]: enabled }));
  }

  /** Update spider config locally — no network request. */
  function updateSpiderConfig(updated: SpiderConfig) {
    setSpiderConfig(updated);
  }

  /** Send a single PATCH with all pending changes. */
  async function handleApply() {
    if (!client) return;
    setSaving(true);
    try {
      const payloads = AVAILABLE_PAYLOADS.filter((p) => editPayloads[p]);
      const config: Record<string, unknown> = {};
      if (editPayloads["spider"]) config.spider = spiderConfig;

      const res = await fetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payloads, config }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Commit — reset dirty baseline to current state.
      setOriginalPayloads({ ...editPayloads });
      setOriginalSpiderConfig({ ...spiderConfig });
      toast.success("Changes applied");
    } catch (e) {
      toast.error("Failed to apply changes", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  /**
   * Auto-updates local payload state when a "loaded payload: <name>" log arrives.
   */
  const handleAutoDetectLog = useCallback((entry: LogEntry) => {
    for (const name of AVAILABLE_PAYLOADS) {
      if (entry.message?.includes(`loaded payload: ${name}`)) {
        setEditPayloads((prev) =>
          prev[name] ? prev : { ...prev, [name]: true }
        );
      }
    }
  }, []);

  const enabledPayloadNames = AVAILABLE_PAYLOADS.filter((p) => editPayloads[p]);
  const logSources = ["loader", "server", ...enabledPayloadNames];

  function handleOpenChange(o: boolean) {
    onOpenChange(o);
    if (!o) onClose();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 flex-shrink-0">
          <DialogTitle>
            Edit Client{" "}
            <span className="font-mono text-sm font-normal text-muted-foreground">
              {client?.id.slice(0, 8)}…
            </span>
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Toggle payloads and configure settings, then click Apply to save.
          </p>
        </DialogHeader>

        {client && (
          <div className="flex flex-1 min-h-0 border-t">
            {/* Left: payload toggles + spider config + apply button */}
            <div className="w-56 flex-shrink-0 border-r flex flex-col">
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Payloads
                </p>
                <div className="space-y-3">
                  {AVAILABLE_PAYLOADS.map((name) => (
                    <div key={name} className="space-y-2">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editPayloads[name] ?? false}
                          onChange={(e) => togglePayload(name, e.target.checked)}
                          className="accent-primary"
                        />
                        {getPayloadLabel(name)}
                      </label>

                      {/* Spider inline config — only when spider is enabled */}
                      {name === "spider" && editPayloads["spider"] && (
                        <div className="ml-5 space-y-2 text-xs text-muted-foreground border-l pl-3">
                          <p className="font-medium text-foreground">Spider config</p>
                          <SpiderConfigFields
                            config={spiderConfig}
                            onChange={updateSpiderConfig}
                            sizeUnit="bytes"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Apply button footer */}
              <div className="flex-shrink-0 border-t p-4">
                <Button
                  size="sm"
                  className="w-full"
                  disabled={!isDirty || saving}
                  onClick={handleApply}
                >
                  {saving ? "Applying…" : "Apply"}
                </Button>
              </div>
            </div>

            {/* Right: live log viewer */}
            <div className="flex-1 min-w-0 flex flex-col p-4 overflow-hidden">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 flex-shrink-0">
                Live Logs
              </p>
              <div className="flex-1 overflow-auto">
                <LogsPanel
                  clientId={client.id}
                  sourcesFilter={logSources}
                  onLog={handleAutoDetectLog}
                />
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
