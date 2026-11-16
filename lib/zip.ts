import { inflateRawSync } from "node:zlib";
import type { TarEntry } from "./tar";

/** Minimal zip reader (wheels, .zip). Supports stored + deflate entries; no zip64. */
export function extractZip(buf: Buffer, opts: { maxUnpackedBytes: number; maxEntries: number }): TarEntry[] {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("Not a valid zip archive");
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || ptr === 0xffffffff) throw new Error("zip64 archives are not supported");
  if (count > opts.maxEntries) throw new Error(`Archive has more than ${opts.maxEntries} files`);

  const entries: TarEntry[] = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error("Corrupt zip central directory");
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const size = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const path = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    ptr += 46 + nameLen + extraLen + commentLen;
    if (path.endsWith("/")) continue;

    total += size;
    if (total > opts.maxUnpackedBytes) throw new Error("Archive too large when unpacked");
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    let data: Buffer;
    if (method === 0) data = raw;
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
    else continue; // unsupported compression: skip content but keep going
    entries.push({ path, size, data });
  }
  return entries;
}
