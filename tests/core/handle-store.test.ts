import { describe, it, expect } from 'vitest';
import { isMissingError, rootExists } from '../../src/core/handle-store';
import { memRoot, deletedRoot } from '../helpers/memory-fs';
import { createStore } from '../../src/core/store';

describe('rootExists', () => {
  it('目录还在时为真——空目录也算在', async () => {
    // 关键区分点：空仓库与被删掉的仓库在所有读操作上都长得一样，
    // store 会把两者都报成「没有这个条目」。
    expect(await rootExists(memRoot())).toBe(true);
  });

  it('目录已被删掉时为假', async () => {
    expect(await rootExists(deletedRoot())).toBe(false);
  });

  it('目录没了时 store 的读操作一片安静，所以必须显式探', async () => {
    const s = createStore(deletedRoot());
    // 这两个把 NotFoundError 解读成「没有这个条目」，与空仓库无从区分
    expect(await s.exists('note.json')).toBe(false);
    expect(await s.readText('note.json')).toBe(null);
    // 遍历反倒会直接抛出去，所以调用方两种形态都得接住
    await expect(s.listDir('')).rejects.toThrow(DOMException);
  });
});

describe('isMissingError', () => {
  it('只认 NotFoundError', () => {
    expect(isMissingError(new DOMException('x', 'NotFoundError'))).toBe(true);
    // 权限问题有它自己的恢复路径（一次点击即可），不能混进来当成目录没了
    expect(isMissingError(new DOMException('x', 'NotAllowedError'))).toBe(false);
    expect(isMissingError(new Error('NotFoundError'))).toBe(false);
  });
});
