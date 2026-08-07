import type { Pointer } from '../types';
import type { ReadStore } from './read-store';
import { lookup } from './index-store';

export interface DeletePlan {
  noteId: string;
  /** 将被删除的笔记目录，去重后按字典序排。 */
  dirs: string[];
  /** 将被删除的指针。 */
  pointers: Pointer[];
}

/**
 * 算出删掉这篇要动哪些东西。只读，产物既是给人看的确认清单，也是 deleteNote
 * 的唯一输入——看到的就是删掉的，界面不必自己再拼一遍范围定义。
 *
 * `here` 是浏览页当前正在看的那份目录。它可能是一份没有指针的孤儿副本，
 * 光靠指针查不出来。侧边栏不传：它只知道指针，也不该为此扫全仓库。
 */
export async function planDelete(
  store: ReadStore,
  noteId: string,
  here?: string,
): Promise<DeletePlan> {
  const pointers = await lookup(store, noteId);
  const dirs = new Set(pointers.map((p) => p.path));
  if (here) dirs.add(here);
  return { noteId, dirs: [...dirs].sort(), pointers };
}
