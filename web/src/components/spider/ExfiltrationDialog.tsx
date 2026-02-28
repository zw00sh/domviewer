import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle, Loader2, AlertCircle, Download } from "lucide-react";

interface ExfiltrationDialogProps {
  open: boolean;
  onClose: () => void;
  /** URLs to exfiltrate / download. */
  urls: string[];
  /** URLs that already have stored content in the server DB. */
  contentUrls: Set<string>;
  /** URLs currently being exfiltrated (in-flight). */
  pendingExfiltrations: Set<string>;
  /** The download href that will be used once content is available (ZIP or latest). */
  downloadHref: string;
  /** Callback to trigger exfiltration for a list of URLs. */
  onExfiltrate: (urls: string[]) => void;
  /** Whether the client is currently connected. */
  connected: boolean;
  /**
   * When true, skip the confirmation phase and open directly in progress view.
   * Used when exfiltration has already been triggered (e.g. from RefreshCw).
   */
  skipConfirm?: boolean;
}

type Phase = "confirm" | "progress";
type UrlStatus = "done" | "fetching" | "pending";

function getStatus(url: string, contentUrls: Set<string>, pendingExfiltrations: Set<string>): UrlStatus {
  if (contentUrls.has(url)) return "done";
  if (pendingExfiltrations.has(url)) return "fetching";
  return "pending";
}

/** Group an array of URL strings by their origin, returning ordered entries. */
function groupByOrigin(urls: string[]): Array<{ origin: string; entries: Array<{ url: string; path: string }> }> {
  const map = new Map<string, Array<{ url: string; path: string }>>();
  for (const url of urls) {
    try {
      const parsed = new URL(url);
      const origin = parsed.origin;
      const path = parsed.pathname + parsed.search + parsed.hash || "/";
      if (!map.has(origin)) map.set(origin, []);
      map.get(origin)!.push({ url, path });
    } catch {
      // Unparseable URL — treat the whole string as the path under a blank origin
      if (!map.has("")) map.set("", []);
      map.get("")!.push({ url, path: url });
    }
  }
  return Array.from(map.entries()).map(([origin, entries]) => ({ origin, entries }));
}

/**
 * Two-phase modal dialog for spider content exfiltration and download.
 *
 * Phase 1 (confirm): Shows which files need exfiltration and explains
 * what will happen. User must click "Exfiltrate" to proceed.
 *
 * Phase 2 (progress): Triggers exfiltration and shows per-URL fetch
 * status. Download button enables once any content is available.
 */
export function ExfiltrationDialog({
  open,
  onClose,
  urls,
  contentUrls,
  pendingExfiltrations,
  downloadHref,
  onExfiltrate,
  connected,
  skipConfirm,
}: ExfiltrationDialogProps) {
  const [phase, setPhase] = useState<Phase>("confirm");

  // Reset to confirmation phase each time the dialog opens
  useEffect(() => {
    if (open) {
      setPhase("confirm");
    }
  }, [open]);

  const missingUrls = urls.filter((u) => !contentUrls.has(u));
  const needsExfiltration = missingUrls.length > 0;

  const doneCount = urls.filter((u) => contentUrls.has(u)).length;
  const total = urls.length;

  /** Start exfiltration and move to progress phase. */
  function handleExfiltrate() {
    if (connected && missingUrls.length > 0) {
      onExfiltrate(missingUrls);
    }
    setPhase("progress");
  }

  // Skip to progress phase if:
  // - all content is already available (no confirm needed), OR
  // - skipConfirm is set (exfiltration already triggered externally, e.g. RefreshCw)
  const effectivePhase = skipConfirm || !needsExfiltration ? "progress" : phase;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {effectivePhase === "confirm" ? "Exfiltrate Content" : "Fetching Content"}
          </DialogTitle>
        </DialogHeader>

        {effectivePhase === "confirm" ? (
          /* ── Phase 1: Confirmation ── */
          <>
            <p className="text-sm text-muted-foreground">
              The following {missingUrls.length === 1 ? "file has" : `${missingUrls.length} files have`}{" "}
              not been exfiltrated yet. Content will be fetched from the target before downloading.
            </p>

            {/* List of files that need exfiltration, grouped by origin */}
            <div className="overflow-y-auto flex-1 text-xs font-mono border rounded-md p-2 bg-muted/30 max-h-64 space-y-3">
              {groupByOrigin(missingUrls).map(({ origin, entries }) => (
                <div key={origin}>
                  {origin && (
                    <div className="text-muted-foreground mb-1 select-all">{origin}</div>
                  )}
                  <div className="space-y-0.5">
                    {entries.map(({ url, path }) => (
                      <div key={url} className="flex items-start gap-2">
                        <AlertCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                        <span className="break-all text-foreground/80">{path}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={onClose}>
                Close
              </Button>
              <Button
                size="sm"
                onClick={handleExfiltrate}
                disabled={!connected}
                title={!connected ? "Client is not connected" : undefined}
              >
                Exfiltrate
              </Button>
            </div>
          </>
        ) : (
          /* ── Phase 2: Progress ── */
          <>
            <p className="text-sm text-muted-foreground">
              {doneCount} / {total} {total === 1 ? "file" : "files"} retrieved
            </p>

            {/* Per-URL status list, grouped by origin */}
            <div className="overflow-y-auto flex-1 text-xs font-mono border rounded-md p-2 bg-muted/30 max-h-64 space-y-3">
              {groupByOrigin(urls).map(({ origin, entries }) => (
                <div key={origin}>
                  {origin && (
                    <div className="text-muted-foreground mb-1 select-all">{origin}</div>
                  )}
                  <div className="space-y-0.5">
                    {entries.map(({ url, path }) => {
                      const status = getStatus(url, contentUrls, pendingExfiltrations);
                      return (
                        <div key={url} className="flex items-start gap-2">
                          {status === "done" && (
                            <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                          )}
                          {status === "fetching" && (
                            <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin shrink-0 mt-0.5" />
                          )}
                          {status === "pending" && (
                            <AlertCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                          )}
                          <span className="break-all text-foreground/80">{path}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={onClose}>
                Close
              </Button>
              <Button
                size="sm"
                disabled={doneCount === 0}
                title={doneCount === 0 ? "Waiting for content…" : "Download"}
                asChild={doneCount > 0}
              >
                {doneCount > 0 ? (
                  <a href={downloadHref} download>
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </a>
                ) : (
                  <>
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
