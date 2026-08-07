// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DeleteAction } from '../../src/sidepanel/components/Actions';
import type { DeletePlan } from '../../src/core/delete';
import type { Pointer } from '../../src/types';

afterEach(cleanup);

const NOTE = '6a030b860000000036000201';

const pointer = (collector: string, path: string): Pointer => ({
  note_id: NOTE,
  path,
  collector,
  title: '一篇笔记',
  first_archived_at: '2026-08-03T14:02:11+08:00',
  last_archived_at: '2026-08-03T14:02:11+08:00',
});

const plan: DeletePlan = {
  noteId: NOTE,
  dirs: [`collected/2026-08-03/${NOTE}`],
  pointers: [pointer('zach', `collected/2026-08-03/${NOTE}`)],
};

describe('DeleteAction', () => {
  it('没打开时只有一个入口按钮，不显示清单', () => {
    render(createElement(DeleteAction, {
      plan: null, busy: false, onOpen: vi.fn(), onCancel: vi.fn(), onConfirm: vi.fn(),
    }));

    expect(screen.getByRole('button', { name: '删除这篇' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认删除' })).toBeNull();
  });

  it('点入口通知上层去算计划', () => {
    const onOpen = vi.fn();
    render(createElement(DeleteAction, {
      plan: null, busy: false, onOpen, onCancel: vi.fn(), onConfirm: vi.fn(),
    }));

    fireEvent.click(screen.getByRole('button', { name: '删除这篇' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('采集进行中时入口禁用', () => {
    render(createElement(DeleteAction, {
      plan: null, busy: true, onOpen: vi.fn(), onCancel: vi.fn(), onConfirm: vi.fn(),
    }));

    expect(screen.getByRole('button', { name: '删除这篇' }).hasAttribute('disabled')).toBe(true);
  });

  // 「可能连带删掉别处那一份」这件事必须在按下去之前看得见
  it('打开后逐条列出将删的目录与指针', () => {
    render(createElement(DeleteAction, {
      plan: {
        noteId: NOTE,
        dirs: [`alice/2026-08-01/${NOTE}`, `collected/2026-08-03/${NOTE}`],
        pointers: [
          pointer('alice', `alice/2026-08-01/${NOTE}`),
          pointer('zach', `collected/2026-08-03/${NOTE}`),
        ],
      },
      busy: false, onOpen: vi.fn(), onCancel: vi.fn(), onConfirm: vi.fn(),
    }));

    expect(screen.getByText(`alice/2026-08-01/${NOTE}/`)).toBeTruthy();
    expect(screen.getByText(`collected/2026-08-03/${NOTE}/`)).toBeTruthy();
    // getByText 匹配的是整个文本节点，所以前缀要一起写上
    expect(screen.getByText('索引指针：alice、zach')).toBeTruthy();
  });

  it('确认与取消各自回调，且不互相触发', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(createElement(DeleteAction, {
      plan, busy: false, onOpen: vi.fn(), onCancel, onConfirm,
    }));

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  // 目录已被手动删过、只剩孤儿指针，是本功能最常见的入口场景
  it('没有目录只有指针时说明只清索引', () => {
    render(createElement(DeleteAction, {
      plan: { noteId: NOTE, dirs: [], pointers: [pointer('zach', `collected/${NOTE}`)] },
      busy: false, onOpen: vi.fn(), onCancel: vi.fn(), onConfirm: vi.fn(),
    }));

    expect(screen.getByText('没有数据目录，只清理索引指针')).toBeTruthy();
  });
});
