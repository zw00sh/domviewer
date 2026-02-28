import { useEffect, useState } from "react";
import { codeToHtml } from "shiki/bundle/web";
import { Download, RefreshCw, Loader2 } from "lucide-react";
import type { SpiderContentVersion } from "@/types/api";

interface ContentPreviewProps {
  clientId: string;
  url: string;
  /** Increment this value to trigger a re-fetch of the version list (e.g. after new content is stored). */
  refreshKey?: number;
  /** Whether the client is currently connected (enables the re-fetch button). */
  connected?: boolean;
  /** True when this URL is currently being exfiltrated (shows spinner on re-fetch button). */
  isPending?: boolean;
  /** Callback to trigger manual exfiltration (re-fetch) for this URL. */
  onExfiltrate?: (urls: string[]) => void;
}

/** Formats a byte count as a human-readable string (e.g. "12.3 KB"). */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Formats a Unix millisecond timestamp as a locale date+time string. */
function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

/** Returns true if the content type is likely displayable as text. */
function isText(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return (
    ct.startsWith("text/") ||
    ct.includes("json") ||
    ct.includes("javascript") ||
    ct.includes("xml")
  );
}

/**
 * Maps a MIME content-type to a Shiki language identifier.
 * Falls back to 'plaintext' for anything unrecognised.
 */
function getLanguage(contentType: string): string {
  const ct = contentType.toLowerCase().split(";")[0].trim();
  if (ct.includes("html")) return "html";
  if (ct.includes("css")) return "css";
  if (ct.includes("typescript")) return "typescript";
  if (ct.includes("javascript") || ct === "application/x-javascript") return "javascript";
  if (ct.includes("json")) return "json";
  if (ct.includes("svg") || ct.includes("xml")) return "xml";
  if (ct.includes("markdown")) return "markdown";
  if (ct.includes("yaml")) return "yaml";
  if (ct.includes("bash") || ct.includes("shell")) return "bash";
  if (ct.includes("sql")) return "sql";
  return "plaintext";
}

/** Highlight source text using Shiki with a light/dark dual theme. */
async function highlight(text: string, lang: string): Promise<string> {
  return codeToHtml(text, {
    lang,
    themes: { light: "github-light", dark: "github-dark-dimmed" },
    defaultColor: false,
  });
}

/**
 * Fetches stored content versions for a URL and renders a version selector.
 * Text content is displayed in a scrollable <pre> block; binary content
 * shows metadata and a download link.
 * Includes a re-fetch button to trigger a fresh exfiltration.
 */
export function ContentPreview({ clientId, url, refreshKey, connected = false, isPending = false, onExfiltrate }: ContentPreviewProps) {
  const [versions, setVersions] = useState<SpiderContentVersion[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  /** Shiki-highlighted HTML for the selected version's text content. */
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);

  // Fetch version list on mount, URL change, or when refreshKey increments (new content stored)
  useEffect(() => {
    setLoading(true);
    setVersions([]);
    setSelectedId(null);
    setHighlightedHtml(null);
    fetch(`/api/clients/${clientId}/spider/content?url=${encodeURIComponent(url)}`)
      .then((r) => r.json())
      .then((data: SpiderContentVersion[]) => {
        setVersions(data);
        if (data.length > 0) setSelectedId(data[0].id);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, url, refreshKey]);

  // Fetch body and syntax-highlight when selected version changes
  useEffect(() => {
    if (!selectedId) {
      setHighlightedHtml(null);
      return;
    }
    const version = versions.find((v) => v.id === selectedId);
    if (!version) return;

    if (!isText(version.contentType)) {
      // Binary — don't fetch; just show metadata
      setHighlightedHtml(null);
      return;
    }

    let cancelled = false;
    setBodyLoading(true);
    setHighlightedHtml(null);

    fetch(`/api/clients/${clientId}/spider/content/${selectedId}`)
      .then((r) => r.text())
      .then((text) => highlight(text, getLanguage(version.contentType)))
      .then((html) => { if (!cancelled) setHighlightedHtml(html); })
      .catch(() => { if (!cancelled) setHighlightedHtml("<pre>(failed to load content)</pre>"); })
      .finally(() => { if (!cancelled) setBodyLoading(false); });

    return () => { cancelled = true; };
  }, [selectedId, clientId, versions]);

  if (loading) {
    return <p className="text-xs text-muted-foreground italic">Loading versions...</p>;
  }

  if (versions.length === 0) {
    return null;
  }

  const selectedVersion = versions.find((v) => v.id === selectedId);
  const showText = selectedVersion && isText(selectedVersion.contentType);
  const showHighlighted = showText && highlightedHtml !== null;

  return (
    <div className="mt-2 space-y-2">
      {/* Version selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-foreground">Version:</span>
        <select
          className="text-xs border rounded px-1.5 py-0.5 bg-background text-foreground"
          value={selectedId ?? ""}
          onChange={(e) => setSelectedId(Number(e.target.value))}
        >
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {formatDate(v.fetchedAt)} ({formatSize(v.size)})
            </option>
          ))}
        </select>
        {selectedVersion && (
          <a
            href={`/api/clients/${clientId}/spider/content/${selectedVersion.id}`}
            download
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            title="Download this version"
          >
            <Download className="h-3 w-3" />
          </a>
        )}
        {/* Re-fetch button: trigger a fresh exfiltration of this URL */}
        {onExfiltrate && (
          <button
            type="button"
            title={!connected ? "Client disconnected" : isPending ? "Fetching..." : "Fetch fresh copy"}
            onClick={() => onExfiltrate([url])}
            disabled={!connected || isPending}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </button>
        )}
      </div>

      {/* Content display */}
      {selectedVersion && (
        <>
          <div className="text-xs text-muted-foreground">
            {selectedVersion.contentType || "unknown type"} · {formatSize(selectedVersion.size)}
          </div>
          {showText ? (
            bodyLoading ? (
              <p className="text-xs text-muted-foreground italic">Loading content...</p>
            ) : showHighlighted ? (
              /* Shiki outputs a <pre><code>…</code></pre> with inline CSS variable styles.
                 The .shiki / .dark .shiki rules in index.css switch between the two themes. */
              <div
                className="text-xs rounded overflow-auto max-h-64 [&_pre]:m-0 [&_pre]:p-2 [&_pre]:text-xs [&_pre]:font-mono [&_pre]:rounded [&_pre]:whitespace-pre-wrap [&_pre]:break-all"
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            ) : null
          ) : (
            <div className="text-xs text-muted-foreground italic">
              Binary content — <a
                href={`/api/clients/${clientId}/spider/content/${selectedVersion.id}`}
                download
                className="underline hover:text-foreground"
              >
                download to view
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
}
