import { defineConfig } from 'vite';

// Relative base so the build works at any path (e.g. GitHub Pages /OpenWorld/).
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1000 },
});
