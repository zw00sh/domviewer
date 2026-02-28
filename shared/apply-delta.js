/**
 * Shared delta application logic for the domviewer.
 * Used by both the server (Node.js) and web frontend (browser/Vite).
 *
 * Message types:
 *   { type: "snapshot", nodes: { [id]: NodeData }, meta: { rootId, baseUrl?, styles? } }
 *   { type: "delta", ops: DeltaOp[] }
 *   { type: "meta", meta: { baseUrl?, styles? } }
 *
 * Delta ops:
 *   { op: "add", nodes: { [id]: NodeData } }
 *   { op: "remove", id: string }
 *   { op: "children", id: string, children: string[] }
 *   { op: "attrs", id: string, set: object, del: string[] }
 *   { op: "text", id: string, text: string }
 */

/**
 * Recursively remove a node and all its descendants from the nodes map.
 * @param {Map<string, object>} nodes
 * @param {string} id
 */
function deleteSubtree(nodes, id) {
  const node = nodes.get(id);
  if (!node) return;
  if (node.type === 1 && node.children) {
    for (const childId of node.children) {
      deleteSubtree(nodes, childId);
    }
  }
  nodes.delete(id);
}

/**
 * Apply a single delta operation to the nodes map.
 * @param {Map<string, object>} nodes
 * @param {object} op
 */
function applyOp(nodes, op) {
  switch (op.op) {
    case "add":
      for (const [id, node] of Object.entries(op.nodes)) {
        nodes.set(id, node);
      }
      break;

    case "remove":
      deleteSubtree(nodes, op.id);
      break;

    case "children": {
      const node = nodes.get(op.id);
      if (node && node.type === 1) {
        node.children = op.children;
      }
      break;
    }

    case "attrs": {
      const node = nodes.get(op.id);
      if (node && node.type === 1) {
        if (!node.attrs) node.attrs = {};
        if (op.set) {
          for (const [k, v] of Object.entries(op.set)) {
            node.attrs[k] = v;
          }
        }
        if (op.del) {
          for (const name of op.del) {
            delete node.attrs[name];
          }
        }
      }
      break;
    }

    case "text": {
      const node = nodes.get(op.id);
      if (node && node.type === 3) {
        node.text = op.text;
      }
      break;
    }
  }
}

/**
 * Apply a decoded message to the nodes map and meta object.
 * Mutates both in place.
 * @param {Map<string, object>} nodes
 * @param {object} meta - Plain object (mutated in place via Object.assign)
 * @param {object} msg - Decoded message ({ type: "snapshot"|"delta"|"meta", ... })
 */
export function applyMessage(nodes, meta, msg) {
  switch (msg.type) {
    case "snapshot":
      nodes.clear();
      for (const [id, node] of Object.entries(msg.nodes)) {
        nodes.set(id, node);
      }
      // Replace all meta keys
      for (const key of Object.keys(meta)) delete meta[key];
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
