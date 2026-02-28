/**
 * DOM serialisation utilities for the domviewer payload.
 *
 * Replaces the former Yjs-based serialiser with plain JS objects and a custom
 * delta format. State is held in module-level variables (nodes Map, meta object).
 *
 * `serializeFull` captures the entire DOM tree into a snapshot message.
 * `syncMutations` applies a batch of MutationObserver records as delta ops.
 * `collectStyles` captures all computed CSS into a meta update message.
 * `getSnapshot` returns the current state as a snapshot (for reconnect sync).
 * `reset` clears all state (for destroy).
 *
 * Node types:
 *   type 1 → Element node  (tag, attrs object, children array of child IDs)
 *   type 3 → Text node     (text string)
 *
 * `createSerializer()` returns an isolated serialiser instance. Multiple payloads
 * (e.g. domviewer and proxy) may each create their own instance so their state
 * does not collide.
 *
 * The module-level named exports (`serializeFull`, `syncMutations`, etc.) are
 * backed by a shared default instance for backward compatibility — domviewer.js
 * does not need to change.
 */

/**
 * Resolve relative `url()` references inside a CSS string to absolute URLs.
 * Data URIs and fragment-only references are left unchanged.
 * @param {string} cssText
 * @param {string} baseURI
 * @returns {string}
 */
export function resolveStyleUrls(cssText, baseURI) {
  if (!baseURI) return cssText;
  return cssText.replace(/url\(\s*(['"]?)(.+?)\1\s*\)/g, (match, quote, rawUrl) => {
    const trimmed = rawUrl.trim();
    if (trimmed.startsWith("data:") || trimmed.startsWith("#")) return match;
    try {
      const absolute = new URL(trimmed, baseURI).href;
      return `url(${quote}${absolute}${quote})`;
    } catch (_) {
      return match;
    }
  });
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create an isolated serialiser instance.
 *
 * Each instance owns its own `nextId` counter, `nodeToId` WeakMap,
 * `idToNode` reverse-lookup Map, `nodes` Map, `meta` object, and
 * `lastStylesHash` dedup string.
 *
 * @returns {{
 *   serializeFull: (rootElement: Element) => object,
 *   syncMutations: (mutations: MutationRecord[]) => object|null,
 *   collectStyles: (targetDoc?: Document) => Promise<object|null>,
 *   setBaseUrl: (url: string) => object|null,
 *   getSnapshot: () => object,
 *   reset: () => void,
 *   getNodeById: (id: string) => Node|null,
 *   getIdForNode: (node: Node) => string|undefined,
 * }}
 */
export function createSerializer() {
  let nextId = 0;

  /** @type {WeakMap<Node, string>} DOM node → stable ID */
  const nodeToId = new WeakMap();

  /** @type {Map<string, Node>} stable ID → DOM node (reverse lookup for event dispatch) */
  const idToNode = new Map();

  /** @type {Map<string, object>} */
  const nodes = new Map();

  /** @type {object} */
  const meta = {};

  /** Last collected CSS text — used for dedup to avoid spurious updates. */
  let lastStylesHash = "";

  /**
   * Allocate a stable string ID for a DOM node and record the mapping.
   * @param {Node} node
   * @returns {string}
   */
  function allocId(node) {
    const id = "n" + nextId++;
    nodeToId.set(node, id);
    idToNode.set(id, node);
    return id;
  }

  /**
   * Return true if the node should be omitted from serialisation.
   *
   * Skips:
   *   - Comment nodes
   *   - `<script>` elements (would be blocked in viewer sandbox anyway)
   *   - `<noscript>` elements — when JS is enabled (victim browser) noscript
   *     content is hidden, but in the viewer's sandboxed iframe (JS disabled)
   *     noscript content renders. If that content contains `<script>` tags the
   *     browser logs "Blocked script execution in about:blank". Skipping noscript
   *     entirely prevents this spurious error.
   *
   * @param {Node} node
   * @returns {boolean}
   */
  function shouldSkip(node) {
    if (node.nodeType === 8) return true; // comment
    if (node.nodeType === 1) {
      const tag = node.tagName;
      if (tag === "SCRIPT" || tag === "NOSCRIPT") return true;
    }
    return false;
  }

  /**
   * Recursively serialise a single DOM node (and its descendants) into the nodes map.
   * Returns the allocated node ID, or null if the node was skipped.
   * Also populates a collector object with newly added node data (for delta ops).
   * @param {Node} node
   * @param {object|null} [addedNodes] - If provided, newly serialised nodes are added here.
   * @returns {string|null}
   */
  function serializeNode(node, addedNodes = null) {
    if (shouldSkip(node)) return null;

    const id = allocId(node);

    if (node.nodeType === 3) {
      const data = { type: 3, text: node.textContent };
      nodes.set(id, data);
      if (addedNodes) addedNodes[id] = data;
      return id;
    }

    if (node.nodeType === 1) {
      const attrs = {};
      for (const attr of node.attributes) {
        attrs[attr.name] = attr.value;
      }

      const children = [];
      for (const child of node.childNodes) {
        const childId = serializeNode(child, addedNodes);
        if (childId !== null) children.push(childId);
      }

      const data = { type: 1, tag: node.tagName.toLowerCase(), attrs, children };
      nodes.set(id, data);
      if (addedNodes) addedNodes[id] = data;
      return id;
    }

    return null;
  }

  /**
   * Remove a node and all its descendants from the nodes map, and from idToNode.
   * @param {string} id
   */
  function deleteSubtree(id) {
    const node = nodes.get(id);
    if (!node) return;
    if (node.type === 1 && node.children) {
      for (const childId of node.children) {
        deleteSubtree(childId);
      }
    }
    nodes.delete(id);
    idToNode.delete(id);
  }

  /**
   * Rebuild a parent's children array from current DOM state.
   * Returns the new children array, or null if unchanged.
   * Any previously untracked or stale children are serialised into `addedNodes`.
   * @param {string} parentId
   * @param {Node} parentNode
   * @param {object|null} [addedNodes] - Collector for newly serialised node data.
   * @returns {string[]|null}
   */
  function rebuildChildren(parentId, parentNode, addedNodes = null) {
    const parent = nodes.get(parentId);
    if (!parent || parent.type !== 1) return null;

    const newChildIds = [];
    for (const child of parentNode.childNodes) {
      if (shouldSkip(child)) continue;
      let childId = nodeToId.get(child);
      if (!childId || !nodes.has(childId)) {
        // New node or stale WeakMap entry — serialise now and collect for add op
        childId = serializeNode(child, addedNodes);
      }
      if (childId) newChildIds.push(childId);
    }

    parent.children = newChildIds;
    return newChildIds;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Perform a full serialisation of a DOM subtree.
   * Clears any existing state and rebuilds from scratch.
   * Returns a `{ type: "snapshot", nodes, meta }` message.
   * @param {Element} rootElement
   * @returns {object}
   */
  function serializeFull(rootElement) {
    nextId = 0;
    nodes.clear();
    idToNode.clear();
    lastStylesHash = "";
    // Preserve baseUrl/styles if already set
    const savedBaseUrl = meta.baseUrl;
    const savedStyles = meta.styles;
    for (const key of Object.keys(meta)) delete meta[key];
    if (savedBaseUrl) meta.baseUrl = savedBaseUrl;
    if (savedStyles) meta.styles = savedStyles;

    const rootId = serializeNode(rootElement);
    meta.rootId = rootId;

    return {
      type: "snapshot",
      nodes: Object.fromEntries(nodes),
      meta: { ...meta },
    };
  }

  /**
   * Apply a batch of MutationObserver records and return a delta message.
   * Returns `{ type: "delta", ops }` or null if no meaningful changes.
   *
   * Uses a two-phase approach to correctly handle moved DOM nodes:
   *   Phase 1 — collect removed nodes, added nodes, childList parents, attr/char mutations.
   *   Phase 2 — detect moves (in both removed AND added), then emit ops only for
   *              truly removed and truly added nodes; rebuild each parent's children once.
   *
   * @param {MutationRecord[]} mutations
   * @returns {object|null}
   */
  function syncMutations(mutations) {
    const ops = [];

    // Phase 1: Collect all relevant info from mutations
    /** @type {Map<Node, string>} DOM node → existing ID */
    const removedDomNodes = new Map();
    /** @type {Set<Node>} */
    const addedDomNodes = new Set();
    /** @type {Set<Node>} Deduplicated parent nodes with childList mutations */
    const childListParents = new Set();
    const attrMuts = [];
    const charMuts = [];

    for (const mut of mutations) {
      if (mut.type === "childList") {
        const parentId = nodeToId.get(mut.target);
        if (!parentId) continue;
        childListParents.add(mut.target);
        for (const r of mut.removedNodes) {
          if (shouldSkip(r)) continue;
          const id = nodeToId.get(r);
          if (id) removedDomNodes.set(r, id);
        }
        for (const a of mut.addedNodes) {
          if (!shouldSkip(a)) addedDomNodes.add(a);
        }
      } else if (mut.type === "attributes") {
        attrMuts.push(mut);
      } else if (mut.type === "characterData") {
        charMuts.push(mut);
      }
    }

    // Phase 2: Detect moves (node present in both sets → preserve data, skip remove+add)
    const movedNodes = new Set();
    for (const node of addedDomNodes) {
      if (removedDomNodes.has(node)) movedNodes.add(node);
    }
    for (const node of movedNodes) {
      removedDomNodes.delete(node);
      addedDomNodes.delete(node);
    }

    // Emit add ops for truly new nodes (no valid tracking in nodes map)
    const addedCollector = {};
    for (const node of addedDomNodes) {
      const existingId = nodeToId.get(node);
      if (!existingId || !nodes.has(existingId)) {
        serializeNode(node, addedCollector);
      }
    }
    if (Object.keys(addedCollector).length > 0) {
      ops.push({ op: "add", nodes: addedCollector });
    }

    // Emit remove ops for truly removed nodes
    for (const [, id] of removedDomNodes) {
      deleteSubtree(id);
      ops.push({ op: "remove", id });
    }

    // Rebuild children once per unique parent; collect any newly discovered nodes
    for (const parentNode of childListParents) {
      const parentId = nodeToId.get(parentNode);
      if (!parentId) continue;
      const collector = {};
      const children = rebuildChildren(parentId, parentNode, collector);
      if (children) {
        if (Object.keys(collector).length > 0) {
          ops.push({ op: "add", nodes: collector });
        }
        ops.push({ op: "children", id: parentId, children });
      }
    }

    // Attribute changes
    for (const mut of attrMuts) {
      const id = nodeToId.get(mut.target);
      if (!id) continue;
      const node = nodes.get(id);
      if (!node) continue;
      const name = mut.attributeName;
      const value = mut.target.getAttribute(name);
      if (value === null) {
        // Attribute removed
        delete node.attrs[name];
        ops.push({ op: "attrs", id, set: {}, del: [name] });
      } else {
        // Attribute added or changed
        node.attrs[name] = value;
        ops.push({ op: "attrs", id, set: { [name]: value }, del: [] });
      }
    }

    // Character data changes
    for (const mut of charMuts) {
      const id = nodeToId.get(mut.target);
      if (!id) continue;
      const node = nodes.get(id);
      if (!node) continue;
      node.text = mut.target.textContent;
      ops.push({ op: "text", id, text: node.text });
    }

    if (ops.length === 0) return null;
    return { type: "delta", ops };
  }

  /**
   * Collect all CSS from the target document's stylesheets.
   * Returns a `{ type: "meta", meta: { styles } }` message, or null if unchanged.
   * Uses string comparison to avoid spurious updates on static pages.
   * @param {Document} [targetDoc]
   * @returns {Promise<object|null>}
   */
  async function collectStyles(targetDoc = document) {
    let cssText = "";

    for (const sheet of targetDoc.styleSheets) {
      try {
        const rules = sheet.cssRules;
        for (const rule of rules) {
          cssText += rule.cssText + "\n";
        }
      } catch (e) {
        // Cross-origin sheet — try fetching it
        if (sheet.href) {
          try {
            const res = await fetch(sheet.href);
            if (res.ok) {
              cssText += (await res.text()) + "\n";
            }
          } catch (_) {
            // Unreachable stylesheet, skip
          }
        }
      }
    }

    cssText = resolveStyleUrls(cssText, targetDoc.baseURI);

    // Dedup: skip if styles haven't changed
    if (cssText === lastStylesHash) return null;
    lastStylesHash = cssText;

    meta.styles = cssText;
    return { type: "meta", meta: { styles: cssText } };
  }

  /**
   * Set the base URL in meta. Returns a meta message or null if unchanged.
   * @param {string} url
   * @returns {object|null}
   */
  function setBaseUrl(url) {
    if (meta.baseUrl === url) return null;
    meta.baseUrl = url;
    return { type: "meta", meta: { baseUrl: url } };
  }

  /**
   * Return the current state as a snapshot message (for reconnect sync).
   * @returns {object}
   */
  function getSnapshot() {
    return {
      type: "snapshot",
      nodes: Object.fromEntries(nodes),
      meta: { ...meta },
    };
  }

  /**
   * Clear all state. Called on destroy.
   */
  function reset() {
    nextId = 0;
    nodes.clear();
    idToNode.clear();
    for (const key of Object.keys(meta)) delete meta[key];
    lastStylesHash = "";
  }

  /**
   * Look up the original DOM node for a given serialiser ID.
   * Returns null if the ID is unknown or the node has been removed.
   * @param {string} id
   * @returns {Node|null}
   */
  function getNodeById(id) {
    return idToNode.get(id) || null;
  }

  /**
   * Look up the serialiser ID for a given DOM node.
   * Returns undefined if the node has not been serialised.
   * @param {Node} node
   * @returns {string|undefined}
   */
  function getIdForNode(node) {
    return nodeToId.get(node);
  }

  return {
    serializeFull,
    syncMutations,
    collectStyles,
    setBaseUrl,
    getSnapshot,
    reset,
    getNodeById,
    getIdForNode,
  };
}

