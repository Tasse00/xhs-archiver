import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';

let store: Store;
beforeEach(() => { store = createStore(memRoot()); });

describe('Store', () => {
  it('写入并读回嵌套路径', async () => {
    await store.writeFile('a/b/c.json', '{"x":1}\n');
    expect(await store.readText('a/b/c.json')).toBe('{"x":1}\n');
  });

  it('读不存在的文件返回 null 而非抛错', async () => {
    expect(await store.readText('nope/none.json')).toBeNull();
  });

  it('exists 正确判断', async () => {
    await store.writeFile('x/y.txt', 'hi');
    expect(await store.exists('x/y.txt')).toBe(true);
    expect(await store.exists('x/z.txt')).toBe(false);
  });

  it('listDir 列出条目，目录不存在时返回空数组', async () => {
    await store.writeFile('d/1.json', 'a');
    await store.writeFile('d/2.json', 'b');
    expect((await store.listDir('d')).sort()).toEqual(['1.json', '2.json']);
    expect(await store.listDir('missing')).toEqual([]);
  });

  it('removeDir 递归删除', async () => {
    await store.writeFile('p/q/r.json', 'x');
    await store.removeDir('p/q');
    expect(await store.exists('p/q/r.json')).toBe(false);
  });

  it('removeDir 删不存在的目录不抛错', async () => {
    await expect(store.removeDir('never/existed')).resolves.toBeUndefined();
  });

  it('removeFile 删除单个文件', async () => {
    await store.writeFile('f/g.json', 'x');
    await store.removeFile('f/g.json');
    expect(await store.exists('f/g.json')).toBe(false);
  });

  it('写入 Blob 数据', async () => {
    await store.writeFile('bin/data.bin', new Uint8Array([1, 2, 3]));
    expect(await store.exists('bin/data.bin')).toBe(true);
  });
});
