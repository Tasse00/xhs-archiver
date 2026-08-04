import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: '小红书笔记归档',
  version: '0.1.0',
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
