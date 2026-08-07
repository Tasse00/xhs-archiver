export type BrowseKeyAction = 'next' | 'prev' | 'open-detail';

/**
 * 浏览页列表的快捷键。抽成纯函数是为了能直接测——App 拖着 store、
 * FSA 权限门一整条链路，为一个按键去渲染它不划算。
 *
 * 这里**没有** Esc：看图器也在 window 上监听 Esc，两边谁都拦不住谁
 * （事件不是从对方那里冒泡上来的），一起响应的结果是关一张图连详情栏
 * 也关掉。Esc 整个让给看图器，详情栏用 Enter 与顶栏开关控制。
 */
export function browseKeyAction(key: string): BrowseKeyAction | null {
  if (key === 'ArrowDown') return 'next';
  if (key === 'ArrowUp') return 'prev';
  if (key === 'Enter') return 'open-detail';
  return null;
}
