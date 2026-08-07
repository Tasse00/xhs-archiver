import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';
import { deleteNote, planDelete } from '../../src/core/delete';
import { lookup, writePointer } from '../../src/core/index-store';
import type { Pointer } from '../../src/types';

const NOTE = '6a030b860000000036000201';

const p = (collector: string, path: string): Pointer => ({
  note_id: NOTE,
  path,
  collector,
  title: '一篇笔记',
  first_archived_at: '2026-08-03T14:02:11+08:00',
  last_archived_at: '2026-08-03T14:02:11+08:00',
});

let store: Store;
beforeEach(() => { store = createStore(memRoot()); });

describe('planDelete', () => {
  it('没有指针、只有一份孤儿目录时，计划里只有那个目录', async () => {
    await store.writeFile(`collected/2026-08-03/${NOTE}/note.json`, '{}');
    const plan = await planDelete(store, NOTE, `collected/2026-08-03/${NOTE}`);
    expect(plan.noteId).toBe(NOTE);
    expect(plan.dirs).toEqual([`collected/2026-08-03/${NOTE}`]);
    expect(plan.pointers).toEqual([]);
  });

  it('单指针单目录：各一条', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    const plan = await planDelete(store, NOTE);
    expect(plan.dirs).toEqual([`collected/2026-08-03/${NOTE}`]);
    expect(plan.pointers.map((x) => x.collector)).toEqual(['zach']);
  });

  // 同一份数据被两个人各登记了一次（race_same_path）。目录只能删一次。
  it('同目录下多个采集者的指针：目录去重成一个', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    await writePointer(store, p('alice', `collected/2026-08-03/${NOTE}`));
    const plan = await planDelete(store, NOTE);
    expect(plan.dirs).toEqual([`collected/2026-08-03/${NOTE}`]);
    expect(plan.pointers.map((x) => x.collector).sort()).toEqual(['alice', 'zach']);
  });

  // race_diverged：两个人各存各的。「删掉这篇的所有痕迹」意味着两份都删。
  it('指针指向两个不同目录：两个目录都进计划', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    await writePointer(store, p('alice', `alice/2026-08-01/${NOTE}`));
    const plan = await planDelete(store, NOTE);
    expect(plan.dirs).toEqual([`alice/2026-08-01/${NOTE}`, `collected/2026-08-03/${NOTE}`]);
  });

  // 使用者手动删了目录却没删指针——这正是本功能要收拾的局面。
  it('指针指向的目录已经不存在时，仍然进计划', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    const plan = await planDelete(store, NOTE);
    expect(plan.dirs).toEqual([`collected/2026-08-03/${NOTE}`]);
  });

  it('here 与指针指向的目录相同时不重复计入', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    const plan = await planDelete(store, NOTE, `collected/2026-08-03/${NOTE}`);
    expect(plan.dirs).toEqual([`collected/2026-08-03/${NOTE}`]);
  });

  it('什么都没有时计划为空', async () => {
    const plan = await planDelete(store, NOTE);
    expect(plan.dirs).toEqual([]);
    expect(plan.pointers).toEqual([]);
  });
});

describe('deleteNote', () => {
  it('指针和数据目录都不见了', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    await store.writeFile(`collected/2026-08-03/${NOTE}/note.json`, '{}');

    const res = await deleteNote(store, await planDelete(store, NOTE));

    expect(res).toEqual({ dirs: 1, pointers: 1 });
    expect(await lookup(store, NOTE)).toEqual([]);
    expect(await store.exists(`collected/2026-08-03/${NOTE}/note.json`)).toBe(false);
  });

  // 空的指针目录和空的桶目录留着只会让 _index 越堆越脏
  it('清空后的指针目录与桶目录一并删掉', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    await deleteNote(store, await planDelete(store, NOTE));
    expect(await store.exists(`_index/6a/${NOTE}`)).toBe(false);
    expect(await store.exists('_index/6a')).toBe(false);
  });

  it('桶目录下还有别的笔记时，桶目录保留', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    await store.writeFile('_index/6a/6a99999999999999999999zz/zach.json', '{}');
    await deleteNote(store, await planDelete(store, NOTE));
    expect(await store.exists(`_index/6a/${NOTE}`)).toBe(false);
    expect(await store.exists('_index/6a')).toBe(true);
  });

  it('父目录因此变空就删掉', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    await store.writeFile(`collected/2026-08-03/${NOTE}/note.json`, '{}');
    await deleteNote(store, await planDelete(store, NOTE));
    expect(await store.exists('collected/2026-08-03')).toBe(false);
  });

  it('父目录下还有别的笔记就保留', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    await store.writeFile(`collected/2026-08-03/${NOTE}/note.json`, '{}');
    await store.writeFile('collected/2026-08-03/6a99999999999999999999zz/note.json', '{}');
    await deleteNote(store, await planDelete(store, NOTE));
    expect(await store.exists('collected/2026-08-03')).toBe(true);
  });

  // 写入路径设成 collected 时，笔记目录的父就是 collected 本身。
  // 删空它没有意义，下次采集还得重建。
  it('路径只有两段时不动父目录', async () => {
    await writePointer(store, p('zach', `collected/${NOTE}`));
    await store.writeFile(`collected/${NOTE}/note.json`, '{}');
    await deleteNote(store, await planDelete(store, NOTE));
    expect(await store.exists(`collected/${NOTE}`)).toBe(false);
    expect(await store.exists('collected')).toBe(true);
  });

  /**
   * 顺序断言。删目录那一步炸掉时，残留必须是「孤儿目录」——它安全，查重不受
   * 影响。反过来先删目录再删指针的话，同样的中断会留下孤儿指针，破坏
   * 「指针存在 ⟹ 数据完整」，让所有人都放弃采集一篇其实不存在的笔记。
   */
  it('删目录中途失败时，指针已经删掉，残留的是孤儿目录', async () => {
    await writePointer(store, p('zach', `collected/2026-08-03/${NOTE}`));
    await store.writeFile(`collected/2026-08-03/${NOTE}/note.json`, '{}');
    const plan = await planDelete(store, NOTE);

    const failing: Store = {
      ...store,
      removeDir: async (path: string) => {
        if (path.startsWith('collected')) throw new Error('boom');
        return store.removeDir(path);
      },
    };

    await expect(deleteNote(failing, plan)).rejects.toThrow('boom');
    expect(await lookup(store, NOTE)).toEqual([]);
    expect(await store.exists(`collected/2026-08-03/${NOTE}/note.json`)).toBe(true);
  });
});
