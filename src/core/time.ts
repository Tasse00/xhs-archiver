const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 页面数据是异步填充的，读到只填了一半的 note 时 time 会缺失或为 0。
 * 调用 toBeijingIso 前必须先过这一关，否则 toISOString 抛 RangeError，
 * 错误会一路冒泡到面板顶层，显示成一句没有上下文的「Invalid time value」。
 */
export function isValidTimestamp(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** 固定 +08:00 偏移，不随机器时区变化，不含毫秒。 */
export function toBeijingIso(ms: number): string {
  return new Date(ms + BEIJING_OFFSET_MS).toISOString().replace(/\.\d{3}Z$/, '+08:00');
}

export function nowBeijingIso(): string {
  return toBeijingIso(Date.now());
}

/** 采集日期，用于默认数据集路径。 */
export function todayBeijing(): string {
  return nowBeijingIso().slice(0, 10);
}
