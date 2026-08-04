import type { DirEntry, ReadStore } from './read-store';

export interface Store extends ReadStore {
  writeFile(path: string, data: BlobPart): Promise<void>;
  listDir(path: string): Promise<string[]>;
  removeDir(path: string): Promise<void>;
  removeFile(path: string): Promise<void>;
}

function segments(path: string): string[] {
  return path.split('/').filter((s) => s !== '');
}

function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');
}

export function createStore(root: FileSystemDirectoryHandle): Store {
  async function dirOf(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle | null> {
    let cur = root;
    for (const p of parts) {
      try {
        cur = await cur.getDirectoryHandle(p, { create });
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    }
    return cur;
  }

  return {
    async writeFile(path, data) {
      const parts = segments(path);
      const name = parts.pop()!;
      const dir = await dirOf(parts, true);
      if (!dir) throw new Error(`无法创建目录：${path}`);
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(data);
      await w.close();
    },

    async readText(path) {
      const parts = segments(path);
      const name = parts.pop()!;
      const dir = await dirOf(parts, false);
      if (!dir) return null;
      try {
        const fh = await dir.getFileHandle(name);
        return await (await fh.getFile()).text();
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },

    async readFile(path) {
      const parts = segments(path);
      const name = parts.pop()!;
      const dir = await dirOf(parts, false);
      if (!dir) return null;
      try {
        const fh = await dir.getFileHandle(name);
        return await fh.getFile();
      } catch (e) {
        if (isNotFound(e)) return null;
        throw e;
      }
    },

    async listEntries(path) {
      const dir = await dirOf(segments(path), false);
      if (!dir) return [];
      const out: DirEntry[] = [];
      for await (const [name, h] of dir.entries()) out.push({ name, kind: h.kind });
      return out;
    },

    async exists(path) {
      const parts = segments(path);
      const name = parts.pop()!;
      const dir = await dirOf(parts, false);
      if (!dir) return false;
      try {
        await dir.getFileHandle(name);
        return true;
      } catch (e) {
        if (isNotFound(e)) {
          try {
            await dir.getDirectoryHandle(name);
            return true;
          } catch {
            return false;
          }
        }
        throw e;
      }
    },

    async listDir(path) {
      const dir = await dirOf(segments(path), false);
      if (!dir) return [];
      const out: string[] = [];
      for await (const k of dir.keys()) out.push(k);
      return out;
    },

    async removeDir(path) {
      const parts = segments(path);
      const name = parts.pop();
      if (!name) return;
      const dir = await dirOf(parts, false);
      if (!dir) return;
      try {
        await dir.removeEntry(name, { recursive: true });
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
    },

    async removeFile(path) {
      const parts = segments(path);
      const name = parts.pop();
      if (!name) return;
      const dir = await dirOf(parts, false);
      if (!dir) return;
      try {
        await dir.removeEntry(name);
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
    },
  };
}
