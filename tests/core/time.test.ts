import { describe, it, expect } from 'vitest';
import { toBeijingIso } from '../../src/core/time';

describe('toBeijingIso', () => {
  it('固定 +08:00 偏移，不含毫秒', () => {
    // 1778584454000 = 2026-05-12T11:14:14Z = 北京 19:14:14
    expect(toBeijingIso(1778584454000)).toBe('2026-05-12T19:14:14+08:00');
  });

  it('跨零点仍正确', () => {
    expect(toBeijingIso(Date.UTC(2026, 0, 1, 20, 0, 0))).toBe('2026-01-02T04:00:00+08:00');
  });
});
