import { useEffect, useState, useMemo, useCallback } from "react";
import { useWebSocket } from "@/hooks/use-websocket";
import { buildViewerWsUrl } from "@/lib/utils";
import { DEFAULT_SPIDER_CONFIG } from "@/lib/constants";
import { StatsBox } from "@/components/spider/StatsBox";
import { SpiderTree } from "@/components/spider/SpiderTree";
import { ExfiltrationDialog } from "@/components/spider/ExfiltrationDialog";
import { buildUrlTree } from "@/lib/url-tree";
import type { SpiderResult, SpiderConfig } from "@/types/api";

interface SpiderPanelProps {
  clientId: string;
  /** Called when WS status changes */
  onStatusChange?: (status: "connecting" | "open" | "closed") => void;
}

/**
 * Displays spider results as a collapsible URL tree with live updates via WS.
 * Includes config toggles for per-client exfiltration settings, and tracks
 * which URLs have stored content (for download / preview).
 */
export function SpiderPanel({ clientId, onStatusChange }: SpiderPanelProps) {
  const [results, setResults] = useState<SpiderResult[]>([]);
  const [statsMessage, setStatsMessage] = useState("Connecting...");
  const [contentUrls, setContentUrls] = useState<Set<string>>(new Set());
  const [pendingExfiltrations, setPendingExfiltrations] = useState<Set<string>>(new Set());
  const [spiderConfig, setSpiderConfig] = useState<SpiderConfig>(DEFAULT_SPIDER_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  /** State for the exfiltration dialog (null = closed). */
  const [exfilDialog, setExfilDialog] = useState<{ urls: string[]; downloadHref: string; skipConfirm?: boolean } | null>(null);

  // Fetch client config on mount
  useEffect(() => {
    fetch(`/api/clients/${clientId}`)
      .then((r) => r.json())
      .then((client) => {
        if (client.config?.spider) {
          setSpiderConfig({ ...DEFAULT_SPIDER_CONFIG, ...client.config.spider });
        }
        setConfigLoaded(true);
      })
      .catch(() => setConfigLoaded(true));
  }, [clientId]);

  const wsUrl = useMemo(() => buildViewerWsUrl(clientId, "spider"), [clientId]);

  const onMessage = useCallback((event: MessageEvent) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      return;
    }
    if (msg.type === "init" || msg.type === "results") {
      setResults(msg.results as SpiderResult[]);
      setStatsMessage(`${(msg.results as SpiderResult[]).length} URLs discovered`);
      if (Array.isArray(msg.contentUrls)) {
        setContentUrls(new Set(msg.contentUrls as string[]));
      }
    } else if (msg.type === "status") {
      setStatsMessage(
        `Discovered: ${msg.discovered} | Crawled: ${msg.crawled} | Queued: ${msg.queued}`
      );
    } else if (msg.type === "done") {
      setStatsMessage(
        `Done — ${msg.discovered} discovered, ${msg.crawled} crawled`
      );
    } else if (msg.type === "content-stored") {
      setContentUrls((prev) => new Set([...prev, msg.url as string]));
      // Remove from pending set when storage completes
      setPendingExfiltrations((prev) => {
        const next = new Set(prev);
        next.delete(msg.url as string);
        return next;
      });
    } else if (msg.type === "exfiltrate-progress") {
      if (msg.status === "fetching") {
        setPendingExfiltrations((prev) => new Set([...prev, msg.url as string]));
      } else {
        // done or error — remove from pending
        setPendingExfiltrations((prev) => {
          const next = new Set(prev);
          next.delete(msg.url as string);
          return next;
        });
      }
    }
  }, []);

  const { status } = useWebSocket(wsUrl, { onMessage });

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  useEffect(() => {
    if (status === "open") setStatsMessage("Connected, waiting for results...");
  }, [status]);

  /** Save updated config to the server and push to the connected client. */
  async function saveConfig(updated: SpiderConfig) {
    setSpiderConfig(updated);
    setSavingConfig(true);
    try {
      await fetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { spider: updated } }),
      });
    } catch {
      // ignore — UI already shows the optimistic update
    } finally {
      setSavingConfig(false);
    }
  }

  /** Trigger manual exfiltration for a set of URLs via the REST API. */
  const handleExfiltrate = useCallback(
    async (urls: string[]) => {
      // Mark all URLs as pending immediately
      setPendingExfiltrations((prev) => new Set([...prev, ...urls]));
      try {
        await fetch(`/api/clients/${clientId}/spider/exfiltrate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls }),
        });
      } catch {
        // On error, unmark pending
        setPendingExfiltrations((prev) => {
          const next = new Set(prev);
          for (const u of urls) next.delete(u);
          return next;
        });
      }
    },
    [clientId]
  );

  /** Trigger a re-crawl from the given seed URLs via the REST API. */
  const handleCrawl = useCallback(
    async (seeds: string[]) => {
      try {
        await fetch(`/api/clients/${clientId}/spider/crawl`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seeds }),
        });
      } catch {
        // Ignore — the server will log the error
      }
    },
    [clientId]
  );

  /** Open the exfiltration dialog so content is fetched before downloading. */
  const handleRequestDownload = useCallback(
    (urls: string[], downloadHref: string) => {
      setExfilDialog({ urls, downloadHref });
    },
    []
  );

  /**
   * Triggered by the RefreshCw button on tree nodes.
   * Fires exfiltration immediately and opens the progress dialog (skipping confirmation).
   */
  const handleExfiltrateWithProgress = useCallback(
    (urls: string[], downloadHref: string) => {
      handleExfiltrate(urls);
      setExfilDialog({ urls, downloadHref, skipConfirm: true });
    },
    [handleExfiltrate]
  );

  const tree = useMemo(() => buildUrlTree(results), [results]);

  return (
    <div className="space-y-4">
      {/* Config toggles */}
      {configLoaded && (
        <div className="border rounded-md p-3 space-y-2 text-sm">
          <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">
            Exfiltration Config {savingConfig && <span className="normal-case font-normal">(saving...)</span>}
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="accent-primary"
              checked={spiderConfig.limitTypes}
              onChange={(e) => saveConfig({ ...spiderConfig, limitTypes: e.target.checked })}
            />
            Limit to useful types only
          </label>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Max file size:</span>
            <input
              type="number"
              min={1}
              max={500}
              className="border rounded px-2 h-6 w-20 text-xs bg-background"
              value={Math.round(spiderConfig.maxFileSize / 1024 / 1024)}
              onChange={(e) =>
                saveConfig({
                  ...spiderConfig,
                  maxFileSize: Math.max(1, parseInt(e.target.value) || 10) * 1024 * 1024,
                })
              }
            />
            <span className="text-muted-foreground">MB</span>
          </div>
        </div>
      )}
      <StatsBox message={statsMessage} />
      <SpiderTree
        nodes={tree}
        contentUrls={contentUrls}
        pendingExfiltrations={pendingExfiltrations}
        onExfiltrate={handleExfiltrate}
        onCrawl={handleCrawl}
        onRequestDownload={handleRequestDownload}
        onExfiltrateWithProgress={handleExfiltrateWithProgress}
        clientId={clientId}
        connected={status === "open"}
      />
      {exfilDialog && (
        <ExfiltrationDialog
          open={true}
          onClose={() => setExfilDialog(null)}
          urls={exfilDialog.urls}
          contentUrls={contentUrls}
          pendingExfiltrations={pendingExfiltrations}
          downloadHref={exfilDialog.downloadHref}
          onExfiltrate={handleExfiltrate}
          connected={status === "open"}
          skipConfirm={exfilDialog.skipConfirm}
        />
      )}
    </div>
  );
}
