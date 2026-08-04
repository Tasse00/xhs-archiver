import { describe, it, expect } from 'vitest';
import {
  isValidSegment, isValidDatasetPath, randomCollectorId,
  defaultDatasetPath, loadSettings, saveSettings, type SettingsArea,
} from '../../src/core/settings';

function fakeArea(): SettingsArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    async get(keys: string[]) {
      const out: Record<string, unknown> = {};
      for (const k of keys) if (k in data) out[k] = data[k];
      return out;
    },
    async set(items: Record<string, unknown>) { Object.assign(data, items); },
  };
}

describe('isValidSegment', () => {
  it('接受小写字母数字连字符下划线', () => {
    expect(isValidSegment('zach')).toBe(true);
    expect(isValidSegment('2026-08-03')).toBe(true);
    expect(isValidSegment('a_b-1')).toBe(true);
  });
  it('拒绝中文、大写、空格、点号', () => {
    expect(isValidSegment('张三')).toBe(false);
    expect(isValidSegment('Zach')).toBe(false);
    expect(isValidSegment('a b')).toBe(false);
    expect(isValidSegment('..')).toBe(false);
    expect(isValidSegment('')).toBe(false);
  });
  it('拒绝超过 32 字符', () => {
    expect(isValidSegment('a'.repeat(33))).toBe(false);
  });
});

describe('isValidDatasetPath', () => {
  it('接受多段路径', () => expect(isValidDatasetPath('zach/2026-08-03')).toBe(true));
  it('拒绝以斜杠开头或结尾', () => {
    expect(isValidDatasetPath('/zach')).toBe(false);
    expect(isValidDatasetPath('zach/')).toBe(false);
  });
  it('拒绝含 .. 的路径', () => expect(isValidDatasetPath('zach/../etc')).toBe(false));
  it('拒绝保留的 _index 前缀', () => expect(isValidDatasetPath('_index/x')).toBe(false));
  it('拒绝空字符串', () => expect(isValidDatasetPath('')).toBe(false));
});

describe('randomCollectorId', () => {
  it('产出合法段且长度为 4', () => {
    for (let i = 0; i < 50; i++) {
      const id = randomCollectorId();
      expect(id).toHaveLength(4);
      expect(isValidSegment(id)).toBe(true);
    }
  });
});

describe('defaultDatasetPath', () => {
  // 日期是使用者可选的二级分类，不是会随时间暗中变化的默认值。
  it('默认固定为 collected', () => {
    expect(defaultDatasetPath()).toBe('collected');
  });
});

describe('loadSettings / saveSettings', () => {
  it('空存储返回 null 字段', async () => {
    expect(await loadSettings(fakeArea())).toEqual({ collector: null, datasetPath: null });
  });
  it('往返一致', async () => {
    const area = fakeArea();
    await saveSettings(area, { collector: 'zach', datasetPath: 'zach/2026-08-03' });
    expect(await loadSettings(area)).toEqual({ collector: 'zach', datasetPath: 'zach/2026-08-03' });
  });
  it('旧的带日期路径会原样恢复', async () => {
    const area = fakeArea();
    Object.assign(area.data, { collector: 'zach', datasetPath: 'collected/2026-08-04' });
    expect(await loadSettings(area)).toEqual({
      collector: 'zach', datasetPath: 'collected/2026-08-04',
    });
  });
  it('拒绝保存非法采集者 ID', async () => {
    await expect(saveSettings(fakeArea(), { collector: '张三', datasetPath: null }))
      .rejects.toThrow(/采集者/);
  });
  it('拒绝保存非法数据集路径', async () => {
    await expect(saveSettings(fakeArea(), { collector: 'zach', datasetPath: '/bad' }))
      .rejects.toThrow(/数据集路径/);
  });
});
