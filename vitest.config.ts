import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts, whose root is the client folder.
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
});
