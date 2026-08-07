// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createStore, type Store } from '../../src/core/store';
import { memRoot } from '../helpers/memory-fs';
import { writePointer } from '../../src/core/index-store';
import { DeleteBlock } from '../../src/browser/components/DeleteBlock';
import type { Pointer } from '../../src/types';

afterEach(cleanup);

const NOTE = '6a030b860000000036000201';
const DIR = `collected/2026-08-03/${NOTE}`;

const pointer = (collector: string, path: string): Pointer => ({
  note_id: NOTE,
  path,
  collector,
  title: '一篇笔记',
  first_archived_at: '2026-08-03T14:02:11+08:00',
  last_archived_at: '2026-08-03T14:02:11+08:00',
});

async function seeded(): Promise<Store> {
  const store = createStore(memRoot());
  await writePointer(store, pointer('zach', DIR));
  await store.writeFile(`${DIR}/note.json`, '{}');
  return store;
}

const noteRef = { noteId: NOTE, datasetPath: 'collected/2026-08-03' };

describe('DeleteBlock', () => {
  it('一开始只有入口按钮', async () => {
    render(createElement(DeleteBlock, { store: await seeded(), noteRef, onDeleted: vi.fn() }));
    expect(screen.getByRole('button', { name: '删除这篇' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认删除' })).toBeNull();
  });

  it('点入口后列出将删的目录与指针', async () => {
    render(createElement(DeleteBlock, { store: await seeded(), noteRef, onDeleted: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: '删除这篇' }));

    await waitFor(() => expect(screen.getByText(`${DIR}/`)).toBeTruthy());
    expect(screen.getByText('索引指针：zach')).toBeTruthy();
  });

  // 「删掉这篇的所有痕迹」可能连带删掉别处那一份，必须先看得见
  it('别处还有一份时，两个目录都列出来', async () => {
    const store = await seeded();
    await writePointer(store, pointer('alice', `alice/2026-08-01/${NOTE}`));
    render(createElement(DeleteBlock, { store, noteRef, onDeleted: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: '删除这篇' }));

    await waitFor(() => expect(screen.getByText(`alice/2026-08-01/${NOTE}/`)).toBeTruthy());
    expect(screen.getByText(`${DIR}/`)).toBeTruthy();
  });

  it('取消后回到只有入口的样子，什么都没删', async () => {
    const store = await seeded();
    render(createElement(DeleteBlock, { store, noteRef, onDeleted: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: '删除这篇' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '确认删除' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '确认删除' })).toBeNull());
    expect(await store.exists(`${DIR}/note.json`)).toBe(true);
  });

  it('确认后真的删掉，并通知上层', async () => {
    const store = await seeded();
    const onDeleted = vi.fn();
    render(createElement(DeleteBlock, { store, noteRef, onDeleted }));
    fireEvent.click(screen.getByRole('button', { name: '删除这篇' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '确认删除' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(await store.exists(`${DIR}/note.json`)).toBe(false);
    expect(await store.exists(`_index/6a/${NOTE}/zach.json`)).toBe(false);
  });

  it('删除出错时把原因摆出来，不通知上层', async () => {
    const base = await seeded();
    const store: Store = {
      ...base,
      removeDir: async (path: string) => {
        if (path.startsWith('collected')) throw new Error('boom');
        return base.removeDir(path);
      },
    };
    const onDeleted = vi.fn();
    render(createElement(DeleteBlock, { store, noteRef, onDeleted }));
    fireEvent.click(screen.getByRole('button', { name: '删除这篇' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '确认删除' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => expect(screen.getByText(/boom/)).toBeTruthy());
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
