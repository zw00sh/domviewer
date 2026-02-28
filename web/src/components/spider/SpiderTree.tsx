import { useState, useCallback } from "react";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  File,
  Copy,
  RefreshCw,
  Download,
  Loader2,
  Settings,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TreeNode } from "@/lib/url-tree";
import { ContentPreview } from "@/components/spider/ContentPreview";

interface SpiderTreeProps {
  nodes: TreeNode[];
  /** Set of URLs that have stored content in the server DB. */
  contentUrls?: Set<string>;
  /** Set of URLs currently being exfiltrated (show spinner). */
  pendingExfiltrations?: Set<string>;
  /** Callback to trigger manual exfiltration for a list of URLs. */
  onExfiltrate?: (urls: string[]) => void;
  /** Callback to trigger a re-crawl from one or more seed URLs. Only shown on directory nodes. */
  onCrawl?: (seeds: string[]) => void;
  /**
   * Callback when the user clicks Download on a node with no stored content.
   * Opens the exfiltration dialog so content is fetched before downloading.
   */
  onRequestDownload?: (urls: string[], downloadHref: string) => void;
  /**
   * Callback when the user clicks RefreshCw (re-fetch). Fires exfiltration
   * immediately and opens the progress dialog skipping the confirmation step.
   */
  onExfiltrateWithProgress?: (urls: string[], downloadHref: string) => void;
  /** The client ID (needed for content API URLs). */
  clientId?: string;
  /** Whether the client is currently connected. Disables the re-fetch button when false. */
  connected?: boolean;
}

/**
 * Recursive tree view for spider results. Directories are collapsible;
 * leaf nodes expand to show metadata and stored content preview.
 * Expand/collapse state is preserved across result updates.
 */
export function SpiderTree({
  nodes,
  contentUrls = new Set(),
  pendingExfiltrations = new Set(),
  onExfiltrate,
  onCrawl,
  onRequestDownload,
  onExfiltrateWithProgress,
  clientId,
  connected = false,
}: SpiderTreeProps) {
  // Tracks which nodes the user has manually collapsed. Absent = expanded (default).
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(
    new Set()
  );
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const toggleExpand = useCallback((path: string) => {
    setCollapsedPaths((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }, []);

  const toggleDetails = useCallback((path: string) => {
    setExpandedDetails((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  }, []);

  const copyUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch {
      // clipboard unavailable
    }
  }, []);

  if (nodes.length === 0) return null;

  return (
    <div className="font-mono text-sm border border-border rounded-md bg-card overflow-hidden">
      {nodes.map((node) => (
        <TreeNodeRow
          key={node.fullPath}
          node={node}
          depth={0}
          collapsedPaths={collapsedPaths}
          expandedDetails={expandedDetails}
          copiedUrl={copiedUrl}
          contentUrls={contentUrls}
          pendingExfiltrations={pendingExfiltrations}
          onToggleExpand={toggleExpand}
          onToggleDetails={toggleDetails}
          onCopyUrl={copyUrl}
          onExfiltrate={onExfiltrate}
          onCrawl={onCrawl}
          onRequestDownload={onRequestDownload}
          onExfiltrateWithProgress={onExfiltrateWithProgress}
          clientId={clientId}
          connected={connected}
        />
      ))}
    </div>
  );
}

interface TreeNodeRowProps {
  node: TreeNode;
  depth: number;
  /** Paths the user has manually collapsed; absent = expanded (default). */
  collapsedPaths: Set<string>;
  expandedDetails: Set<string>;
  copiedUrl: string | null;
  contentUrls: Set<string>;
  pendingExfiltrations: Set<string>;
  onToggleExpand: (path: string) => void;
  onToggleDetails: (path: string) => void;
  onCopyUrl: (url: string) => void;
  onExfiltrate?: (urls: string[]) => void;
  onCrawl?: (seeds: string[]) => void;
  onRequestDownload?: (urls: string[], downloadHref: string) => void;
  onExfiltrateWithProgress?: (urls: string[], downloadHref: string) => void;
  clientId?: string;
  connected: boolean;
}

/**
 * Recursively collects all discovered URLs in a subtree.
 * Includes the URL of interior (directory) nodes that also have a spider result
 * (e.g. the origin root "/", or crawled directory paths ending with "/"),
 * as well as all descendant leaf URLs.
 * Used to select all URLs in a directory for bulk exfiltration, re-crawl, or zip download.
 */
function collectSubtreeUrls(node: TreeNode): string[] {
  const self = node.result?.url ? [node.result.url] : [];
  if (!node.children || node.children.length === 0) {
    return self;
  }
  return [...self, ...node.children.flatMap(collectSubtreeUrls)];
}

/**
 * Returns true if any URL in the subtree rooted at `node` is in `contentUrls`.
 */
function subtreeHasContent(node: TreeNode, contentUrls: Set<string>): boolean {
  if (!node.children || node.children.length === 0) {
    return node.result?.url ? contentUrls.has(node.result.url) : false;
  }
  return node.children.some((c) => subtreeHasContent(c, contentUrls));
}

/**
 * Returns true if any URL in the subtree is in `pendingExfiltrations`.
 */
function subtreeIsPending(node: TreeNode, pending: Set<string>): boolean {
  if (!node.children || node.children.length === 0) {
    return node.result?.url ? pending.has(node.result.url) : false;
  }
  return node.children.some((c) => subtreeIsPending(c, pending));
}

function TreeNodeRow({
  node,
  depth,
  collapsedPaths,
  expandedDetails,
  copiedUrl,
  contentUrls,
  pendingExfiltrations,
  onToggleExpand,
  onToggleDetails,
  onCopyUrl,
  onExfiltrate,
  onCrawl,
  onRequestDownload,
  onExfiltrateWithProgress,
  clientId,
  connected,
}: TreeNodeRowProps) {
  // Nodes are expanded by default; only present in collapsedPaths when user collapses them.
  const isExpanded = !collapsedPaths.has(node.fullPath);
  const isDetailsExpanded = expandedDetails.has(node.fullPath);
  const hasChildren = node.children.length > 0;
  const isDir = hasChildren || node.isDirectory;
  const url = node.result?.url ?? node.fullPath;

  // Per-node content / pending state
  const nodeHasContent = isDir ? subtreeHasContent(node, contentUrls) : contentUrls.has(url);
  const nodeIsPending = isDir
    ? subtreeIsPending(node, pendingExfiltrations)
    : pendingExfiltrations.has(url);

  function handleRowClick() {
    if (isDir) {
      onToggleExpand(node.fullPath);
    } else {
      onToggleDetails(node.fullPath);
    }
  }

  function handleExfiltrate(e: React.MouseEvent) {
    e.stopPropagation();
    const urls = isDir ? collectSubtreeUrls(node) : [url];
    if (onExfiltrateWithProgress && clientId) {
      // Open progress dialog immediately (exfiltration fires in the handler)
      onExfiltrateWithProgress(urls, getDownloadHref());
    } else if (onExfiltrate) {
      onExfiltrate(urls);
    }
  }

  function handleCrawl(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onCrawl) return;
    // For directories, crawl all leaf URLs; for files use the node URL directly
    const seeds = isDir ? collectSubtreeUrls(node) : [url];
    onCrawl(seeds);
  }

  /**
   * Returns the download href for this node.
   * Directories: ZIP endpoint.
   * Files with content: latest-version redirect endpoint.
   */
  function getDownloadHref(): string {
    if (isDir) {
      return `/api/clients/${clientId}/spider/download?path=${encodeURIComponent(url)}`;
    }
    return `/api/clients/${clientId}/spider/content/latest?url=${encodeURIComponent(url)}`;
  }

  /** Download href when content exists, null otherwise. */
  const downloadHref = (clientId && nodeHasContent) ? getDownloadHref() : null;

  /** Download href used for "no content yet" button — triggers exfiltration dialog. */
  const downloadHrefForDialog = clientId ? getDownloadHref() : null;

  return (
    <div className={cn(depth === 0 && "border-b border-border last:border-b-0")}>
      {/* Row */}
      <div
        className="group flex items-center gap-1.5 py-1.5 hover:bg-accent/60 cursor-pointer select-none"
        style={{ paddingLeft: `${8 + depth * 16}px`, paddingRight: "8px" }}
        onClick={handleRowClick}
      >
        {/* Expand chevron */}
        <span className="text-muted-foreground w-4 flex-shrink-0 flex items-center">
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : null}
        </span>

        {/* Icon */}
        <span className="flex-shrink-0">
          {isDir ? (
            node.isParameterised ? (
              // Cog icon for parameterised endpoint groups (query-string children)
              <Settings className="h-4 w-4 text-violet-400/80" />
            ) : isExpanded ? (
              <FolderOpen className="h-4 w-4 text-amber-500" />
            ) : (
              <Folder className="h-4 w-4 text-amber-500" />
            )
          ) : (
            <File className="h-4 w-4 text-blue-400" />
          )}
        </span>

        {/* Name */}
        <span className="flex-1 truncate text-foreground text-xs">
          {node.name}
        </span>

        {/* Child count */}
        {hasChildren && (
          <span className="text-xs text-muted-foreground mr-1">
            {node.children.length}
          </span>
        )}

        {/* HTTP status badge */}
        {node.result?.status && (
          <span
            className={cn(
              "text-xs px-1.5 py-0.5 rounded font-sans",
              String(node.result.status) === "200"
                ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
            )}
          >
            {node.result.status}
          </span>
        )}

        {/* Hover actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Re-spider button — only on directory nodes, requires connected client */}
          {isDir && onCrawl && (
            <button
              type="button"
              title={!connected ? "Client disconnected" : "Re-spider from here"}
              onClick={handleCrawl}
              disabled={!connected}
              className="p-1 rounded hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Search className="h-3 w-3 text-muted-foreground" />
            </button>
          )}

          {/* Re-fetch (exfiltrate) button — disabled when client is disconnected */}
          {(onExfiltrate || onExfiltrateWithProgress) && (
            <button
              type="button"
              title={
                !connected
                  ? "Client disconnected"
                  : nodeIsPending
                  ? "Fetching..."
                  : "Fetch fresh copy"
              }
              onClick={handleExfiltrate}
              disabled={nodeIsPending || !connected}
              className="p-1 rounded hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {nodeIsPending ? (
                <Loader2 className="h-3 w-3 text-muted-foreground animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3 text-muted-foreground" />
              )}
            </button>
          )}

          {/* Download button — always shown when clientId is set */}
          {clientId && (
            nodeHasContent && downloadHref ? (
              // Content exists: direct download link
              <a
                href={downloadHref}
                download
                title="Download stored content"
                onClick={(e) => e.stopPropagation()}
                className="p-1 rounded hover:bg-accent"
              >
                <Download className="h-3 w-3 text-muted-foreground" />
              </a>
            ) : downloadHrefForDialog && onRequestDownload ? (
              // No content yet: open exfiltration dialog first
              <button
                type="button"
                title="Download (will exfiltrate first)"
                onClick={(e) => {
                  e.stopPropagation();
                  const urls = isDir ? collectSubtreeUrls(node) : [url];
                  onRequestDownload(urls, downloadHrefForDialog);
                }}
                className="p-1 rounded hover:bg-accent"
              >
                <Download className="h-3 w-3 text-muted-foreground opacity-50" />
              </button>
            ) : null
          )}

          {/* Copy URL */}
          <button
            type="button"
            title="Copy URL"
            onClick={(e) => {
              e.stopPropagation();
              onCopyUrl(url);
            }}
            className="p-1 rounded hover:bg-accent"
          >
            {copiedUrl === url ? (
              <span className="text-green-500 text-xs leading-none">✓</span>
            ) : (
              <Copy className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded leaf metadata + content preview */}
      {isDetailsExpanded && node.result && (
        <div
          className="bg-muted/50 text-xs space-y-1 py-2 font-sans border-b border-border"
          style={{ paddingLeft: `${8 + (depth + 1) * 16}px`, paddingRight: "8px" }}
        >
          <div className="break-all flex items-start gap-1">
            <span className="font-medium text-foreground shrink-0">URL: </span>
            <span className="text-muted-foreground flex-1">{node.result.url}</span>
            <button
              type="button"
              title="Copy URL"
              onClick={() => onCopyUrl(node.result!.url)}
              className="shrink-0 p-0.5 rounded hover:bg-accent"
            >
              {copiedUrl === node.result.url ? (
                <span className="text-green-500 text-xs leading-none">✓</span>
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground" />
              )}
            </button>
          </div>
          {node.result.status && (
            <div>
              <span className="font-medium text-foreground">Status: </span>
              {node.result.status}
            </div>
          )}
          <div>
            <span className="font-medium text-foreground">Depth: </span>
            {node.result.depth}
          </div>
          {node.result.contentType && (
            <div>
              <span className="font-medium text-foreground">Content-Type: </span>
              {node.result.contentType}
            </div>
          )}
          {node.result.size != null && node.result.size > 0 && (
            <div>
              <span className="font-medium text-foreground">Size: </span>
              {node.result.size < 1024
                ? `${node.result.size} B`
                : `${(node.result.size / 1024).toFixed(1)} KB`}
            </div>
          )}
          {node.result.discoveredAt && (
            <div>
              <span className="font-medium text-foreground">Discovered: </span>
              {new Date(node.result.discoveredAt).toLocaleString()}
            </div>
          )}
          {/* Stored content preview — re-fetches when contentUrls.size changes */}
          {clientId && node.result.url && (nodeHasContent ? (
            <ContentPreview
              clientId={clientId}
              url={node.result.url}
              refreshKey={contentUrls.size}
              connected={connected}
              isPending={nodeIsPending}
              onExfiltrate={onExfiltrate}
            />
          ) : null)}
        </div>
      )}

      {/* Children */}
      {isExpanded && hasChildren && (
        <div className="border-l border-border" style={{ marginLeft: `${8 + depth * 16 + 12}px` }}>
          {node.children.map((child) => (
            <TreeNodeRow
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              collapsedPaths={collapsedPaths}
              expandedDetails={expandedDetails}
              copiedUrl={copiedUrl}
              contentUrls={contentUrls}
              pendingExfiltrations={pendingExfiltrations}
              onToggleExpand={onToggleExpand}
              onToggleDetails={onToggleDetails}
              onCopyUrl={onCopyUrl}
              onExfiltrate={onExfiltrate}
              onCrawl={onCrawl}
              onRequestDownload={onRequestDownload}
              onExfiltrateWithProgress={onExfiltrateWithProgress}
              clientId={clientId}
              connected={connected}
            />
          ))}
        </div>
      )}
    </div>
  );
}
