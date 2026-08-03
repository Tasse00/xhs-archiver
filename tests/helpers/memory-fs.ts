/** FileSystemDirectoryHandle 的最小内存实现，只覆盖 store.ts 用到的 API。 */
class MemFile {
  constructor(public data: Uint8Array) {}
}

export class MemDir {
  entries = new Map<string, MemDir | MemFile>();
  kind = 'directory' as const;

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MemDir> {
    const hit = this.entries.get(name);
    if (hit instanceof MemDir) return hit;
    if (hit) throw new DOMException('is a file', 'TypeMismatchError');
    if (!opts?.create) throw new DOMException('not found', 'NotFoundError');
    const d = new MemDir();
    this.entries.set(name, d);
    return d;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    const hit = this.entries.get(name);
    if (!hit && !opts?.create) throw new DOMException('not found', 'NotFoundError');
    if (hit instanceof MemDir) throw new DOMException('is a dir', 'TypeMismatchError');
    const self = this;
    if (!hit) self.entries.set(name, new MemFile(new Uint8Array()));
    return {
      kind: 'file' as const,
      async getFile() {
        const f = self.entries.get(name) as MemFile;
        return {
          async text() { return new TextDecoder().decode(f.data); },
          size: f.data.byteLength,
        };
      },
      async createWritable() {
        const chunks: Uint8Array[] = [];
        return {
          async write(d: BlobPart) {
            if (typeof d === 'string') chunks.push(new TextEncoder().encode(d));
            else if (d instanceof Uint8Array) chunks.push(d);
            else chunks.push(new Uint8Array(await (d as Blob).arrayBuffer()));
          },
          async close() {
            const total = chunks.reduce((a, c) => a + c.byteLength, 0);
            const merged = new Uint8Array(total);
            let off = 0;
            for (const c of chunks) { merged.set(c, off); off += c.byteLength; }
            self.entries.set(name, new MemFile(merged));
          },
        };
      },
    };
  }

  async removeEntry(name: string, _opts?: { recursive?: boolean }) {
    if (!this.entries.has(name)) throw new DOMException('not found', 'NotFoundError');
    this.entries.delete(name);
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const k of [...this.entries.keys()]) yield k;
  }
}

export function memRoot(): FileSystemDirectoryHandle {
  return new MemDir() as unknown as FileSystemDirectoryHandle;
}
