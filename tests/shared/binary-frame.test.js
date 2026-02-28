import { describe, it, expect } from "vitest";
import {
  encodeBinaryFrame,
  decodeBinaryFrame,
} from "../../shared/binary-frame.js";

describe("binary-frame", () => {
  describe("encodeBinaryFrame", () => {
    it("produces correct frame structure", () => {
      const name = "domviewer";
      const data = new Uint8Array([1, 2, 3, 4]);
      const frame = encodeBinaryFrame(name, data);

      const nameBytes = new TextEncoder().encode(name);
      expect(frame[0]).toBe(nameBytes.length);
      expect(frame.slice(1, 1 + nameBytes.length)).toEqual(nameBytes);
      expect(frame.slice(1 + nameBytes.length)).toEqual(data);
    });

    it("handles empty data", () => {
      const frame = encodeBinaryFrame("x", new Uint8Array(0));
      expect(frame.length).toBe(2); // 1 (nameLen) + 1 (name byte)
      expect(frame[0]).toBe(1);
    });

    it("handles multi-byte UTF-8 names", () => {
      // '→' encodes to 3 bytes in UTF-8
      const name = "→";
      const data = new Uint8Array([99]);
      const frame = encodeBinaryFrame(name, data);
      const nameBytes = new TextEncoder().encode(name);
      expect(frame[0]).toBe(nameBytes.length);
    });

    it("throws when name encodes to more than 255 bytes", () => {
      // A 256-character ASCII name encodes to 256 bytes, exceeding the 1-byte length field
      const longName = "a".repeat(256);
      expect(() => encodeBinaryFrame(longName, new Uint8Array(0))).toThrow(/255/);
    });
  });

  describe("decodeBinaryFrame", () => {
    it("round-trips with encodeBinaryFrame", () => {
      const name = "spider";
      const data = new Uint8Array([10, 20, 30]);
      const frame = encodeBinaryFrame(name, data);
      const result = decodeBinaryFrame(frame);

      expect(result).not.toBeNull();
      expect(result.name).toBe(name);
      expect(result.data).toEqual(data);
    });

    it("returns null for a too-short buffer (< 2 bytes)", () => {
      expect(decodeBinaryFrame(new Uint8Array(0))).toBeNull();
      expect(decodeBinaryFrame(new Uint8Array(1))).toBeNull();
    });

    it("returns null when the buffer is shorter than the declared name length", () => {
      // nameLen = 10 but only 3 bytes total
      const buf = new Uint8Array([10, 65, 66]);
      expect(decodeBinaryFrame(buf)).toBeNull();
    });

    it("accepts an ArrayBuffer", () => {
      const frame = encodeBinaryFrame("test", new Uint8Array([1]));
      const result = decodeBinaryFrame(frame.buffer);
      expect(result).not.toBeNull();
      expect(result.name).toBe("test");
    });

    it("handles empty data payload", () => {
      const frame = encodeBinaryFrame("domviewer", new Uint8Array(0));
      const result = decodeBinaryFrame(frame);
      expect(result).not.toBeNull();
      expect(result.name).toBe("domviewer");
      expect(result.data.length).toBe(0);
    });
  });
});
