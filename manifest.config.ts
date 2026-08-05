import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

export default defineManifest({
  manifest_version: 3,
  name: '小红书笔记归档',
  // 版本号唯一来源是 package.json，发布流程只改那一处（见
  // docs/superpowers/specs/2026-08-05-github-actions-release-design.md §4）。
  // 不要在这里硬编码，否则 zip 文件名与扩展显示的版本会对不上。
  version: pkg.version,
  permissions: ['sidePanel', 'scripting', 'storage', 'tabs'],
  host_permissions: [
    'https://*.xiaohongshu.com/*',
    'https://*.xhscdn.com/*',
  ],
  background: { service_worker: 'src/background/service-worker.ts', type: 'module' },
  side_panel: { default_path: 'src/sidepanel/index.html' },
  // 图标由 scripts/gen-icons.mjs 生成到 public/icons/，vite 原样复制到 dist 根，
  // 所以这里写的是 dist 内的相对路径。改设计请改脚本再 npm run icons，别手改 PNG。
  icons: {
    16: 'icons/icon16.png',
    32: 'icons/icon32.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  action: {
    default_title: '归档这篇笔记',
    default_icon: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
  },
});
