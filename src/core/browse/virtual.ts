/** 左闭右开。 */
export interface VisibleRange {
  start: number;
  end: number;
}

/**
 * 算该渲染哪几行。做成纯函数是因为虚拟滚动出错几乎全在边界上：
 * 首尾、总数为 0、容器高度还没测出来、橡皮筋回弹的负 scrollTop。
 */
export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  total: number,
  overscan: number,
): VisibleRange {
  if (total <= 0 || rowHeight <= 0 || viewportHeight <= 0) return { start: 0, end: 0 };
  const first = Math.max(0, Math.floor(scrollTop / rowHeight));
  // +1 是给顶部露出半行的情况补一行，否则滚动时底部会闪空白
  const visible = Math.ceil(viewportHeight / rowHeight) + 1;
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(total, first + visible + overscan),
  };
}
