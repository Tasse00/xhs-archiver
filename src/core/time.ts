const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

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
