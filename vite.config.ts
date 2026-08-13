import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Vibe serves the app from https://<linkName>.vibe.facilio.com and zips whatever
// is in `build.publish` (dist). index.html must land at the root of dist.
const BUILD_ID = new Date().toISOString().slice(5, 16).replace('T', ' ');

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    globals: false,
    // Agent worktrees live under .claude/worktrees inside the repo — never
    // sweep their test copies into this project's run.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
});
