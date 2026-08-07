import type { Pointer } from '../types';
import type { ReadStore } from './read-store';
import type { Store } from './store';
import { bucketDir, lookup, pointerDir, removePointer } from './index-store';

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

export interface DeleteResult {
  dirs: number;
  pointers: number;
}

/** 目录为空才删。这是仓库的本地单人操作，空判定与删除之间不需要原子性。 */
export async function removeEmptyDir(store: Store, path: string): Promise<void> {
  if ((await store.listDir(path)).length === 0) await store.removeDir(path);
}

/**
 * 清理因删除而变空的父目录，但绝不上溯到仓库根：路径不足三段就不动。
 *
 * 守卫的用处：写入路径被设成 `collected` 这种两段路径时，笔记目录的父级就是
 * `collected/` 本身，删空它没有意义，下次采集还得重建。
 */
export async function removeEmptyParent(store: Store, path: string): Promise<void> {
  const parts = path.split('/');
  if (parts.length < 3) return;
  await removeEmptyDir(store, parts.slice(0, -1).join('/'));
}

/**
 * 执行删除。**先删指针，再删数据目录**——这是 archive() 「先写数据、后写指针」
 * 的镜像，理由相同：中断时的残留必须落在安全的那一侧。
 *
 * 先指针后目录，最坏留下孤儿目录：quality.ts 的 no_pointer 认得它，查重不受
 * 影响，重采会直接覆盖。反过来最坏留下孤儿指针，那会破坏「指针存在 ⟹ 数据
 * 完整」这条全局不变量，所有人的查重都会拿到假阳性——正是本功能要消灭的问题。
 * 不对称得很明显，没有权衡余地。
 */
export async function deleteNote(store: Store, plan: DeletePlan): Promise<DeleteResult> {
  for (const p of plan.pointers) {
    await removePointer(store, plan.noteId, p.collector);
  }
  await removeEmptyDir(store, pointerDir(plan.noteId));
  await removeEmptyDir(store, bucketDir(plan.noteId));

  for (const dir of plan.dirs) {
    await store.removeDir(dir);
  }
  for (const dir of plan.dirs) {
    await removeEmptyParent(store, dir);
  }

  return { dirs: plan.dirs.length, pointers: plan.pointers.length };
}
