import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',  // Simulates browser DOM
    globals: true,
    include: ['src/**/*.test.ts'],
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,  // Run in single thread to avoid worker termination issues
      },
    },
    setupFiles: ['./src/test-setup.ts'],  // Setup file for global mocks
  },
});

