/**
 * Tests for client/serialize.js — syncMutations() move handling.
 *
 * Fake DOM node objects (plain JS objects) are used instead of a real browser
 * DOM so the tests run in Node.js under Vitest without a DOM environment.
 * WeakMap works with any object, so nodeToId accepts these fakes correctly.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createSerializer } from "../../client/serialize.js";

// ---------------------------------------------------------------------------
// Fake DOM helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal fake element node.
 * @param {string} tag
 * @param {Node[]} [childNodes]
 * @param {Record<string, string>} [attrsObj]
 */
function makeElement(tag, childNodes = [], attrsObj = {}) {
  const attributesList = Object.entries(attrsObj).map(([name, value]) => ({ name, value }));
  return {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes,
    attributes: attributesList,
    getAttribute(name) { return attrsObj[name] ?? null; },
  };
}

/**
 * Create a minimal fake text node.
 * @param {string} text
 */
function makeText(text) {
  return { nodeType: 3, textContent: text };
}

/**
 * Create a fake MutationRecord.
 * @param {"childList"|"attributes"|"characterData"} type
 * @param {object} target
 * @param {object} [opts]
 */
function makeMutation(type, target, { removedNodes = [], addedNodes = [], attributeName = null } = {}) {
  return { type, target, removedNodes, addedNodes, attributeName };
}

// ---------------------------------------------------------------------------
// Setup: fresh serializer instance before every test
// ---------------------------------------------------------------------------

/** @type {ReturnType<typeof createSerializer>} */
let s;

beforeEach(() => {
  s = createSerializer();
});

// ---------------------------------------------------------------------------
// Helpers for inspecting results
// ---------------------------------------------------------------------------

function opsOfType(result, opType) {
  if (!result) return [];
  return result.ops.filter((op) => op.op === opType);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("syncMutations", () => {
  describe("move within same parent", () => {
    it("emits only a children op when a node is reordered within its parent (single MutationRecord)", () => {
      const liA = makeElement("li");
      const liB = makeElement("li");
      const ul = makeElement("ul", [liA, liB]);

      s.serializeFull(ul);

      // Simulate DOM after sort: [liB, liA]
      ul.childNodes = [liB, liA];

      // Browser emits ONE record with the moved node in both removedNodes and addedNodes
      const result = s.syncMutations([
        makeMutation("childList", ul, { removedNodes: [liA], addedNodes: [liA] }),
      ]);

      expect(result).not.toBeNull();
      expect(opsOfType(result, "remove")).toHaveLength(0);
      expect(opsOfType(result, "add")).toHaveLength(0);
      expect(opsOfType(result, "children")).toHaveLength(1);
    });

    it("emits only a children op when a node is reordered (two separate MutationRecords)", () => {
      const liA = makeElement("li");
      const liB = makeElement("li");
      const ul = makeElement("ul", [liA, liB]);

      s.serializeFull(ul);

      ul.childNodes = [liB, liA];

      // Some environments may fire two records instead of one
      const result = s.syncMutations([
        makeMutation("childList", ul, { removedNodes: [liA], addedNodes: [] }),
        makeMutation("childList", ul, { removedNodes: [], addedNodes: [liA] }),
      ]);

      expect(result).not.toBeNull();
      expect(opsOfType(result, "remove")).toHaveLength(0);
      expect(opsOfType(result, "add")).toHaveLength(0);
      expect(opsOfType(result, "children")).toHaveLength(1);
    });

    it("children op reflects the new DOM order after a sort", () => {
      const liA = makeElement("li");
      const liB = makeElement("li");
      const liC = makeElement("li");
      const ul = makeElement("ul", [liA, liB, liC]);

      const snapshot = s.serializeFull(ul);
      // Find IDs from the snapshot
      const rootNode = snapshot.nodes[snapshot.meta.rootId];
      const [idA, idB, idC] = rootNode.children;

      // Sort: [liC, liA, liB]
      ul.childNodes = [liC, liA, liB];

      const result = s.syncMutations([
        makeMutation("childList", ul, { removedNodes: [liA, liB, liC], addedNodes: [liC, liA, liB] }),
      ]);

      const childrenOp = opsOfType(result, "children")[0];
      expect(childrenOp.children).toEqual([idC, idA, idB]);
    });
  });

  describe("move across parents", () => {
    it("emits two children ops and no remove/add for a cross-parent move", () => {
      const li = makeElement("li");
      const ulA = makeElement("ul", [li]);
      const ulB = makeElement("ul", []);
      const wrapper = makeElement("div", [ulA, ulB]);

      s.serializeFull(wrapper);

      // Simulate move: li from ulA → ulB
      ulA.childNodes = [];
      ulB.childNodes = [li];

      const result = s.syncMutations([
        makeMutation("childList", ulA, { removedNodes: [li], addedNodes: [] }),
        makeMutation("childList", ulB, { removedNodes: [], addedNodes: [li] }),
      ]);

      expect(result).not.toBeNull();
      expect(opsOfType(result, "remove")).toHaveLength(0);
      expect(opsOfType(result, "add")).toHaveLength(0);
      expect(opsOfType(result, "children")).toHaveLength(2);
    });

    it("moved node's ID appears in the new parent's children op", () => {
      const li = makeElement("li");
      const ulA = makeElement("ul", [li]);
      const ulB = makeElement("ul", []);
      const wrapper = makeElement("div", [ulA, ulB]);

      const snapshot = s.serializeFull(wrapper);
      // Find ulA and ulB IDs, then find li's ID
      const rootNode = snapshot.nodes[snapshot.meta.rootId];
      const [ulAId, ulBId] = rootNode.children;
      const liId = snapshot.nodes[ulAId].children[0];

      ulA.childNodes = [];
      ulB.childNodes = [li];

      const result = s.syncMutations([
        makeMutation("childList", ulA, { removedNodes: [li], addedNodes: [] }),
        makeMutation("childList", ulB, { removedNodes: [], addedNodes: [li] }),
      ]);

      const ulAChildrenOp = opsOfType(result, "children").find((op) => op.id === ulAId);
      const ulBChildrenOp = opsOfType(result, "children").find((op) => op.id === ulBId);

      expect(ulAChildrenOp.children).toEqual([]);          // li removed from A
      expect(ulBChildrenOp.children).toEqual([liId]);      // li present in B with same ID
    });
  });

  describe("stale nodeToId after deleteSubtree", () => {
    it("re-serializes a node when it was deleted and then re-added", () => {
      const li = makeElement("li", [makeText("item")]);
      const ul = makeElement("ul", [li]);

      s.serializeFull(ul);

      // Step 1: Remove li — deleteSubtree removes it from nodes, WeakMap entry stays stale
      ul.childNodes = [];
      const removeResult = s.syncMutations([
        makeMutation("childList", ul, { removedNodes: [li], addedNodes: [] }),
      ]);
      expect(opsOfType(removeResult, "remove")).toHaveLength(1);

      // Step 2: Re-add li — must detect stale entry and re-serialize
      ul.childNodes = [li];
      const addResult = s.syncMutations([
        makeMutation("childList", ul, { removedNodes: [], addedNodes: [li] }),
      ]);

      expect(addResult).not.toBeNull();
      expect(opsOfType(addResult, "add")).toHaveLength(1);
      expect(opsOfType(addResult, "children")).toHaveLength(1);

      // The add op must contain node data
      const addOp = opsOfType(addResult, "add")[0];
      expect(Object.keys(addOp.nodes).length).toBeGreaterThan(0);
    });
  });

  describe("parent deduplication", () => {
    it("emits only one children op for a parent with multiple childList mutations", () => {
      const liA = makeElement("li");
      const liB = makeElement("li");
      const ul = makeElement("ul", [liA, liB]);

      s.serializeFull(ul);

      ul.childNodes = [liB, liA];

      // Two separate mutations on the same parent (no single-record move)
      const result = s.syncMutations([
        makeMutation("childList", ul, { removedNodes: [liA], addedNodes: [] }),
        makeMutation("childList", ul, { removedNodes: [], addedNodes: [liA] }),
      ]);

      expect(opsOfType(result, "children")).toHaveLength(1);
    });

    it("handles three mutations on the same parent correctly", () => {
      const liA = makeElement("li");
      const liB = makeElement("li");
      const liC = makeElement("li");
      const ul = makeElement("ul", [liA, liB, liC]);

      s.serializeFull(ul);

      ul.childNodes = [liC, liB, liA];

      const result = s.syncMutations([
        makeMutation("childList", ul, { removedNodes: [liA], addedNodes: [liA] }),
        makeMutation("childList", ul, { removedNodes: [liB], addedNodes: [liB] }),
        makeMutation("childList", ul, { removedNodes: [liC], addedNodes: [liC] }),
      ]);

      expect(opsOfType(result, "remove")).toHaveLength(0);
      expect(opsOfType(result, "add")).toHaveLength(0);
      expect(opsOfType(result, "children")).toHaveLength(1);
    });
  });

  describe("rebuildChildren emits add ops for untracked children", () => {
    it("emits an add op when rebuildChildren encounters a child not in the nodes map", () => {
      const ul = makeElement("ul", []);
      s.serializeFull(ul);

      // A brand new li — never serialised, not in nodeToId
      const newLi = makeElement("li", [makeText("new")]);
      ul.childNodes = [newLi];

      const result = s.syncMutations([
        makeMutation("childList", ul, { removedNodes: [], addedNodes: [newLi] }),
      ]);

      expect(result).not.toBeNull();
      expect(opsOfType(result, "add")).toHaveLength(1);
      expect(opsOfType(result, "children")).toHaveLength(1);

      // The add op must include the new li's data
      const addOp = opsOfType(result, "add")[0];
      const nodeData = Object.values(addOp.nodes);
      expect(nodeData.some((n) => n.tag === "li")).toBe(true);
    });

    it("add op comes before the children op that references the new node", () => {
      const ul = makeElement("ul", []);
      s.serializeFull(ul);

      const newLi = makeElement("li");
      ul.childNodes = [newLi];

      const result = s.syncMutations([
        makeMutation("childList", ul, { removedNodes: [], addedNodes: [newLi] }),
      ]);

      const addIdx = result.ops.findIndex((op) => op.op === "add");
      const childrenIdx = result.ops.findIndex((op) => op.op === "children");

      // add must precede children so the viewer has node data before applying the reference
      expect(addIdx).toBeLessThan(childrenIdx);
    });
  });

  describe("unrelated mutation types", () => {
    it("emits an attrs op for an attribute change on a tracked node", () => {
      const div = makeElement("div", [], { class: "foo" });
      s.serializeFull(div);

      // Update the fake node's getAttribute to return new value
      div.attributes = [{ name: "class", value: "bar" }];
      div.getAttribute = (name) => (name === "class" ? "bar" : null);

      const result = s.syncMutations([
        makeMutation("attributes", div, { attributeName: "class" }),
      ]);

      expect(result).not.toBeNull();
      const attrsOp = opsOfType(result, "attrs")[0];
      expect(attrsOp).toBeDefined();
      expect(attrsOp.set).toEqual({ class: "bar" });
    });

    it("emits a text op for a characterData mutation", () => {
      const text = makeText("hello");
      const p = makeElement("p", [text]);
      s.serializeFull(p);

      text.textContent = "world";

      const result = s.syncMutations([
        { type: "characterData", target: text, removedNodes: [], addedNodes: [], attributeName: null },
      ]);

      expect(result).not.toBeNull();
      const textOp = opsOfType(result, "text")[0];
      expect(textOp).toBeDefined();
      expect(textOp.text).toBe("world");
    });
  });
});
