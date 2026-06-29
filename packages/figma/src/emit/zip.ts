/**
 * Zip — Minimal store-only zip builder for browser environments.
 *
 * Produces a valid ZIP archive (no compression — store method only) from an
 * in-memory file map. Keeps the dependency footprint at zero.
 *
 * @license MIT
 */

import type { FileMap } from "./emit.ts";

// oxlint-disable no-bitwise -- CRC-32 and ZIP binary format require bitwise ops throughout
// oxlint-disable prefer-math-trunc -- `>>> 0` is the idiomatic uint32 coercion in CRC-32

const CRC_POLY = 0xed_b8_83_20;
const CRC_INIT = 0xff_ff_ff_ff;

function crc32(data: Uint8Array): number {
  let crc = CRC_INIT;
  for (const byte of data) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ CRC_POLY : crc >>> 1;
    }
  }
  return (crc ^ CRC_INIT) >>> 0;
}

function writeU16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeU32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

const encoder = new TextEncoder();

interface ZipEntry {
  name: Uint8Array;
  data: Uint8Array;
  crc: number;
  offset: number;
}

// ZIP format magic numbers
const LOCAL_SIG = 0x04_03_4b_50;
const CENTRAL_SIG = 0x02_01_4b_50;
const EOCD_SIG = 0x06_05_4b_50;
const ZIP_VERSION = 20;

export function buildZip(files: FileMap): Uint8Array {
  const entries: ZipEntry[] = [];

  let offset = 0;
  const localHeaders: Uint8Array[] = [];

  for (const [path, content] of Object.entries(files)) {
    const name = encoder.encode(path);
    const data = typeof content === "string" ? encoder.encode(content) : content;
    const crc = crc32(data);

    const headerSize = 30 + name.length;
    const header = new Uint8Array(headerSize);
    const hv = new DataView(header.buffer);

    writeU32(hv, 0, LOCAL_SIG);
    writeU16(hv, 4, ZIP_VERSION);
    writeU32(hv, 14, crc);
    writeU32(hv, 18, data.length);
    writeU32(hv, 22, data.length);
    writeU16(hv, 26, name.length);

    header.set(name, 30);

    entries.push({ name, data, crc, offset });
    localHeaders.push(header);

    offset += headerSize + data.length;
  }

  let centralDirSize = 0;
  const centralHeaders: Uint8Array[] = [];

  for (const entry of entries) {
    const headerSize = 46 + entry.name.length;
    const header = new Uint8Array(headerSize);
    const hv = new DataView(header.buffer);

    writeU32(hv, 0, CENTRAL_SIG);
    writeU16(hv, 4, ZIP_VERSION);
    writeU16(hv, 6, ZIP_VERSION);
    writeU32(hv, 16, entry.crc);
    writeU32(hv, 20, entry.data.length);
    writeU32(hv, 24, entry.data.length);
    writeU16(hv, 28, entry.name.length);
    writeU32(hv, 42, entry.offset);

    header.set(entry.name, 46);

    centralHeaders.push(header);
    centralDirSize += headerSize;
  }

  const eocdSize = 22;
  const eocd = new Uint8Array(eocdSize);
  const ev = new DataView(eocd.buffer);

  writeU32(ev, 0, EOCD_SIG);
  writeU16(ev, 8, entries.length);
  writeU16(ev, 10, entries.length);
  writeU32(ev, 12, centralDirSize);
  writeU32(ev, 16, offset);

  const totalSize =
    localHeaders.reduce((s, h) => s + h.length, 0) +
    entries.reduce((s, e) => s + e.data.length, 0) +
    centralDirSize +
    eocdSize;

  const result = new Uint8Array(totalSize);
  let pos = 0;

  for (let i = 0; i < entries.length; i++) {
    result.set(localHeaders[i], pos);
    pos += localHeaders[i].length;
    result.set(entries[i].data, pos);
    pos += entries[i].data.length;
  }

  for (const h of centralHeaders) {
    result.set(h, pos);
    pos += h.length;
  }

  result.set(eocd, pos);

  return result;
}
