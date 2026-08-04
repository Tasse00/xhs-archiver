import { describe, it, expect } from 'vitest';
import { Lru } from '../../../src/core/browse/lru';

function tracked(max: number) {
  const evicted: string[] = [];
  const lru = new Lru<string>({ max, onEvict: (v) => evicted.push(v) });
  return { lru, evicted };
}

describe('Lru', () => {
  it('存取', () => {
    const { lru } = tracked(3);
    lru.set('a', 'A');
    expect(lru.get('a')).toBe('A');
    expect(lru.get('missing')).toBeUndefined();
    expect(lru.has('a')).toBe(true);
  });

  it('超出上限时淘汰最久未使用的一项并回调', () => {
    const { lru, evicted } = tracked(2);
    lru.set('a', 'A');
    lru.set('b', 'B');
    lru.set('c', 'C');
    expect(evicted).toEqual(['A']);
    expect(lru.has('a')).toBe(false);
    expect(lru.size).toBe(2);
  });

  it('读一下就变成最近使用，淘汰的是另一个', () => {
    const { lru, evicted } = tracked(2);
    lru.set('a', 'A');
    lru.set('b', 'B');
    lru.get('a');
    lru.set('c', 'C');
    expect(evicted).toEqual(['B']);
    expect(lru.has('a')).toBe(true);
  });

  it('覆盖同一个键时释放旧值', () => {
    const { lru, evicted } = tracked(2);
    lru.set('a', 'A1');
    lru.set('a', 'A2');
    expect(evicted).toEqual(['A1']);
    expect(lru.get('a')).toBe('A2');
    expect(lru.size).toBe(1);
  });

  it('clear 释放全部', () => {
    const { lru, evicted } = tracked(3);
    lru.set('a', 'A');
    lru.set('b', 'B');
    lru.clear();
    expect(evicted.sort()).toEqual(['A', 'B']);
    expect(lru.size).toBe(0);
  });

  it('max 为 1 时每次 set 都淘汰上一个', () => {
    const { lru, evicted } = tracked(1);
    lru.set('a', 'A');
    lru.set('b', 'B');
    expect(evicted).toEqual(['A']);
  });
});
