import { describe, it, expect } from "vitest";
import { renderToHtml } from "../shared/render.js";
import { reEscapeNonAsciiCss } from "../client/serialize.js";

/**
 * Helper to create a test node map and meta object with plain JS.
 * @param {Function} setup - Receives (nodes: Map, meta: object)
 */
function buildDoc(setup) {
  const nodes = new Map();
  const meta = {};
  setup(nodes, meta);
  return { nodes, meta };
}

function addElement(nodes, id, tag, attrs = {}, childIds = []) {
  nodes.set(id, { type: 1, tag, attrs, children: childIds });
}

function addText(nodes, id, text) {
  nodes.set(id, { type: 3, text });
}

describe("renderToHtml", () => {
  it("returns placeholder when rootId is null", () => {
    const { nodes, meta } = buildDoc(() => {});
    const html = renderToHtml(nodes, null, meta);
    expect(html).toContain("No DOM captured yet.");
  });

  it("returns placeholder when rootId node does not exist", () => {
    const { nodes, meta } = buildDoc(() => {});
    const html = renderToHtml(nodes, "nonexistent", meta);
    expect(html).toContain("No DOM captured yet.");
  });

  it("renders a single element", () => {
    const { nodes, meta } = buildDoc((nodes) => {
      addElement(nodes, "r", "div");
    });
    const html = renderToHtml(nodes, "r", meta);
    expect(html).toBe("<!DOCTYPE html><div></div>");
  });

  it("renders nested tree", () => {
    const { nodes, meta } = buildDoc((nodes) => {
      addElement(nodes, "r", "div", {}, ["c1"]);
      addElement(nodes, "c1", "span", {}, ["t1"]);
      addText(nodes, "t1", "hello");
    });
    const html = renderToHtml(nodes, "r", meta);
    expect(html).toBe("<!DOCTYPE html><div><span>hello</span></div>");
  });

  it("renders text nodes", () => {
    const { nodes, meta } = buildDoc((nodes) => {
      addElement(nodes, "r", "p", {}, ["t1"]);
      addText(nodes, "t1", "some text");
    });
    const html = renderToHtml(nodes, "r", meta);
    expect(html).toContain("some text");
  });

  it("serializes attributes", () => {
    const { nodes, meta } = buildDoc((nodes) => {
      addElement(nodes, "r", "a", { href: "/page", class: "link" });
    });
    const html = renderToHtml(nodes, "r", meta);
    expect(html).toContain('href="/page"');
    expect(html).toContain('class="link"');
  });

  it("renders void elements without closing tag", () => {
    const { nodes, meta } = buildDoc((nodes) => {
      addElement(nodes, "r", "div", {}, ["c1"]);
      addElement(nodes, "c1", "br");
    });
    const html = renderToHtml(nodes, "r", meta);
    expect(html).toContain("<br>");
    expect(html).not.toContain("</br>");
  });

  it("escapes HTML in text", () => {
    const { nodes, meta } = buildDoc((nodes) => {
      addElement(nodes, "r", "p", {}, ["t1"]);
      addText(nodes, "t1", '<script>alert("xss")</script>');
    });
    const html = renderToHtml(nodes, "r", meta);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("escapes HTML in attributes", () => {
    const { nodes, meta } = buildDoc((nodes) => {
      addElement(nodes, "r", "div", { title: 'a"b<c' });
    });
    const html = renderToHtml(nodes, "r", meta);
    expect(html).toContain('title="a&quot;b&lt;c"');
  });

  it("strips stylesheet links", () => {
    const { nodes, meta } = buildDoc((nodes) => {
      addElement(nodes, "r", "div", {}, ["c1"]);
      addElement(nodes, "c1", "link", { rel: "stylesheet", href: "/style.css" });
    });
    const html = renderToHtml(nodes, "r", meta);
    expect(html).not.toContain("stylesheet");
    expect(html).not.toContain("style.css");
  });

  it("injects base URL and styles in head", () => {
    const { nodes, meta } = buildDoc((nodes, meta) => {
      addElement(nodes, "r", "html", {}, ["h"]);
      addElement(nodes, "h", "head");
      meta.baseUrl = "https://example.com/";
      meta.styles = "body { color: red; }";
    });
    const html = renderToHtml(nodes, "r", meta);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<base href="https://example.com/"');
    expect(html).toContain("<style>body { color: red; }</style>");
  });

  it("injects charset in head even without baseUrl or styles", () => {
    const { nodes, meta } = buildDoc((nodes) => {
      addElement(nodes, "r", "html", {}, ["h"]);
      addElement(nodes, "h", "head");
    });
    const html = renderToHtml(nodes, "r", meta);
    expect(html).toContain('<meta charset="utf-8">');
  });

  it("injects charset before base tag", () => {
    const { nodes, meta } = buildDoc((nodes, meta) => {
      addElement(nodes, "r", "html", {}, ["h"]);
      addElement(nodes, "h", "head");
      meta.baseUrl = "https://example.com/";
    });
    const html = renderToHtml(nodes, "r", meta);
    const charsetPos = html.indexOf('<meta charset="utf-8">');
    const basePos = html.indexOf("<base ");
    expect(charsetPos).toBeGreaterThanOrEqual(0);
    expect(basePos).toBeGreaterThanOrEqual(0);
    expect(charsetPos).toBeLessThan(basePos);
  });

  it("does not escape CSS content in inline style elements", () => {
    const { nodes, meta } = buildDoc((nodes) => {
      addElement(nodes, "r", "html", {}, ["h"]);
      addElement(nodes, "h", "head", {}, ["s"]);
      addElement(nodes, "s", "style", {}, ["t"]);
      addText(nodes, "t", "div > span { color: red; }");
    });
    const html = renderToHtml(nodes, "r", meta);
    expect(html).toContain("div > span { color: red; }");
    expect(html).not.toContain("&gt;");
  });

  it("preserves unicode CSS content in inline style text nodes", () => {
    const unicodeChar = "\uF1CD"; // U+F1CD as resolved by browser CSSOM
    const { nodes, meta } = buildDoc((nodes) => {
      addElement(nodes, "r", "html", {}, ["h"]);
      addElement(nodes, "h", "head", {}, ["s"]);
      addElement(nodes, "s", "style", {}, ["t"]);
      addText(nodes, "t", `.icon::before { content: "${unicodeChar}"; }`);
    });
    const html = renderToHtml(nodes, "r", meta);
    expect(html).toContain(unicodeChar);
  });

  it("renders re-escaped meta.styles as valid CSS escape sequences", () => {
    const cssWithEscapes = reEscapeNonAsciiCss('.fa::before { content: "\uF075"; }');
    const { nodes, meta } = buildDoc((nodes, meta) => {
      addElement(nodes, "r", "html", {}, ["h"]);
      addElement(nodes, "h", "head");
      meta.styles = cssWithEscapes;
    });
    const html = renderToHtml(nodes, "r", meta);
    expect(html).toContain("\\f075 ");
    expect(html).not.toContain("\uF075");
  });
});

describe("reEscapeNonAsciiCss", () => {
  it("converts non-ASCII characters to CSS hex escape sequences", () => {
    const result = reEscapeNonAsciiCss('.fa::before { content: "\uF075"; }');
    expect(result).toBe('.fa::before { content: "\\f075 "; }');
  });

  it("leaves ASCII-only CSS unchanged", () => {
    const css = "body { color: red; }";
    expect(reEscapeNonAsciiCss(css)).toBe(css);
  });

  it("escapes multiple non-ASCII characters", () => {
    const result = reEscapeNonAsciiCss('\uF075\uF1CD');
    expect(result).toBe("\\f075 \\f1cd ");
  });

  it("preserves CSS structure around escaped characters", () => {
    const result = reEscapeNonAsciiCss('.a::before{content:"\uF075"}.b::after{content:"\uF1CD"}');
    expect(result).toContain("\\f075 ");
    expect(result).toContain("\\f1cd ");
    expect(result).toContain(".a::before");
    expect(result).toContain(".b::after");
  });
});
