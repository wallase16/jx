import { describe, test, expect } from "bun:test";
import { buildZip } from "../src/emit/zip.ts";
import type { FileMap } from "../src/emit/emit.ts";

function readU32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset).getUint32(offset, true);
}

function readU16(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset).getUint16(offset, true);
}

describe("buildZip", () => {
  test("produces a valid zip with local + central + EOCD signatures", () => {
    const files: FileMap = { "hello.txt": "world" };
    const zip = buildZip(files);

    expect(readU32(zip, 0)).toBe(0x04_03_4b_50);

    const eocdOffset = zip.length - 22;
    expect(readU32(zip, eocdOffset)).toBe(0x06_05_4b_50);
    expect(readU16(zip, eocdOffset + 8)).toBe(1);
  });

  test("handles multiple files", () => {
    const files: FileMap = {
      "a.json": '{"key":"value"}',
      "b.txt": "hello",
      "c/nested.txt": "nested content",
    };
    const zip = buildZip(files);

    const eocdOffset = zip.length - 22;
    expect(readU16(zip, eocdOffset + 8)).toBe(3);
    expect(readU16(zip, eocdOffset + 10)).toBe(3);
  });

  test("stores binary data (Uint8Array values) correctly", () => {
    const binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const files: FileMap = { "image.png": binary };
    const zip = buildZip(files);

    const nameLen = readU16(zip, 26);
    const dataOffset = 30 + nameLen;
    const stored = zip.slice(dataOffset, dataOffset + binary.length);
    expect(stored).toEqual(binary);
  });

  test("central directory offset matches the end of local entries", () => {
    const files: FileMap = {
      "project.json": '{"name":"Test"}',
      "pages/index.json": '{"tagName":"div"}',
    };
    const zip = buildZip(files);

    const eocdOffset = zip.length - 22;
    const centralDirOffset = readU32(zip, eocdOffset + 16);
    expect(readU32(zip, centralDirOffset)).toBe(0x02_01_4b_50);
  });

  test("handles empty file map", () => {
    const zip = buildZip({});

    expect(readU32(zip, 0)).toBe(0x06_05_4b_50);
    expect(readU16(zip, 8)).toBe(0);
    expect(zip.length).toBe(22);
  });
});
