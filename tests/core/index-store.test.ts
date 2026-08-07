import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';
import { bucketOf, bucketDir, pointerDir, pointerPath, lookup, writePointer, removePointer } from '../../src/core/index-store';
import type { ReadStore } from '../../src/core/read-store';
import type { Pointer } from '../../src/types';

const p = (collector: string, path: string): Pointer => ({
  note_id: '6a030b860000000036000201',
  path,
  collector,
  title: 't',
  first_archived_at: '2026-08-03T14:02:11+08:00',
  last_archived_at: '2026-08-03T14:02:11+08:00',
});

let store: Store;
beforeEach(() => { store = createStore(memRoot()); });

describe('路径规则', () => {
  it('bucket 取 noteId 前两位', () => expect(bucketOf('6a030b86')).toBe('6a'));
  it('指针目录', () => expect(pointerDir('6a030b86')).toBe('_index/6a/6a030b86'));
  it('指针文件', () => expect(pointerPath('6a030b86', 'zach')).toBe('_index/6a/6a030b86/zach.json'));
  it('桶目录', () => expect(bucketDir('6a030b86')).toBe('_index/6a'));
});

describe('lookup', () => {
  it('未采集时返回空数组', async () => {
    expect(await lookup(store, '6a030b860000000036000201')).toEqual([]);
  });

  it('写入后能查到', async () => {
    await writePointer(store, p('zach', 'zach/2026-08-03/6a030b860000000036000201'));
    const got = await lookup(store, '6a030b860000000036000201');
    expect(got).toHaveLength(1);
    expect(got[0]!.collector).toBe('zach');
    expect(got[0]!.path).toBe('zach/2026-08-03/6a030b860000000036000201');
  });

  it('多个采集者各自一个指针，全部返回', async () => {
    await writePointer(store, p('zach', 'zach/2026-08-03/6a030b860000000036000201'));
    await writePointer(store, p('alice', 'alice/2026-08-01/6a030b860000000036000201'));
    const got = await lookup(store, '6a030b860000000036000201');
    expect(got.map((x) => x.collector).sort()).toEqual(['alice', 'zach']);
  });

  it('跳过损坏的指针文件而不是整体失败', async () => {
    await writePointer(store, p('zach', 'zach/2026-08-03/6a030b860000000036000201'));
    await store.writeFile('_index/6a/6a030b860000000036000201/broken.json', '{ not json');
    const got = await lookup(store, '6a030b860000000036000201');
    expect(got).toHaveLength(1);
    expect(got[0]!.collector).toBe('zach');
  });

  it('忽略非 .json 条目', async () => {
    await writePointer(store, p('zach', 'zach/2026-08-03/6a030b860000000036000201'));
    await store.writeFile('_index/6a/6a030b860000000036000201/.DS_Store', 'junk');
    expect(await lookup(store, '6a030b860000000036000201')).toHaveLength(1);
  });

  // 浏览页与 planDelete 都只有 ReadStore。用 listDir 实现的话这条会编译不过，
  // 这个测试就是防止哪天有人图省事改回去。
  it('只用 ReadStore 的四个方法就能查', async () => {
    await writePointer(store, p('zach', 'collected/2026-08-03/6a030b860000000036000201'));
    const ro: ReadStore = {
      readText: (path) => store.readText(path),
      readFile: (path) => store.readFile(path),
      exists: (path) => store.exists(path),
      listEntries: (path) => store.listEntries(path),
    };
    const got = await lookup(ro, '6a030b860000000036000201');
    expect(got).toHaveLength(1);
    expect(got[0]!.collector).toBe('zach');
  });
});

describe('removePointer', () => {
  it('删除后查不到', async () => {
    await writePointer(store, p('zach', 'zach/2026-08-03/6a030b860000000036000201'));
    await removePointer(store, '6a030b860000000036000201', 'zach');
    expect(await lookup(store, '6a030b860000000036000201')).toEqual([]);
  });
});

describe('写入内容', () => {
  it('指针为固定顺序 JSON，末尾换行', async () => {
    await writePointer(store, p('zach', 'zach/2026-08-03/6a030b860000000036000201'));
    const txt = await store.readText('_index/6a/6a030b860000000036000201/zach.json');
    expect(txt!.endsWith('}\n')).toBe(true);
    expect(Object.keys(JSON.parse(txt!))[0]).toBe('note_id');
  });
});
