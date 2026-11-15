import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { inflateRawSync, crc32 } from 'node:zlib';

/*
 * Strict extractor for provider archives (no shell, no third-party code). It refuses anything unusual instead of
 * guessing: encryption, ZIP64, multi-disk archives, unsupported compression, unsafe or duplicate paths, symlinks,
 * oversized or highly compressed entries (zip bombs) and CRC mismatches. Every extracted file is hashed.
 */
const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;
const S_IFMT = 0o170000, S_IFLNK = 0o120000;

export const safeRelPath = path => typeof path === 'string' && path && !path.includes('\\') && !path.includes('\0') && !posix.isAbsolute(path)
  && !/^[A-Za-z]:/.test(path) && posix.normalize(path) === path && !path.split('/').includes('..');

export function listZip(buffer, {maxEntries = 2000, maxBytes = 512 * 1024 * 1024, maxRatio = 200} = {}) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) if (buffer.readUInt32LE(i) === EOCD) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a ZIP archive (no end-of-central-directory record)');
  const disk = buffer.readUInt16LE(eocd + 4), cdDisk = buffer.readUInt16LE(eocd + 6);
  const count = buffer.readUInt16LE(eocd + 10), cdSize = buffer.readUInt32LE(eocd + 12), cdOffset = buffer.readUInt32LE(eocd + 16);
  if (disk !== 0 || cdDisk !== 0) throw new Error('Multi-disk ZIP archives are not supported');
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Error('ZIP64 archives are not supported');
  if (count > maxEntries) throw new Error(`ZIP has ${count} entries, over the ${maxEntries} limit`);
  if (cdOffset + cdSize > eocd) throw new Error('ZIP central directory is out of bounds');

  const entries = [], seen = new Set();
  let p = cdOffset, total = 0;
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(p) !== CENTRAL) throw new Error('Corrupt ZIP central directory');
    const flags = buffer.readUInt16LE(p + 8), method = buffer.readUInt16LE(p + 10), crc = buffer.readUInt32LE(p + 16);
    const compressed = buffer.readUInt32LE(p + 20), size = buffer.readUInt32LE(p + 24);
    const nameLen = buffer.readUInt16LE(p + 28), extraLen = buffer.readUInt16LE(p + 30), commentLen = buffer.readUInt16LE(p + 32);
    const madeBy = buffer.readUInt16LE(p + 4) >> 8, external = buffer.readUInt32LE(p + 38), offset = buffer.readUInt32LE(p + 42);
    const name = buffer.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 0x1) throw new Error(`Encrypted ZIP entry refused: ${name}`);
    if (compressed === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) throw new Error('ZIP64 archives are not supported');
    if (madeBy === 3 && ((external >>> 16) & S_IFMT) === S_IFLNK) throw new Error(`Symbolic link in ZIP refused: ${name}`);
    if (name.endsWith('/')) { if (size) throw new Error(`Directory entry with data: ${name}`); continue; }
    if (!safeRelPath(name)) throw new Error(`Unsafe path in ZIP refused: ${name}`);
    const key = name.toLowerCase(); // Case-insensitive file systems would merge these
    if (seen.has(key)) throw new Error(`Duplicate path in ZIP refused: ${name}`);
    seen.add(key);
    if (method !== 0 && method !== 8) throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
    if (method === 0 && compressed !== size) throw new Error(`Stored ZIP entry has inconsistent sizes: ${name}`);
    if (size > 1024 * 1024 && size / Math.max(1, compressed) > maxRatio) throw new Error(`Compression ratio too high (possible zip bomb): ${name}`);
    total += size;
    if (total > maxBytes) throw new Error(`ZIP expands past the ${maxBytes} byte limit`);
    entries.push({name, method, crc, compressed, size, offset});
  }
  return entries;
}

// Extracts every file of the archive into dest (which should be a fresh, private directory) and returns their hashes
export async function extractZip(archivePath, dest, options = {}) {
  const buffer = await readFile(archivePath);
  const files = [];
  for (const entry of listZip(buffer, options)) {
    const p = entry.offset;
    if (buffer.readUInt32LE(p) !== LOCAL) throw new Error(`Corrupt ZIP local header for ${entry.name}`);
    const start = p + 30 + buffer.readUInt16LE(p + 26) + buffer.readUInt16LE(p + 28);
    if (start + entry.compressed > buffer.length) throw new Error(`ZIP entry out of bounds: ${entry.name}`);
    const raw = buffer.subarray(start, start + entry.compressed);
    const data = entry.method === 0 ? raw : inflateRawSync(raw, {maxOutputLength:Math.max(1, entry.size)});
    if (data.length !== entry.size) throw new Error(`ZIP entry size mismatch: ${entry.name}`);
    if (crc32(data) !== entry.crc) throw new Error(`ZIP entry CRC mismatch: ${entry.name}`);
    const target = join(dest, entry.name);
    await mkdir(dirname(target), {recursive:true});
    await writeFile(target, data, {flag:'wx'});
    files.push({path:entry.name, size:data.length, sha256:createHash('sha256').update(data).digest('hex')});
  }
  return files;
}
