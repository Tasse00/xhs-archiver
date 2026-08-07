export type BrowseKeyAction = 'open-detail';

/**
 * 浏览页列表的快捷键。抽成纯函数是为了能直接测——App 拖着 store、
 * FSA 权限门一整条链路，为一个按键去渲染它不划算。
 *
 * 这份清单里只剩 Enter，其余全让给看图器，因为两者都在 window 上监听、
 * 事件不从对方冒泡而来，谁也拦不住谁：
 * - `Esc` 一起响应就是「关一张图连详情栏也关掉」
 * - `↑` `↓` 一起响应就是「看图时换了一篇笔记」，正在看的图当场消失
 *
 * 换行改用鼠标点行（点行同时也会打开详情栏）。
 */
export function browseKeyAction(key: string): BrowseKeyAction | null {
  if (key === 'Enter') return 'open-detail';
  return null;
}
