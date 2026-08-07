import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';

let store: Store;
beforeEach(() => { store = createStore(memRoot()); });

describe('listEntries', () => {
  it('区分文件与目录', async () => {
    await store.writeFile('d/a.json', 'x');
    await store.writeFile('d/sub/b.json', 'y');
    const entries = await store.listEntries('d');
    expect([...entries].sort((p, q) => p.name.localeCompare(q.name))).toEqual([
      { name: 'a.json', kind: 'file' },
      { name: 'sub', kind: 'directory' },
    ]);
  });

  it('目录不存在时返回空数组而非抛错', async () => {
    expect(await store.listEntries('missing')).toEqual([]);
  });

  it('列根目录', async () => {
    await store.writeFile('top/x.json', 'x');
    expect(await store.listEntries('')).toEqual([{ name: 'top', kind: 'directory' }]);
  });
});

describe('readFile', () => {
  it('读回二进制内容', async () => {
    await store.writeFile('bin/data.bin', new Uint8Array([1, 2, 3]));
    const f = await store.readFile('bin/data.bin');
    expect(f).not.toBeNull();
    expect(new Uint8Array(await f!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('文件不存在时返回 null', async () => {
    expect(await store.readFile('nope/none.bin')).toBeNull();
  });

  it('路径指向目录时返回 null', async () => {
    await store.writeFile('d/x.json', 'x');
    expect(await store.readFile('d')).toBeNull();
  });
});
