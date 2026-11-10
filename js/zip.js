// ZIP mínimo para exportar e importar: escribe sin comprimir (los JPEG ya vienen comprimidos) y lee archivos
// sin comprimir o con deflate. Trabaja por partes para no cargar todas las fotos juntas en memoria.

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

const u16 = n => [n & 255, (n >>> 8) & 255];
const u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const dosTime = d => ({ time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() });

/** files: [{ name, data: Blob | Uint8Array | string }] → Blob (application/zip) */
export async function zip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  const { time, date } = dosTime(new Date());
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const bytes = typeof f.data === 'string' ? enc.encode(f.data) : f.data instanceof Blob ? new Uint8Array(await f.data.arrayBuffer()) : f.data;
    const crc = crc32(bytes), size = bytes.length;
    const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(date), ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0)];
    const local = new Uint8Array([...u32(0x04034b50), ...common]);
    parts.push(local, name, f.data instanceof Blob ? f.data : bytes);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += local.length + name.length + size;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

async function inflate(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Este ZIP está comprimido y este navegador no puede abrirlo.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** blob → [{ name, read(): Promise<Uint8Array> }] */
export async function unzip(blob) {
  const tailSize = Math.min(blob.size, 66000);
  const tail = new DataView(await blob.slice(blob.size - tailSize).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('El archivo no es un ZIP válido.');
  const count = tail.getUint16(eocd + 10, true), cdSize = tail.getUint32(eocd + 12, true), cdOffset = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const dec = new TextDecoder(), out = [];
  for (let p = 0, i = 0; i < count && p + 46 <= cd.byteLength; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) break;
    const method = cd.getUint16(p + 10, true), csize = cd.getUint32(p + 20, true);
    const nameLen = cd.getUint16(p + 28, true), extraLen = cd.getUint16(p + 30, true), commentLen = cd.getUint16(p + 32, true), local = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));
    if (!name.endsWith('/')) out.push({
      name,
      async read() {
        const head = new DataView(await blob.slice(local, local + 30).arrayBuffer());
        const start = local + 30 + head.getUint16(26, true) + head.getUint16(28, true);
        const bytes = new Uint8Array(await blob.slice(start, start + csize).arrayBuffer());
        if (method === 0) return bytes;
        if (method === 8) return inflate(bytes);
        throw new Error('Formato de compresión no soportado.');
      },
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
