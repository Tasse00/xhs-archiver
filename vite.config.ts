import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  // crxjs 只自动打包 manifest 里声明过的 HTML。浏览页不属于 popup/side_panel/
  // options 任何一种，必须显式作为 input 加进来。
  build: { rollupOptions: { input: { browser: 'src/browser/index.html' } } },
});
