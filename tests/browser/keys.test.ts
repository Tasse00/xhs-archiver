import { describe, expect, it } from 'vitest';
import { browseKeyAction } from '../../src/browser/keys';

describe('browseKeyAction', () => {
  it('↑↓ 换行、Enter 开详情', () => {
    expect(browseKeyAction('ArrowDown')).toBe('next');
    expect(browseKeyAction('ArrowUp')).toBe('prev');
    expect(browseKeyAction('Enter')).toBe('open-detail');
  });

  // Esc 只归看图器。两边都监听 window，谁也拦不住谁，
  // 结果是关一张图连详情栏一起关掉
  it('Esc 不做任何事', () => {
    expect(browseKeyAction('Escape')).toBeNull();
  });

  it('其它键不做任何事', () => {
    expect(browseKeyAction('a')).toBeNull();
  });
});
