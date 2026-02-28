/**
 * Renders a plain-JS node map back to an HTML string for the domviewer.
 * Isomorphic — used by the server (Node.js) and web frontend (browser/Vite).
 *
 * Nodes are plain objects stored in a Map<string, NodeData>:
 *   Element: { type: 1, tag: string, attrs: object, children: string[] }
 *   Text:    { type: 3, text: string }
 *
 * Meta is a plain object: { rootId?: string, baseUrl?: string, styles?: string }
 *
 * `opts.embedNodeIds` (boolean, default false) — when true, emit `data-nid="${id}"`
 * on every element node. Used by the proxy viewer to map click targets back to
 * real DOM nodes on the victim's page.
 */

/**
 * HTML element tags that must not have a closing tag or child content.
 * @type {Set<string>}
 */
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/**
 * Elements whose text children must be emitted verbatim (no HTML escaping).
 * CSS and JS content uses characters like `>` in selectors and comparison
 * operators that must not be entity-encoded.
 * @type {Set<string>}
 */
const RAW_TEXT_ELEMENTS = new Set(["style", "script"]);

/**
 * Escape a string for safe insertion into HTML attribute values or text content.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Recursively render a single node and all its descendants to an HTML string.
 * @param {Map<string, object>} nodesMap - The nodes map containing all serialised nodes.
 * @param {string} id - The ID of the node to render.
 * @param {object} meta - Meta object (baseUrl, styles, rootId).
 * @param {{ embedNodeIds?: boolean }} [opts] - Rendering options.
 * @returns {string} HTML string for this node and its children.
 */
function renderNode(nodesMap, id, meta, opts) {
  const node = nodesMap.get(id);
  if (!node) return "";

  if (node.type === 3) {
    return escapeHtml(node.text || "");
  }

  if (node.type === 1) {
    const { tag, attrs, children } = node;

    // Skip external stylesheet links — their CSS is captured in meta.styles
    if (tag === "link" && attrs) {
      const rel = attrs.rel;
      if (rel && rel.toLowerCase() === "stylesheet") {
        return "";
      }
    }

    let attrStr = "";

    // Embed node ID for interactive proxy viewers
    if (opts && opts.embedNodeIds) {
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
      if (RAW_TEXT_ELEMENTS.has(tag)) {
        // Emit text children verbatim — CSS/JS must not have `>` etc. entity-encoded
        for (const childId of children) {
          const child = nodesMap.get(childId);
          if (child && child.type === 3) inner += child.text || "";
        }
      } else {
        for (let i = 0; i < children.length; i++) {
          inner += renderNode(nodesMap, children[i], meta, opts);
        }
      }
    }

    // Inject <meta charset>, <base> tag, and captured styles in <head>
    if (tag === "head" && meta) {
      const charsetTag = '<meta charset="utf-8">';
      const baseTag = meta.baseUrl ? `<base href="${escapeHtml(meta.baseUrl)}" target="_blank">` : "";
      const styleTag = meta.styles ? `<style>${meta.styles}</style>` : "";
      inner = charsetTag + baseTag + inner + styleTag;
    }

    return `<${tag}${attrStr}>${inner}</${tag}>`;
  }

  return "";
}

/**
 * Render the full node map to a complete HTML document string.
 * Returns a placeholder document if no DOM has been captured yet.
 * @param {Map<string, object>} nodesMap - The nodes map.
 * @param {string|undefined} rootId - ID of the root element.
 * @param {object} meta - Meta object with baseUrl, styles, etc.
 * @param {{ embedNodeIds?: boolean }} [opts] - Rendering options.
 * @returns {string} Full HTML document string.
 */
export function renderToHtml(nodesMap, rootId, meta, opts) {
  if (!rootId || !nodesMap.get(rootId)) {
    return "<!DOCTYPE html><html><body><p>No DOM captured yet.</p></body></html>";
  }
  return "<!DOCTYPE html>" + renderNode(nodesMap, rootId, meta, opts);
}
