import { describe, it, expect } from 'vitest';
import { isValidTimestamp, toBeijingIso } from '../../src/core/time';

describe('toBeijingIso', () => {
  it('固定 +08:00 偏移，不含毫秒', () => {
    // 1778584454000 = 2026-05-12T11:14:14Z = 北京 19:14:14
    expect(toBeijingIso(1778584454000)).toBe('2026-05-12T19:14:14+08:00');
  });

  it('跨零点仍正确', () => {
    expect(toBeijingIso(Date.UTC(2026, 0, 1, 20, 0, 0))).toBe('2026-01-02T04:00:00+08:00');
  });
});

describe('isValidTimestamp', () => {
  it('接受正常毫秒时间戳', () => {
    expect(isValidTimestamp(1778584454000)).toBe(true);
  });

  // 半份数据里 time 会缺失或为 0，直接喂给 toBeijingIso 会抛 Invalid time value。
  it('拒绝会让 toISOString 抛错的值', () => {
    for (const v of [undefined, null, 0, NaN, Infinity, -1, '1778584454000', {}]) {
      expect(isValidTimestamp(v)).toBe(false);
    }
  });
});
