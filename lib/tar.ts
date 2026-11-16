import { gunzipSync } from "node:zlib";

export interface TarEntry {
  path: string;
  size: number;
  data: Buffer;
}

const BLOCK = 512;

function readString(buf: Buffer, start: number, len: number): string {
  const slice = buf.subarray(start, start + len);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? slice.length : nul).toString("utf8");
}

function readOctal(buf: Buffer, start: number, len: number): number {
  const raw = readString(buf, start, len).trim();
  if (!raw) return 0;
  const n = parseInt(raw, 8);
  return Number.isFinite(n) ? n : 0;
}

function parsePax(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  const text = data.toString("utf8");
  while (i < text.length) {
    const space = text.indexOf(" ", i);
    if (space === -1) break;
    const len = parseInt(text.slice(i, space), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = text.slice(space + 1, i + len - 1);
    const eq = record.indexOf("=");
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    i += len;
  }
  return out;
}

/**
 * Minimal, dependency-free tar(.gz) reader. Handles ustar prefixes,
 * GNU long names (L) and PAX extended headers (x). Only regular files are returned.
 */
export function extractTar(input: Buffer, opts: { maxUnpackedBytes: number; maxEntries: number }): TarEntry[] {
  let buf = input;
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    buf = gunzipSync(buf, { maxOutputLength: opts.maxUnpackedBytes });
  }

  const entries: TarEntry[] = [];
  let offset = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;

  while (offset + BLOCK <= buf.length) {
    const header = buf.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break;

    let name = readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const magic = readString(header, 257, 6);
    if (magic.startsWith("ustar")) {
      const prefix = readString(header, 345, 155);
      if (prefix) name = `${prefix}/${name}`;
    }

    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > buf.length) throw new Error("Corrupt or truncated tar archive");
    const data = buf.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "L") {
      longName = readString(data, 0, data.length);
      continue;
    }
    if (type === "x") {
      paxPath = parsePax(data).path ?? null;
      continue;
    }
    if (type === "g") continue;

    const path = paxPath ?? longName ?? name;
    longName = null;
    paxPath = null;

    if (type === "0" || type === "\0" || type === "7") {
      entries.push({ path, size, data });
      if (entries.length > opts.maxEntries) throw new Error(`Archive has more than ${opts.maxEntries} files`);
    }
  }
  return entries;
}
