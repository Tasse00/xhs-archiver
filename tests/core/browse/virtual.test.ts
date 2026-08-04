import { describe, it, expect } from 'vitest';
import { visibleRange } from '../../../src/core/browse/virtual';

describe('visibleRange', () => {
  it('顶部：从 0 开始，末尾多算一行加 overscan', () => {
    // 视口 440px / 行高 44px = 10 行，+1 行补半行，+2 overscan
    expect(visibleRange(0, 440, 44, 1000, 2)).toEqual({ start: 0, end: 13 });
  });

  it('滚到中间', () => {
    expect(visibleRange(440, 440, 44, 1000, 2)).toEqual({ start: 8, end: 23 });
  });

  it('滚到底部时 end 被总数夹住', () => {
    expect(visibleRange(44 * 990, 440, 44, 1000, 2)).toEqual({ start: 988, end: 1000 });
  });

  it('总数为 0 时返回空区间', () => {
    expect(visibleRange(0, 440, 44, 0, 8)).toEqual({ start: 0, end: 0 });
  });

  it('容器还没测量出高度时返回空区间', () => {
    expect(visibleRange(0, 0, 44, 1000, 8)).toEqual({ start: 0, end: 0 });
  });

  it('行高为 0 时不除零', () => {
    expect(visibleRange(0, 440, 0, 1000, 8)).toEqual({ start: 0, end: 0 });
  });

  it('橡皮筋回弹造成的负 scrollTop 不会算出负下标', () => {
    expect(visibleRange(-120, 440, 44, 1000, 2)).toEqual({ start: 0, end: 13 });
  });

  it('总数少于一屏时全部返回', () => {
    expect(visibleRange(0, 440, 44, 3, 8)).toEqual({ start: 0, end: 3 });
  });

  it('overscan 为 0 时正好覆盖可见行', () => {
    expect(visibleRange(0, 440, 44, 1000, 0)).toEqual({ start: 0, end: 11 });
  });
});
