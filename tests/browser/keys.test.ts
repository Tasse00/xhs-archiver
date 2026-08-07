import { describe, expect, it } from 'vitest';
import { browseKeyAction } from '../../src/browser/keys';

describe('browseKeyAction', () => {
  it('Enter 开详情', () => {
    expect(browseKeyAction('Enter')).toBe('open-detail');
  });

  // Esc 只归看图器。两边都监听 window，谁也拦不住谁，
  // 结果是关一张图连详情栏一起关掉
  it('Esc 不做任何事', () => {
    expect(browseKeyAction('Escape')).toBeNull();
  });

  // ↑↓ 也归看图器（← → 翻图之外它不用，但换行会换掉整篇笔记，
  // 正在看的图当场消失）。换行改用鼠标点行
  it('↑↓ 不做任何事', () => {
    expect(browseKeyAction('ArrowDown')).toBeNull();
    expect(browseKeyAction('ArrowUp')).toBeNull();
  });

  it('其它键不做任何事', () => {
    expect(browseKeyAction('a')).toBeNull();
  });
});
