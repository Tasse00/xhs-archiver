export interface LruOptions<V> {
  max: number;
  /** 值被淘汰、覆盖或清空时调用。缩略图缓存在这里 revokeObjectURL。 */
  onEvict(value: V): void;
}

/**
 * 靠 Map 的插入序实现：删掉再插入即为「最近使用」。
 * 不依赖任何浏览器 API，因此内存行为可以在 Node 下直接测——
 * 而它恰好是整个浏览页最主要的内存风险来源。
 */
export class Lru<V> {
  private map = new Map<string, V>();

  constructor(private opts: LruOptions<V>) {}

  get size(): number {
    return this.map.size;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key: string, value: V): void {
    const old = this.map.get(key);
    if (old !== undefined) {
      this.map.delete(key);
      this.opts.onEvict(old);
    }
    this.map.set(key, value);
    while (this.map.size > this.opts.max) {
      const oldest = this.map.keys().next();
      if (oldest.done === true) break;
      const victim = this.map.get(oldest.value)!;
      this.map.delete(oldest.value);
      this.opts.onEvict(victim);
    }
  }

  clear(): void {
    for (const v of this.map.values()) this.opts.onEvict(v);
    this.map.clear();
  }
}
