import { describe, it, expect, beforeEach } from 'vitest';
import { createStore, type Store } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';
import { writePointer } from '../../src/core/index-store';
import { planDelete } from '../../src/core/delete';
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
