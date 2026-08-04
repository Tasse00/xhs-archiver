export type TaskOutcome<T> =
  | { kind: 'done'; value: T }
  /** 还没启动就被取消，没花任何代价 */
  | { kind: 'dropped' }
  /** 已经启动，中止不了；值交回调用方去释放 */
  | { kind: 'stale'; value: T }
  | { kind: 'failed'; error: unknown };

interface Job {
  run(): void;
  drop(): void;
}

/**
 * 并发上限队列。快速拖滚动条时会瞬间排起几百个读取请求，不设限会把
 * 磁盘和内存同时打满。
 *
 * 两种取消要分开处理：还没启动的直接丢掉；已经启动的中止不了，只能等它
 * 完成后把值交回去让调用方立刻释放——objectURL 不释放就是内存泄漏。
 */
export class TaskQueue {
  private running = 0;
  private queue: Job[] = [];

  constructor(private limit: number) {}

  get runningCount(): number {
    return this.running;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  push<T>(
    task: () => Promise<T>,
    isCancelled: () => boolean,
    onSettle: (o: TaskOutcome<T>) => void,
  ): void {
    this.queue.push({
      run: () => {
        if (isCancelled()) {
          onSettle({ kind: 'dropped' });
          this.done();
          return;
        }
        void task().then(
          (value) => {
            onSettle(isCancelled() ? { kind: 'stale', value } : { kind: 'done', value });
            this.done();
          },
          (error: unknown) => {
            onSettle({ kind: 'failed', error });
            this.done();
          },
        );
      },
      drop: () => onSettle({ kind: 'dropped' }),
    });
    this.pump();
  }

  /** 切换范围时调用：排队中的任务已经没人要了。 */
  clearPending(): void {
    const dropped = this.queue;
    this.queue = [];
    for (const j of dropped) j.drop();
  }

  private done(): void {
    this.running--;
    this.pump();
  }

  private pump(): void {
    while (this.running < this.limit && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.running++;
      job.run();
    }
  }
}
