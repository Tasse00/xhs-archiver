import { describe, it, expect } from 'vitest';
import { TaskQueue, type TaskOutcome } from '../../../src/core/browse/queue';

/** 手动控制何时完成的任务。 */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const never = () => false;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('TaskQueue', () => {
  it('同时运行的任务不超过上限', async () => {
    const q = new TaskQueue(2);
    const d = [deferred<number>(), deferred<number>(), deferred<number>()];
    d.forEach((x, i) => q.push(() => x.promise, never, () => { void i; }));
    await flush();
    expect(q.runningCount).toBe(2);
    expect(q.pendingCount).toBe(1);
    d[0]!.resolve(0);
    await flush();
    expect(q.runningCount).toBe(2);
    expect(q.pendingCount).toBe(0);
  });

  it('正常完成回 done', async () => {
    const q = new TaskQueue(1);
    const seen: TaskOutcome<string>[] = [];
    q.push(async () => 'x', never, (o) => seen.push(o));
    await flush();
    expect(seen).toEqual([{ kind: 'done', value: 'x' }]);
  });

  it('排队期间被取消的任务根本不启动', async () => {
    const q = new TaskQueue(1);
    const blocker = deferred<number>();
    q.push(() => blocker.promise, never, () => {});
    let started = false;
    const seen: TaskOutcome<string>[] = [];
    q.push(async () => { started = true; return 'x'; }, () => true, (o) => seen.push(o));
    blocker.resolve(0);
    await flush();
    expect(started).toBe(false);
    expect(seen).toEqual([{ kind: 'dropped' }]);
  });

  it('启动后才取消的任务，结果标为 stale 并把值交回去释放', async () => {
    const q = new TaskQueue(1);
    let cancelled = false;
    const d = deferred<string>();
    const seen: TaskOutcome<string>[] = [];
    q.push(() => d.promise, () => cancelled, (o) => seen.push(o));
    await flush();
    cancelled = true;              // 读已经开始了，中止不了，只能事后忽略
    d.resolve('已经读出来的东西');
    await flush();
    expect(seen).toEqual([{ kind: 'stale', value: '已经读出来的东西' }]);
  });

  it('任务抛错回 failed，且不卡住后续任务', async () => {
    const q = new TaskQueue(1);
    const seen: TaskOutcome<string>[] = [];
    q.push(async () => { throw new Error('读盘失败'); }, never, (o) => seen.push(o));
    q.push(async () => 'ok', never, (o) => seen.push(o));
    await flush();
    expect(seen[0]!.kind).toBe('failed');
    expect(seen[1]).toEqual({ kind: 'done', value: 'ok' });
  });

  it('clearPending 丢掉排队中的任务并报 dropped，不影响正在跑的', async () => {
    const q = new TaskQueue(1);
    const blocker = deferred<number>();
    const seen: TaskOutcome<string>[] = [];
    q.push(() => blocker.promise, never, () => {});
    q.push(async () => 'x', never, (o) => seen.push(o));
    q.clearPending();
    expect(q.pendingCount).toBe(0);
    expect(seen).toEqual([{ kind: 'dropped' }]);
    blocker.resolve(0);
    await flush();
    expect(q.runningCount).toBe(0);
  });
});
