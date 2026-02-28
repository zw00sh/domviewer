import type { SpiderResult } from "@/types/api";

export interface TreeNode {
  /** Path segment name (e.g. "about", "index.html") */
  name: string;
  /** Full URL reconstructed up to this segment */
  fullPath: string;
  /** Set on discovered nodes — leaves or endpoints with a result */
  result?: SpiderResult;
  children: TreeNode[];
  /** True when the node has children or the URL path ends with "/" */
  isDirectory: boolean;
  /**
   * True when this path-segment node groups parameterised URL variants.
   * Its children are query-string leaf nodes (name = "key=val&...").
   */
  isParameterised?: boolean;
}

/**
 * Converts a flat list of spider results into a tree structure grouped by
 * origin, with directories sorted before files at each level.
 */
export function buildUrlTree(results: SpiderResult[]): TreeNode[] {
  if (results.length === 0) return [];

  // Group by origin (scheme + host + port)
  const byOrigin = new Map<string, SpiderResult[]>();
  for (const r of results) {
    try {
      const { origin } = new URL(r.url);
      if (!byOrigin.has(origin)) byOrigin.set(origin, []);
      byOrigin.get(origin)!.push(r);
    } catch {
      // skip malformed URLs
    }
  }

  const roots: TreeNode[] = [];

  for (const [origin, originResults] of byOrigin) {
    const originNode: TreeNode = {
      name: origin,
      fullPath: origin,
      children: [],
      isDirectory: true,
    };

    for (const result of originResults) {
      try {
        const url = new URL(result.url);
        const segments = url.pathname.split("/").filter(Boolean);

        if (segments.length === 0) {
          // Root path "/"
          originNode.result = result;
          continue;
        }

        let current = originNode;
        let currentPath = origin;

        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i];
          currentPath += "/" + seg;
          const isLast = i === segments.length - 1;

          let child = current.children.find((c) => c.name === seg);
          if (!child) {
            child = {
              name: seg,
              fullPath: currentPath,
              children: [],
              isDirectory: !isLast || url.pathname.endsWith("/"),
            };
            current.children.push(child);
          }

          if (isLast) {
            if (url.search) {
              // Parameterised endpoint: promote path node and attach result to a
              // query-string child so that /post?id=1 and /post?id=2 remain distinct.
              child.isParameterised = true;
              child.isDirectory = true;
              const queryName = url.search.slice(1); // e.g. "id=1&sort=asc"
              const queryPath = currentPath + url.search; // e.g. ".../post?id=1"
              let queryChild = child.children.find((c) => c.fullPath === queryPath);
              if (!queryChild) {
                queryChild = {
                  name: queryName,
                  fullPath: queryPath,
                  children: [],
                  isDirectory: false,
                };
                child.children.push(queryChild);
              }
              queryChild.result = result;
            } else {
              child.result = result;
              // Promote to directory if it already has children or path ends "/"
              if (child.children.length > 0 || url.pathname.endsWith("/")) {
                child.isDirectory = true;
              }
            }
          }

          current = child;
        }
      } catch {
        // skip malformed URLs
      }
    }

    sortNodes(originNode);
    roots.push(originNode);
  }

  return roots;
}

/** Recursively sorts a node's children: directories first, then alphabetically. */
function sortNodes(node: TreeNode): void {
  node.children.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) sortNodes(child);
}
