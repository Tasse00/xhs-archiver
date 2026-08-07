import { describe, it, expect } from 'vitest';
import {
  isValidSegment, isValidDatasetPath, randomCollectorId,
  defaultDatasetPath, datasetPathPresets, loadSettings, saveSettings, type SettingsArea,
} from '../../src/core/settings';
import { todayBeijing } from '../../src/core/time';

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
  it('空存储返回 null 字段，两个采集开关默认打开', async () => {
    expect(await loadSettings(fakeArea())).toEqual({
      collector: null, datasetPath: null, captureAuthor: true, captureShare: true,
    });
  });
  it('往返一致', async () => {
    const area = fakeArea();
    await saveSettings(area, {
      collector: 'zach', datasetPath: 'zach/2026-08-03', captureAuthor: true, captureShare: true,
    });
    expect(await loadSettings(area)).toEqual({
      collector: 'zach', datasetPath: 'zach/2026-08-03', captureAuthor: true, captureShare: true,
    });
  });
  it('旧的带日期路径会原样恢复', async () => {
    const area = fakeArea();
    Object.assign(area.data, { collector: 'zach', datasetPath: 'collected/2026-08-04' });
    expect(await loadSettings(area)).toEqual({
      collector: 'zach', datasetPath: 'collected/2026-08-04',
      captureAuthor: true, captureShare: true,
    });
  });
  it('拒绝保存非法采集者 ID', async () => {
    await expect(saveSettings(fakeArea(), {
      collector: '张三', datasetPath: null, captureAuthor: true, captureShare: true,
    })).rejects.toThrow(/采集者/);
  });
  it('拒绝保存非法数据集路径', async () => {
    await expect(saveSettings(fakeArea(), {
      collector: 'zach', datasetPath: '/bad', captureAuthor: true, captureShare: true,
    })).rejects.toThrow(/数据集路径/);
  });

  // 已经在用的人 storage 里没有这两个 key。读成 false 等于静默关掉他们本来就有的能力。
  it('老用户没有这两个 key 时读成打开', async () => {
    const area = fakeArea();
    Object.assign(area.data, { collector: 'zach', datasetPath: 'collected' });
    const s = await loadSettings(area);
    expect(s.captureAuthor).toBe(true);
    expect(s.captureShare).toBe(true);
  });

  it('关掉的开关能存能读回', async () => {
    const area = fakeArea();
    await saveSettings(area, {
      collector: 'zach', datasetPath: 'collected', captureAuthor: false, captureShare: false,
    });
    const s = await loadSettings(area);
    expect(s.captureAuthor).toBe(false);
    expect(s.captureShare).toBe(false);
  });

  // 只关一个是最常见的用法：平台改版通常只弄坏其中一步。
  it('两个开关互相独立', async () => {
    const area = fakeArea();
    await saveSettings(area, {
      collector: 'zach', datasetPath: 'collected', captureAuthor: false, captureShare: true,
    });
    const s = await loadSettings(area);
    expect(s.captureAuthor).toBe(false);
    expect(s.captureShare).toBe(true);
  });
});

describe('datasetPathPresets', () => {
  it('给出四个预设：仓库默认、按日期、按采集者、采集者按日期', () => {
    expect(datasetPathPresets('zach', '2026-08-07')).toEqual([
      'collected',
      'collected/2026-08-07',
      'zach',
      'zach/2026-08-07',
    ]);
  });

  // 首次设置路径时采集者 ID 已经定下来了，但组件层拿到的类型是 string | null，
  // 不能因为一个空值就整排快捷选项都不出来。
  it('没有采集者时只给不依赖采集者的两个', () => {
    expect(datasetPathPresets(null, '2026-08-07')).toEqual([
      'collected',
      'collected/2026-08-07',
    ]);
  });

  // 采集者 ID 在保存时校验过，但 storage 里可能存着更早版本写进去的值。
  // 拼出一个存不下去的路径，等于给人一个点了就报错的按钮。
  it('采集者 ID 不合法时不拿它拼路径', () => {
    expect(datasetPathPresets('张三', '2026-08-07')).toEqual([
      'collected',
      'collected/2026-08-07',
    ]);
  });

  it('每个预设都是合法的写入路径', () => {
    for (const p of datasetPathPresets('zach')) {
      expect(isValidDatasetPath(p)).toBe(true);
    }
  });

  it('日期缺省取北京时区的今天', () => {
    expect(datasetPathPresets('zach')).toContain(`collected/${todayBeijing()}`);
  });
});
