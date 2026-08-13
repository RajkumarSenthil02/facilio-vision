import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vibe serves the app from https://<linkName>.vibe.facilio.com and zips whatever
// is in `build.publish` (dist). index.html must land at the root of dist.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
