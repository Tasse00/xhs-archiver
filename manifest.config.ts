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
  action: { default_title: '归档这篇笔记' },
});
