/**
 * Shared types and logic for DOM-streaming viewer hooks.
 *
 * Provides the single TypeScript source of truth for the node map types,
 * `applyMessage`, and `renderToHtml` — eliminating the ~200-line inline copies
 * that previously lived in use-dom-viewer.ts and use-proxy.ts.
 *
 * The logic mirrors shared/apply-delta.js and shared/render.js.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ElementNode {
  type: 1;
  tag: string;
  attrs: Record<string, string>;
  children: string[];
}

export interface TextNode {
  type: 3;
  text: string;
}

export type NodeData = ElementNode | TextNode;

export interface Meta {
  rootId?: string;
  baseUrl?: string;
  styles?: string;
}

export interface DeltaOp {
  op: string;
  [key: string]: unknown;
}

export interface SnapshotMessage {
  type: "snapshot";
  nodes: Record<string, NodeData>;
  meta: Meta;
}

export interface DeltaMessage {
  type: "delta";
  ops: DeltaOp[];
}

export interface MetaMessage {
  type: "meta";
  meta: Partial<Meta>;
}

export type DomViewerMessage = SnapshotMessage | DeltaMessage | MetaMessage;

// ─── Render + apply logic ─────────────────────────────────────────────────────
// Typed implementations mirroring shared/render.js and shared/apply-delta.js.

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderNode(
  nodesMap: Map<string, NodeData>,
  id: string,
  meta: Meta,
  embedNodeIds: boolean
): string {
  const node = nodesMap.get(id);
  if (!node) return "";

  if (node.type === 3) {
    return escapeHtml(node.text || "");
  }

  if (node.type === 1) {
    const { tag, attrs, children } = node;

    // Strip external stylesheet links — their CSS is captured in meta.styles
    if (tag === "link" && attrs) {
      const rel = attrs.rel;
      if (rel && rel.toLowerCase() === "stylesheet") return "";
    }

    let attrStr = "";
    if (embedNodeIds) {
      attrStr += ` data-nid="${escapeHtml(id)}"`;
    }
    if (attrs) {
      for (const [name, value] of Object.entries(attrs)) {
        attrStr += ` ${escapeHtml(name)}="${escapeHtml(value)}"`;
      }
    }

    if (VOID_ELEMENTS.has(tag)) {
      return `<${tag}${attrStr}>`;
    }

    let inner = "";
    if (children) {
      for (let i = 0; i < children.length; i++) {
        inner += renderNode(nodesMap, children[i], meta, embedNodeIds);
      }
    }

    if (tag === "head" && meta) {
      const baseTag = meta.baseUrl
        ? `<base href="${escapeHtml(meta.baseUrl)}" target="_blank">`
        : "";
      const styleTag = meta.styles ? `<style>${meta.styles}</style>` : "";
      inner = baseTag + inner + styleTag;
    }

    return `<${tag}${attrStr}>${inner}</${tag}>`;
  }

  return "";
}

/**
 * Render the full node map to a complete HTML document string.
 * Returns a placeholder document if no DOM has been captured yet.
 *
 * @param nodesMap - The nodes map.
 * @param rootId - ID of the root element.
 * @param meta - Meta object with baseUrl, styles, etc.
 * @param opts.embedNodeIds - When true, emit `data-nid` on every element (used by proxy viewer).
 */
export function renderToHtml(
  nodesMap: Map<string, NodeData>,
  rootId: string | undefined,
  meta: Meta,
  opts?: { embedNodeIds?: boolean }
): string {
  if (!rootId || !nodesMap.get(rootId)) {
    return "<!DOCTYPE html><html><body><p>No DOM captured yet.</p></body></html>";
  }
  return "<!DOCTYPE html>" + renderNode(nodesMap, rootId, meta, opts?.embedNodeIds ?? false);
}

function deleteSubtree(nodes: Map<string, NodeData>, id: string): void {
  const node = nodes.get(id);
  if (!node) return;
  if (node.type === 1 && node.children) {
    for (const childId of node.children) {
      deleteSubtree(nodes, childId);
    }
  }
  nodes.delete(id);
}

function applyOp(nodes: Map<string, NodeData>, op: DeltaOp): void {
  switch (op.op) {
    case "add":
      for (const [id, node] of Object.entries(op.nodes as Record<string, NodeData>)) {
        nodes.set(id, node);
      }
      break;
    case "remove":
      deleteSubtree(nodes, op.id as string);
      break;
    case "children": {
      const node = nodes.get(op.id as string);
      if (node && node.type === 1) {
        node.children = op.children as string[];
      }
      break;
    }
    case "attrs": {
      const node = nodes.get(op.id as string);
      if (node && node.type === 1) {
        if (!node.attrs) node.attrs = {};
        if (op.set) {
          for (const [k, v] of Object.entries(op.set as Record<string, string>)) {
            node.attrs[k] = v;
          }
        }
        if (op.del) {
          for (const name of op.del as string[]) {
            delete node.attrs[name];
          }
        }
      }
      break;
    }
    case "text": {
      const node = nodes.get(op.id as string);
      if (node && node.type === 3) {
        node.text = op.text as string;
      }
      break;
    }
  }
}

/**
 * Apply a decoded snapshot/delta/meta message to the nodes map and meta object.
 * Mutates both in place.
 */
export function applyMessage(
  nodes: Map<string, NodeData>,
  meta: Meta,
  msg: DomViewerMessage
): void {
  switch (msg.type) {
    case "snapshot":
      nodes.clear();
      for (const [id, node] of Object.entries(msg.nodes)) {
        nodes.set(id, node);
      }
      for (const key of Object.keys(meta) as (keyof Meta)[]) delete meta[key];
      Object.assign(meta, msg.meta);
      break;
    case "delta":
      for (const op of msg.ops) {
        applyOp(nodes, op);
      }
      break;
    case "meta":
      Object.assign(meta, msg.meta);
      break;
  }
}
