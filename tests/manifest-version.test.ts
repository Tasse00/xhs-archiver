import { describe, it, expect } from 'vitest';
import manifest from '../manifest.config';
import pkg from '../package.json';

// 守的是「有人图省事把版本号硬编码回 manifest.config.ts」这件事。
// 一旦两处脱钩，zip 的文件名和扩展里显示的版本号就会对不上，而这在 CI 上不报错。
describe('版本号唯一来源', () => {
  it('manifest 的版本号取自 package.json', () => {
    // defineManifest 的返回类型是 ManifestV3 | Promise<ManifestV3> | ManifestV3Fn，
    // 不因传入对象字面量而收窄；项目里传的始终是同步对象，排除另外两种形态即可。
    if (typeof manifest === 'function' || manifest instanceof Promise) {
      throw new Error('manifest.config.ts 应导出同步对象，而不是函数或 Promise');
    }
    expect(manifest.version).toBe(pkg.version);
  });
});
