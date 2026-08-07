/** FileSystemDirectoryHandle 的最小内存实现，只覆盖 store.ts 用到的 API。 */
class MemFile {
  kind = 'file' as const;
  constructor(public data: Uint8Array) {}
}

export class MemDir {
  /**
   * 名字不能叫 entries：真实 FSA 的 entries() 是个异步迭代器方法，
   * listEntries 要靠它拿 kind，字段与方法会撞名。
   */
  children = new Map<string, MemDir | MemFile>();
  kind = 'directory' as const;

  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<MemDir> {
    const hit = this.children.get(name);
    if (hit instanceof MemDir) return hit;
    if (hit) throw new DOMException('is a file', 'TypeMismatchError');
    if (!opts?.create) throw new DOMException('not found', 'NotFoundError');
    const d = new MemDir();
    this.children.set(name, d);
    return d;
  }

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    const hit = this.children.get(name);
    if (!hit && !opts?.create) throw new DOMException('not found', 'NotFoundError');
    if (hit instanceof MemDir) throw new DOMException('is a dir', 'TypeMismatchError');
    const self = this;
    if (!hit) self.children.set(name, new MemFile(new Uint8Array()));
    return {
      kind: 'file' as const,
      // 返回真实 File：store.readFile 直接把它交给调用方，
      // 自造的鸭子对象在类型和行为上都对不上。
      async getFile() {
        const f = self.children.get(name) as MemFile;
        const file = new File([f.data as BlobPart], name);
        // jsdom 的 File 没实现 text()/arrayBuffer()（Node 环境下有）。
        // 字节本来就在手上，用已知内容直接补，不必依赖平台的 Blob 读取能力。
        if (typeof file.text !== 'function') {
          (file as unknown as { text(): Promise<string> }).text =
            async () => new TextDecoder().decode(f.data);
        }
        if (typeof file.arrayBuffer !== 'function') {
          (file as unknown as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer =
            async () => f.data.slice().buffer;
        }
        return file;
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
            self.children.set(name, new MemFile(merged));
          },
        };
      },
    };
  }

  async removeEntry(name: string, _opts?: { recursive?: boolean }) {
    if (!this.children.has(name)) throw new DOMException('not found', 'NotFoundError');
    this.children.delete(name);
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const k of [...this.children.keys()]) yield k;
  }

  async *entries(): AsyncIterableIterator<[string, { kind: 'file' | 'directory' }]> {
    for (const [k, v] of [...this.children.entries()]) yield [k, { kind: v.kind }];
  }
}

export function memRoot(): FileSystemDirectoryHandle {
  return new MemDir() as unknown as FileSystemDirectoryHandle;
}

/**
 * 目录被使用者从磁盘上删掉（或移走、改名）之后的句柄。
 *
 * 这不是假想：句柄仍在 IndexedDB 里，权限也仍是 granted，FSA 不会因为目录
 * 消失就让句柄失效——只在真正读写时抛 NotFoundError。
 */
export function deletedRoot(name = 'repo'): FileSystemDirectoryHandle {
  const gone = (): never => {
    throw new DOMException('not found', 'NotFoundError');
  };
  return {
    kind: 'directory',
    name,
    getDirectoryHandle: async () => gone(),
    getFileHandle: async () => gone(),
    removeEntry: async () => gone(),
    async *keys(): AsyncIterableIterator<string> {
      gone();
    },
    async *entries(): AsyncIterableIterator<[string, { kind: 'file' | 'directory' }]> {
      gone();
    },
  } as unknown as FileSystemDirectoryHandle;
}
