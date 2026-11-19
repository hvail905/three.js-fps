import { defineConfig } from 'vite';
import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Every page is an entry: the hub at the root plus one page per lab.
const labs = readdirSync(resolve(import.meta.dirname, 'labs')).filter(d => existsSync(resolve(import.meta.dirname, 'labs', d, 'index.html')));
const input = { hub: resolve(import.meta.dirname, 'index.html'), game: resolve(import.meta.dirname, 'game', 'index.html') };
for (const d of labs) input[d] = resolve(import.meta.dirname, 'labs', d, 'index.html');

export default defineConfig({
  // GitHub Pages serves the site under /<repo>/; set BASE in CI, leave it '/' locally.
  base: process.env.BASE || '/',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500, rollupOptions: { input } }, // three.js alone is ~700 kB
  server: { open: '/' },
});
